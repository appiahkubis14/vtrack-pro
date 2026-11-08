import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ACCOUNT, AccountRef, PostingLine, assertBalanced, reverse } from './engines/ledger.engine';
import { LedgerAccount, LedgerEntry, LedgerTransaction } from './entities/ledger.entity';

const ACCOUNT_META: Record<string, { name: string; normalSide: 'debit' | 'credit' }> = {
  [ACCOUNT.HUB_COLLECTIONS]: { name: 'Fares collected at hub', normalSide: 'debit' },
  [ACCOUNT.AGGREGATOR_CLEARING]: { name: 'Mobile money in transit', normalSide: 'debit' },
  [ACCOUNT.RIDER_ACCOUNT]: { name: 'Rider account', normalSide: 'credit' },
  [ACCOUNT.RIDER_CHOP]: { name: 'Rider chop money', normalSide: 'credit' },
  [ACCOUNT.OWNER_ACCOUNT]: { name: 'Owner account', normalSide: 'credit' },
  [ACCOUNT.CHARGING_REVENUE]: { name: 'Charging revenue', normalSide: 'credit' },
  [ACCOUNT.COMPANY_FEES]: { name: 'Company service fees', normalSide: 'credit' },
  [ACCOUNT.SALES_RECEIPTS]: { name: 'Vehicle sales receipts', normalSide: 'credit' },
  [ACCOUNT.COMPANY_CASH]: { name: 'Company cash and bank', normalSide: 'debit' },
};

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export interface PostInput {
  organizationId: string;
  reference: string; // unique per organization: the same external event can only post once (rule BR6)
  kind: string;
  description?: string;
  lines: PostingLine[];
  createdBy?: string | null;
  reversesTransactionId?: string | null;
}

export interface PostResult {
  transactionId: string;
  duplicate: boolean;
}

