import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { calculateSettlement } from './engines/settlement.engine';
import { buildSettlementPostings } from './engines/ledger.engine';
import { LedgerService } from './ledger.service';
import { DailySettlement } from './entities/daily-settlement.entity';
import { RiderAssignment } from '../operations/entities/rider-assignment.entity';
import { DataScope, DataScopeService } from '../hubs/data-scope.service';
import { AuthUser } from '../../common/auth/auth-user';
import { assertIsoDate, todayAccra } from '../../common/dates/dates';
import { cedisToPesewas } from '../../common/money/money';

export interface CalculateOptions {
  date?: string;
  hubId?: string;
  riderId?: string;
}

export interface SettlementOutcome {
  riderId: string;
  vehicleId: string;
  date: string;
  settlementId?: string;
  version?: number;
  status?: string;
  skipped?: 'closed';
  shortfallPesewas?: number;
}

export const SETTLEMENT_SHORTFALL_EVENT = 'settlement.shortfall';

@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly ledger: LedgerService,
    private readonly scope: DataScopeService,
    private readonly events: EventEmitter2,
  ) {}

  /** Calculates (or recalculates, until closed) the day's settlement for every active assignment in scope. */
  async calculate(user: AuthUser, opts: CalculateOptions): Promise<SettlementOutcome[]> {
    const date = assertIsoDate(opts.date ?? todayAccra());
    const scope = await this.scope.forUser(user);
    if (opts.hubId) this.scope.assertHub(scope, opts.hubId);

    const assignments = await this.ds.getRepository(RiderAssignment).createQueryBuilder('a')
      .where('a.organization_id = :org', { org: user.organizationId })
      .andWhere('a.start_date <= :date AND (a.end_date IS NULL OR a.end_date >= :date)', { date })
      .andWhere(opts.hubId ? 'a.hub_id = :hub' : '1=1', { hub: opts.hubId })
      .andWhere(opts.riderId ? 'a.rider_id = :rider' : '1=1', { rider: opts.riderId })
      .andWhere(scope.all ? '1=1' : 'a.hub_id = ANY(:hubs)', { hubs: scope.hubIds })
      .getMany();

    const outcomes: SettlementOutcome[] = [];
    for (const a of assignments) {
      outcomes.push(await this.calculateOne(user.organizationId, a, date, user.sub));
    }
    return outcomes;
  }

  async calculateOne(orgId: string, a: RiderAssignment, date: string, userId: string | null): Promise<SettlementOutcome> {
    const outcome = await this.ds.transaction(async (m): Promise<SettlementOutcome> => {
      const existing = await m.getRepository(DailySettlement).findOne({
        where: { riderId: a.riderId, vehicleId: a.vehicleId, settlementDate: date, isCurrent: true },
      });
      if (existing?.status === 'closed') {
        return { riderId: a.riderId, vehicleId: a.vehicleId, date, settlementId: existing.id, version: existing.version, status: 'closed', skipped: 'closed' };
      }

      const gross = await this.sum(m, `SELECT COALESCE(SUM(amount_pesewas),0) AS v FROM daily_collections WHERE rider_id=$1 AND vehicle_id=$2 AND collection_date=$3`, [a.riderId, a.vehicleId, date]);
      const chargeFee = await this.sum(m, `SELECT COALESCE(SUM(fee_pesewas),0) AS v FROM charge_events WHERE rider_id=$1 AND charge_date=$2 AND status IN ('completed','billed') AND (settlement_id IS NULL OR settlement_id=$3)`, [a.riderId, date, existing?.id ?? '00000000-0000-0000-0000-000000000000']);
      const directRows = await m.query(`SELECT COALESCE(SUM(amount),0)::text AS v FROM payment_logs WHERE rider_id=$1 AND work_and_pay_cycle_date=$2 AND status='success'`, [a.riderId, date]);
      const direct = cedisToPesewas(String(Number(directRows[0].v).toFixed(2)));
      const ownerRows = await m.query(`SELECT owner_id FROM vehicles WHERE id=$1`, [a.vehicleId]);
      const ownerId: string | null = ownerRows[0]?.owner_id ?? null;

      const r = calculateSettlement({
        grossCollected: gross,
        chargeFeeDue: chargeFee,
        remittanceDue: a.dailyRemittancePesewas,
        remittancePaidDirect: direct,
        serviceFeeDue: a.serviceFeePesewas,
      });

      const version = (existing?.version ?? 0) + 1;
      if (existing) {
        if (existing.ledgerTransactionId) {
          await this.ledger.reverseTransaction(m, orgId, existing.ledgerTransactionId, `recalculated as version ${version}`, userId);
        }
        await m.query(`UPDATE daily_settlements SET is_current=false WHERE id=$1`, [existing.id]);
      }

      const settlement = await m.getRepository(DailySettlement).save(m.getRepository(DailySettlement).create({
        organizationId: orgId, hubId: a.hubId, riderId: a.riderId, vehicleId: a.vehicleId, ownerId,
        settlementDate: date, version, isCurrent: true,
        grossCollectedPesewas: r.grossCollected, chargeFeePesewas: r.chargeFeePaid + r.shortfallCharge,
        remittanceDuePesewas: a.dailyRemittancePesewas, remittancePaidPesewas: r.remittanceTotalPaid,
        serviceFeePesewas: r.serviceFeePaid, chopPesewas: r.chop, shortfallPesewas: r.shortfallTotal,
        netToOwnerPesewas: r.netToOwner, status: r.status, calculatedBy: userId,
      }));

      const lines = buildSettlementPostings({ hubId: a.hubId, riderId: a.riderId, ownerId, ...r });
      if (lines.length >= 2) {
        const posted = await this.ledger.post(m, {
          organizationId: orgId,
          reference: `settlement:${a.riderId}:${a.vehicleId}:${date}:v${version}`,
          kind: 'settlement',
          description: `Daily settlement ${date}`,
          lines,
          createdBy: userId,
        });
        await m.query(`UPDATE daily_settlements SET ledger_transaction_id=$1 WHERE id=$2`, [posted.transactionId, settlement.id]);
      }
      await m.query(`UPDATE charge_events SET settlement_id=$1, status='billed' WHERE rider_id=$2 AND charge_date=$3 AND status='completed' AND fee_pesewas>0`, [settlement.id, a.riderId, date]);

      return { riderId: a.riderId, vehicleId: a.vehicleId, date, settlementId: settlement.id, version, status: r.status, shortfallPesewas: r.shortfallRemittance };
    });

    if (outcome.status === 'shortfall' && outcome.shortfallPesewas) {
      this.events.emit(SETTLEMENT_SHORTFALL_EVENT, { organizationId: orgId, ...outcome });
    } else if (outcome.status !== 'shortfall') {
      this.events.emit('settlement.settled', { organizationId: orgId, ...outcome });
    }
    return outcome;
  }

  private async sum(m: EntityManager, sql: string, params: unknown[]): Promise<number> {
    const rows = await m.query(sql, params);
    return Number(rows[0].v);
  }

  async list(user: AuthUser, q: { date?: string; hubId?: string; riderId?: string; status?: string; from?: string; to?: string }) {
    const scope = await this.scope.forUser(user);
    if (q.hubId) this.scope.assertHub(scope, q.hubId);
    const qb = this.ds.getRepository(DailySettlement).createQueryBuilder('s')
      .where('s.organization_id = :org AND s.is_current = true', { org: user.organizationId });
    if (!scope.all) {
      if (scope.ownerIds.length) qb.andWhere('s.owner_id = ANY(:owners)', { owners: scope.ownerIds });
      else if (scope.hubIds.length) qb.andWhere('s.hub_id = ANY(:hubs)', { hubs: scope.hubIds });
      else qb.andWhere('1=0');
    }
    if (q.date) qb.andWhere('s.settlement_date = :date', { date: assertIsoDate(q.date) });
    if (q.from) qb.andWhere('s.settlement_date >= :from', { from: assertIsoDate(q.from, 'from') });
    if (q.to) qb.andWhere('s.settlement_date <= :to', { to: assertIsoDate(q.to, 'to') });
    if (q.hubId) qb.andWhere('s.hub_id = :hub', { hub: q.hubId });
    if (q.riderId) qb.andWhere('s.rider_id = :rider', { rider: q.riderId });
    if (q.status) qb.andWhere('s.status = :status', { status: q.status });
    return qb.orderBy('s.settlement_date', 'DESC').addOrderBy('s.created_at', 'DESC').limit(500).getMany();
  }

  /** The hub manager confirms the day. A closed settlement is final. */
  async close(user: AuthUser, id: string): Promise<DailySettlement> {
    const s = await this.ds.getRepository(DailySettlement).findOne({ where: { id, organizationId: user.organizationId } });
    if (!s) throw new NotFoundException(`Settlement ${id} not found`);
    this.scope.assertHub(await this.scope.forUser(user), s.hubId);
    if (!s.isCurrent) throw new ConflictException('This is an older version of the settlement; close the current one');
    if (s.status === 'closed') return s;
    s.status = 'closed';
    s.closedBy = user.sub;
    s.closedAt = new Date();
    return this.ds.getRepository(DailySettlement).save(s);
  }

  /**
   * Optional nightly run at 23:30 Accra time. Off unless AUTO_SETTLEMENT=true so nothing posts to the ledger
   * until the client has confirmed the deduction order (assumption A2).
   */
  @Cron('30 23 * * *', { timeZone: 'Africa/Accra' })
  async nightlyRun() {
    if (process.env.AUTO_SETTLEMENT !== 'true') return;
    const date = todayAccra();
    const assignments = await this.ds.getRepository(RiderAssignment).find({ where: { status: 'active' } });
    let done = 0;
    for (const a of assignments) {
      try {
        await this.calculateOne(a.organizationId, a, date, null);
        done++;
      } catch (e: any) {
        this.logger.error(`Settlement failed for rider ${a.riderId} on ${date}: ${e.message}`);
      }
    }
    this.logger.log(`Nightly settlement ${date}: ${done}/${assignments.length} calculated`);
  }
}
