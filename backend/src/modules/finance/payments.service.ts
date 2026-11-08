import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { LedgerService } from './ledger.service';
import { ACCOUNT, AccountRef, company } from './engines/ledger.engine';
import { DataScopeService } from '../hubs/data-scope.service';
import { AuthUser } from '../../common/auth/auth-user';
import { assertPesewas } from '../../common/money/money';

type Method = 'cash' | 'momo' | 'bank';
const METHODS: Method[] = ['cash', 'momo', 'bank'];

export interface PaymentInput { amountPesewas?: number; method?: string; reference?: string; note?: string }

/**
 * Every cash movement that is not part of the daily settlement: payouts to owners and riders, hub cash deposits and
 * direct charging-fee payments. Each one gets a unique reference (sending it twice changes nothing), a purpose and a
 * ledger posting. Payouts cannot exceed the balance the ledger says is owed.
 */
@Injectable()
export class PaymentsService {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly ledger: LedgerService, private readonly scope: DataScopeService) {}

  private clean(i: PaymentInput) {
    const amount = assertPesewas(i.amountPesewas, 'amountPesewas', { min: 1 });
    const method = (i.method ?? 'cash') as Method;
    if (!METHODS.includes(method)) throw new BadRequestException('method must be cash, momo or bank');
    const reference = i.reference?.trim();
    if (!reference) throw new BadRequestException('A payment needs a unique reference (receipt number or transaction id)');
    return { amount, method, reference, note: i.note?.trim() || null };
  }

  private async insert(m: EntityManager, user: AuthUser, p: Record<string, unknown>) {
    const rows = await m.query(
      `INSERT INTO business_payments (organization_id, purpose, direction, amount_pesewas, method, party_type, party_id, party_name, contract_id, charge_event_id, hub_id, reference, ledger_transaction_id, note, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (organization_id, reference) DO NOTHING RETURNING *`,
      [user.organizationId, p.purpose, p.direction, p.amount, p.method, p.partyType ?? null, p.partyId ?? null, p.partyName ?? null, p.contractId ?? null, p.chargeEventId ?? null, p.hubId ?? null, p.reference, p.ledgerTransactionId ?? null, p.note ?? null, user.sub]);
    return rows[0] ?? null;
  }

  private async existing(m: EntityManager, orgId: string, reference: string) {
    const [x] = await m.query(`SELECT * FROM business_payments WHERE organization_id=$1 AND reference=$2`, [orgId, reference]);
    return x ?? null;
  }

  private async balanceOf(m: EntityManager, orgId: string, ref: AccountRef) {
    // inside the transaction, after an advisory lock on the account, so two payouts cannot both pass the check
    const rows = await m.query(
      `SELECT a.normal_side,
              COALESCE(SUM(e.amount_pesewas) FILTER (WHERE e.direction='debit'),0) d, COALESCE(SUM(e.amount_pesewas) FILTER (WHERE e.direction='credit'),0) c
         FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id=a.id
        WHERE a.organization_id=$1 AND a.code=$2 AND a.owner_type=$3 AND a.owner_id=$4 GROUP BY a.normal_side`, [orgId, ref.code, ref.ownerType, ref.ownerId]);
    if (!rows.length) return 0;
    return rows[0].normal_side === 'debit' ? Number(rows[0].d) - Number(rows[0].c) : Number(rows[0].c) - Number(rows[0].d);
  }

  private async lock(m: EntityManager, key: string) { await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [key]); }

  /** Pay an owner/investor what the ledger says is owed to them. */
  async payoutOwner(user: AuthUser, ownerId: string, i: PaymentInput) {
    const { amount, method, reference, note } = this.clean(i);
    return this.ds.transaction(async (m) => {
      const [o] = await m.query(`SELECT id, name FROM owners WHERE id=$1 AND organization_id=$2`, [ownerId, user.organizationId]);
      if (!o) throw new NotFoundException('Owner not found');
      const dup = await this.existing(m, user.organizationId, reference);
      if (dup) return { duplicate: true, payment: dup };
      await this.lock(m, `owner:${ownerId}`);
      const acct: AccountRef = { code: ACCOUNT.OWNER_ACCOUNT, ownerType: 'owner', ownerId };
      const owed = await this.balanceOf(m, user.organizationId, acct);
      if (amount > owed) throw new ConflictException(`Payout exceeds what is owed: GHS ${(owed / 100).toFixed(2)} available`);
      const tx = await this.ledger.post(m, { organizationId: user.organizationId, reference: `payout:${reference}`, kind: 'owner_payout', description: `Payout to ${o.name}`, createdBy: user.sub,
        lines: [{ account: acct, direction: 'debit', amount }, { account: company(ACCOUNT.COMPANY_CASH), direction: 'credit', amount }] });
      const payment = await this.insert(m, user, { purpose: 'payout', direction: 'out', amount, method, partyType: 'owner', partyId: ownerId, partyName: o.name, reference, ledgerTransactionId: tx.transactionId, note });
      return { duplicate: false, payment };
    });
  }

  /** Pay a rider the chop money that is owed to them. */
  async payoutRider(user: AuthUser, riderId: string, i: PaymentInput) {
    const { amount, method, reference, note } = this.clean(i);
    return this.ds.transaction(async (m) => {
      const [r] = await m.query(`SELECT id, full_name, hub_id FROM riders WHERE id=$1 AND organization_id=$2`, [riderId, user.organizationId]);
      if (!r) throw new NotFoundException('Rider not found');
      if (r.hub_id) this.scope.assertHub(await this.scope.forUser(user), r.hub_id);
      const dup = await this.existing(m, user.organizationId, reference);
      if (dup) return { duplicate: true, payment: dup };
      await this.lock(m, `rider:${riderId}`);
      const acct: AccountRef = { code: ACCOUNT.RIDER_CHOP, ownerType: 'rider', ownerId: riderId };
      const owed = await this.balanceOf(m, user.organizationId, acct);
      if (amount > owed) throw new ConflictException(`Payout exceeds what is owed: GHS ${(owed / 100).toFixed(2)} available`);
      const tx = await this.ledger.post(m, { organizationId: user.organizationId, reference: `payout:${reference}`, kind: 'rider_payout', description: `Payout to ${r.full_name}`, createdBy: user.sub,
        lines: [{ account: acct, direction: 'debit', amount }, { account: company(ACCOUNT.COMPANY_CASH), direction: 'credit', amount }] });
      const payment = await this.insert(m, user, { purpose: 'payout', direction: 'out', amount, method, partyType: 'rider', partyId: riderId, partyName: r.full_name, hubId: r.hub_id, reference, ledgerTransactionId: tx.transactionId, note });
      return { duplicate: false, payment };
    });
  }

  /** A hub hands the cash it holds to the company (bank or head office). */
  async hubDeposit(user: AuthUser, hubId: string, i: PaymentInput) {
    const { amount, method, reference, note } = this.clean(i);
    this.scope.assertHub(await this.scope.forUser(user), hubId);
    return this.ds.transaction(async (m) => {
      const [h] = await m.query(`SELECT id, name FROM hubs WHERE id=$1 AND organization_id=$2`, [hubId, user.organizationId]);
      if (!h) throw new NotFoundException('Hub not found');
      const dup = await this.existing(m, user.organizationId, reference);
      if (dup) return { duplicate: true, payment: dup };
      await this.lock(m, `hub:${hubId}`);
      const acct: AccountRef = { code: ACCOUNT.HUB_COLLECTIONS, ownerType: 'hub', ownerId: hubId };
      const held = await this.balanceOf(m, user.organizationId, acct);
      if (amount > held) throw new ConflictException(`The hub holds only GHS ${(held / 100).toFixed(2)} in recorded collections`);
      const tx = await this.ledger.post(m, { organizationId: user.organizationId, reference: `hub-deposit:${reference}`, kind: 'hub_deposit', description: `Cash deposit from ${h.name}`, createdBy: user.sub,
        lines: [{ account: company(ACCOUNT.COMPANY_CASH), direction: 'debit', amount }, { account: acct, direction: 'credit', amount }] });
      const payment = await this.insert(m, user, { purpose: 'hub_deposit', direction: 'in', amount, method, partyType: 'hub', partyId: hubId, partyName: h.name, hubId, reference, ledgerTransactionId: tx.transactionId, note });
      return { duplicate: false, payment };
    });
  }

  /** A rider pays a charging fee directly instead of through the daily settlement. */
  async payCharge(user: AuthUser, chargeEventId: string, i: Omit<PaymentInput, 'amountPesewas'>) {
    return this.ds.transaction(async (m) => {
      const [e] = await m.query(`SELECT * FROM charge_events WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [chargeEventId, user.organizationId]);
      if (!e) throw new NotFoundException('Charge event not found');
      if (e.hub_id) this.scope.assertHub(await this.scope.forUser(user), e.hub_id);
      if (e.status === 'paid') throw new ConflictException('This charge has already been paid');
      if (e.status === 'billed') throw new ConflictException('This charge was already collected in the daily settlement');
      if (e.status !== 'completed') throw new ConflictException('Finish the charge before taking payment');
      const fee = Number(e.fee_pesewas);
      if (fee <= 0) throw new ConflictException('This charge has no fee to pay');
      const { method, reference, note } = this.clean({ ...i, amountPesewas: fee });
      const dup = await this.existing(m, user.organizationId, reference);
      if (dup) return { duplicate: true, payment: dup };
      const cashSide = method === 'cash' && e.hub_id ? { code: ACCOUNT.HUB_COLLECTIONS, ownerType: 'hub' as const, ownerId: e.hub_id } : company(ACCOUNT.AGGREGATOR_CLEARING);
      const tx = await this.ledger.post(m, { organizationId: user.organizationId, reference: `charge-payment:${reference}`, kind: 'charge_payment', description: 'Charging fee paid directly', createdBy: user.sub,
        lines: [{ account: cashSide, direction: 'debit', amount: fee }, { account: company(ACCOUNT.CHARGING_REVENUE), direction: 'credit', amount: fee }] });
      let partyName: string | null = null;
      if (e.rider_id) { const [r] = await m.query(`SELECT full_name FROM riders WHERE id=$1`, [e.rider_id]); partyName = r?.full_name ?? null; }
      const payment = await this.insert(m, user, { purpose: 'charge', direction: 'in', amount: fee, method, partyType: e.rider_id ? 'rider' : null, partyId: e.rider_id, partyName, chargeEventId, hubId: e.hub_id, reference, ledgerTransactionId: tx.transactionId, note });
      await m.query(`UPDATE charge_events SET status='paid', payment_id=$1 WHERE id=$2`, [payment.id, chargeEventId]);
      return { duplicate: false, payment };
    });
  }

  async list(user: AuthUser, q: { purpose?: string; partyId?: string; hubId?: string; from?: string; to?: string }) {
    const scope = await this.scope.forUser(user);
    const where = ['p.organization_id=$1']; const params: unknown[] = [user.organizationId];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (q.purpose) add('p.purpose=?', q.purpose);
    if (q.partyId) add('p.party_id=?', q.partyId);
    if (q.hubId) { this.scope.assertHub(scope, q.hubId); add('p.hub_id=?', q.hubId); }
    if (q.from) add('p.created_at >= ?::date', q.from);
    if (q.to) add("p.created_at < (?::date + 1)", q.to);
    if (!scope.all) {
      if (scope.ownerIds.length && !scope.hubIds.length) add("p.party_type='owner' AND p.party_id = ANY(?)", scope.ownerIds);
      else add('p.hub_id = ANY(?)', scope.hubIds.length ? scope.hubIds : ['00000000-0000-0000-0000-000000000000']);
    }
    return this.ds.query(
      `SELECT p.id, p.purpose, p.direction, p.amount_pesewas AS "amountPesewas", p.method, p.party_type AS "partyType", p.party_id AS "partyId", p.party_name AS "partyName",
              p.contract_id AS "contractId", p.charge_event_id AS "chargeEventId", p.hub_id AS "hubId", p.reference, p.note, p.created_at AS "createdAt"
         FROM business_payments p WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC LIMIT 300`, params);
  }

  /** What each owner and rider is currently owed, plus cash held at hubs; used by the payouts screen. */
  async balances(user: AuthUser) {
    if (user.role !== 'super_admin' && user.role !== 'org_admin' && user.role !== 'finance') throw new ForbiddenException('Finance only');
    const rows = await this.ds.query(
      `SELECT a.code, a.owner_type AS "ownerType", a.owner_id AS "ownerId",
              CASE a.owner_type WHEN 'owner' THEN (SELECT name FROM owners WHERE id=a.owner_id) WHEN 'rider' THEN (SELECT full_name FROM riders WHERE id=a.owner_id) WHEN 'hub' THEN (SELECT name FROM hubs WHERE id=a.owner_id) END AS name,
              COALESCE(SUM(e.amount_pesewas) FILTER (WHERE e.direction='debit'),0) d, COALESCE(SUM(e.amount_pesewas) FILTER (WHERE e.direction='credit'),0) c, a.normal_side
         FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id=a.id
        WHERE a.organization_id=$1 AND ((a.code='owner_account' AND a.owner_type='owner') OR (a.code='rider_chop') OR (a.code='hub_collections') OR a.code='company_cash')
        GROUP BY a.id`, [user.organizationId]);
    return rows.map((r: any) => ({ account: r.code, ownerType: r.ownerType, ownerId: r.ownerId, name: r.name, balancePesewas: r.normal_side === 'debit' ? Number(r.d) - Number(r.c) : Number(r.c) - Number(r.d) }));
  }
}
