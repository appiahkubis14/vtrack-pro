import { Pesewas } from '../../../common/money/money';

export type EntryDirection = 'debit' | 'credit';

/** An account is addressed by (code, ownerType, ownerId) so one chart of accounts serves every rider/owner/hub. */
export interface AccountRef {
  code: string;
  ownerType: 'company' | 'rider' | 'owner' | 'hub';
  ownerId: string | null;
}

export interface PostingLine {
  account: AccountRef;
  direction: EntryDirection;
  amount: Pesewas;
}

export const ACCOUNT = {
  HUB_COLLECTIONS: 'hub_collections', // asset: fares collected, held at the hub
  AGGREGATOR_CLEARING: 'aggregator_clearing', // asset: mobile money received, not yet banked
  RIDER_ACCOUNT: 'rider_account', // liability: takings held on behalf of the rider until divided
  RIDER_CHOP: 'rider_chop', // liability: the rider's own money
  OWNER_ACCOUNT: 'owner_account', // liability: owed to the vehicle owner / installments received
  CHARGING_REVENUE: 'charging_revenue', // income
  COMPANY_FEES: 'company_fees', // income
  SALES_RECEIPTS: 'sales_receipts', // income: deposits and installments received from owners
  COMPANY_CASH: 'company_cash', // asset: cash the company holds after hub deposits, less payouts
} as const;

export function company(code: string): AccountRef {
  return { code, ownerType: 'company', ownerId: null };
}

export class UnbalancedTransactionError extends Error {
  constructor(public readonly debits: number, public readonly credits: number) {
    super(`Ledger transaction is not balanced: debits ${debits} vs credits ${credits}`);
  }
}

/** Throws unless total debits == total credits, every amount is a positive integer, and there are at least two lines. */
export function assertBalanced(lines: PostingLine[]): void {
  if (lines.length < 2) throw new Error('A ledger transaction needs at least two lines');
  let debits = 0;
  let credits = 0;
  for (const l of lines) {
    if (!Number.isInteger(l.amount) || l.amount <= 0) {
      throw new Error(`Ledger line amount must be a positive integer of pesewas (got ${l.amount})`);
    }
    if (l.direction === 'debit') debits += l.amount;
    else credits += l.amount;
  }
  if (debits !== credits) throw new UnbalancedTransactionError(debits, credits);
}

/** Reversal: same accounts and amounts, opposite directions. Past entries are never edited (rule BR5). */
export function reverse(lines: PostingLine[]): PostingLine[] {
  return lines.map((l) => ({ ...l, direction: l.direction === 'debit' ? 'credit' : 'debit' }));
}

export interface SettlementPostingInput {
  hubId: string;
  riderId: string;
  ownerId: string | null; // null -> remittance is held in the company's unallocated owner account
  grossCollected: Pesewas;
  chargeFeePaid: Pesewas;
  remittanceFromFares: Pesewas;
  remittanceDirect: Pesewas;
  serviceFeePaid: Pesewas;
  chop: Pesewas;
}

/** Turns a calculated settlement into balanced ledger lines. Zero-amount lines are skipped. */
export function buildSettlementPostings(s: SettlementPostingInput): PostingLine[] {
  const hub: AccountRef = { code: ACCOUNT.HUB_COLLECTIONS, ownerType: 'hub', ownerId: s.hubId };
  const rider: AccountRef = { code: ACCOUNT.RIDER_ACCOUNT, ownerType: 'rider', ownerId: s.riderId };
  const riderChop: AccountRef = { code: ACCOUNT.RIDER_CHOP, ownerType: 'rider', ownerId: s.riderId };
  const owner: AccountRef = s.ownerId
    ? { code: ACCOUNT.OWNER_ACCOUNT, ownerType: 'owner', ownerId: s.ownerId }
    : company(ACCOUNT.OWNER_ACCOUNT);

  const lines: PostingLine[] = [];
  const add = (account: AccountRef, direction: EntryDirection, amount: Pesewas) => {
    if (amount > 0) lines.push({ account, direction, amount });
  };

  // Fares come in, held on the rider's account...
  add(hub, 'debit', s.grossCollected);
  add(rider, 'credit', s.grossCollected);
  // ...then divided out in the agreed order.
  add(rider, 'debit', s.chargeFeePaid);
  add(company(ACCOUNT.CHARGING_REVENUE), 'credit', s.chargeFeePaid);
  add(rider, 'debit', s.remittanceFromFares);
  add(owner, 'credit', s.remittanceFromFares);
  add(rider, 'debit', s.serviceFeePaid);
  add(company(ACCOUNT.COMPANY_FEES), 'credit', s.serviceFeePaid);
  add(rider, 'debit', s.chop);
  add(riderChop, 'credit', s.chop);
  // Mobile money the rider paid directly goes straight to the owner side.
  add(company(ACCOUNT.AGGREGATOR_CLEARING), 'debit', s.remittanceDirect);
  add(owner, 'credit', s.remittanceDirect);
  return lines;
}