@Injectable()
export class LedgerService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  private async account(m: EntityManager, orgId: string, ref: AccountRef): Promise<string> {
    const meta = ACCOUNT_META[ref.code];
    if (!meta) throw new Error(`Unknown ledger account code "${ref.code}"`);
    await m.query(
      `INSERT INTO ledger_accounts (organization_id, code, owner_type, owner_id, name, normal_side)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (organization_id, code, owner_type, COALESCE(owner_id, '${NIL_UUID}'::uuid)) DO NOTHING`,
      [orgId, ref.code, ref.ownerType, ref.ownerId, meta.name, meta.normalSide],
    );
    const rows = await m.query(
      `SELECT id FROM ledger_accounts WHERE organization_id=$1 AND code=$2 AND owner_type=$3 AND COALESCE(owner_id,'${NIL_UUID}'::uuid)=COALESCE($4::uuid,'${NIL_UUID}'::uuid)`,
      [orgId, ref.code, ref.ownerType, ref.ownerId],
    );
    return rows[0].id;
  }

  /**
   * Posts a balanced transaction. Pass the caller's EntityManager so the posting commits or rolls back with the
   * business change that caused it. Posting the same reference twice is a safe no-op.
   */
  async post(m: EntityManager, input: PostInput): Promise<PostResult> {
    assertBalanced(input.lines);
    const inserted = await m.query(
      `INSERT INTO ledger_transactions (organization_id, reference, kind, description, created_by, reverses_transaction_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (organization_id, reference) DO NOTHING RETURNING id`,
      [input.organizationId, input.reference, input.kind, input.description ?? null, input.createdBy ?? null, input.reversesTransactionId ?? null],
    );
    if (inserted.length === 0) {
      const existing = await m.query(`SELECT id FROM ledger_transactions WHERE organization_id=$1 AND reference=$2`, [input.organizationId, input.reference]);
      return { transactionId: existing[0].id, duplicate: true };
    }
    const transactionId: string = inserted[0].id;
    const accountIds = new Map<string, string>();
    for (const line of input.lines) {
      const key = `${line.account.code}|${line.account.ownerType}|${line.account.ownerId}`;
      if (!accountIds.has(key)) accountIds.set(key, await this.account(m, input.organizationId, line.account));
    }
    await m.getRepository(LedgerEntry).insert(
      input.lines.map((l) => ({
        transactionId,
        accountId: accountIds.get(`${l.account.code}|${l.account.ownerType}|${l.account.ownerId}`)!,
        direction: l.direction,
        amountPesewas: l.amount,
      })),
    );
    return { transactionId, duplicate: false };
  }

  /** Corrections never edit history: this posts the mirror image of an earlier transaction. */
  async reverseTransaction(m: EntityManager, orgId: string, transactionId: string, reason: string, userId?: string | null): Promise<PostResult> {
    const tx = await m.getRepository(LedgerTransaction).findOne({ where: { id: transactionId, organizationId: orgId } });
    if (!tx) throw new NotFoundException(`Ledger transaction ${transactionId} not found`);
    const rows: { code: string; owner_type: any; owner_id: string | null; direction: any; amount_pesewas: string }[] = await m.query(
      `SELECT a.code, a.owner_type, a.owner_id, e.direction, e.amount_pesewas
         FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE e.transaction_id = $1`,
      [transactionId],
    );
    const original: PostingLine[] = rows.map((r) => ({
      account: { code: r.code, ownerType: r.owner_type, ownerId: r.owner_id },
      direction: r.direction,
      amount: Number(r.amount_pesewas),
    }));
    return this.post(m, {
      organizationId: orgId,
      reference: `reversal:${transactionId}`,
      kind: 'reversal',
      description: `Reversal of ${tx.reference}: ${reason}`,
      lines: reverse(original),
      createdBy: userId,
      reversesTransactionId: transactionId,
    });
  }

  /** Balance in the account's normal direction (credit-normal accounts show credits minus debits). */
  async balance(orgId: string, ref: AccountRef): Promise<number> {
    const rows = await this.ds.query(
      `SELECT a.normal_side,
              COALESCE(SUM(e.amount_pesewas) FILTER (WHERE e.direction='debit'),0) AS d,
              COALESCE(SUM(e.amount_pesewas) FILTER (WHERE e.direction='credit'),0) AS c
         FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
        WHERE a.organization_id=$1 AND a.code=$2 AND a.owner_type=$3 AND COALESCE(a.owner_id,'${NIL_UUID}'::uuid)=COALESCE($4::uuid,'${NIL_UUID}'::uuid)
        GROUP BY a.normal_side`,
      [orgId, ref.code, ref.ownerType, ref.ownerId],
    );
    if (rows.length === 0) return 0;
    const d = Number(rows[0].d);
    const c = Number(rows[0].c);
    return rows[0].normal_side === 'debit' ? d - c : c - d;
  }

  async trialBalance(orgId: string) {
    const rows = await this.ds.query(
      `SELECT a.id, a.code, a.name, a.owner_type, a.owner_id, a.normal_side,
              COALESCE(SUM(e.amount_pesewas) FILTER (WHERE e.direction='debit'),0) AS debits,
              COALESCE(SUM(e.amount_pesewas) FILTER (WHERE e.direction='credit'),0) AS credits
         FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
        WHERE a.organization_id=$1 GROUP BY a.id ORDER BY a.code, a.owner_type, a.owner_id`,
      [orgId],
    );
    const accounts = rows.map((r: any) => {
      const debits = Number(r.debits);
      const credits = Number(r.credits);
      return {
        id: r.id, code: r.code, name: r.name, ownerType: r.owner_type, ownerId: r.owner_id, normalSide: r.normal_side,
        debits, credits, balance: r.normal_side === 'debit' ? debits - credits : credits - debits,
      };
    });
    const totalDebits = accounts.reduce((a: number, x: any) => a + x.debits, 0);
    const totalCredits = accounts.reduce((a: number, x: any) => a + x.credits, 0);
    return { accounts, totalDebits, totalCredits, balanced: totalDebits === totalCredits };
  }

  async entries(orgId: string, accountId: string, limit = 200) {
    const rows = await this.ds.query(
      `SELECT e.id, e.direction, e.amount_pesewas, e.created_at, t.reference, t.kind, t.description, t.id AS transaction_id
         FROM ledger_entries e
         JOIN ledger_transactions t ON t.id = e.transaction_id
         JOIN ledger_accounts a ON a.id = e.account_id
        WHERE a.organization_id=$1 AND a.id=$2 ORDER BY e.created_at DESC LIMIT $3`,
      [orgId, accountId, Math.min(limit, 1000)],
    );
    return rows.map((r: any) => ({ ...r, amount_pesewas: Number(r.amount_pesewas) }));
  }
}
