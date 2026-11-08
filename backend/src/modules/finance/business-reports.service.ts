import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DataScopeService } from '../hubs/data-scope.service';
import { summariseArrears } from '../contracts/engines/contract-schedule.engine';
import { collectionRate, paybackWeeks } from './engines/payback.engine';
import { AuthUser } from '../../common/auth/auth-user';
import { assertIsoDate, monthRange, todayAccra, weekRange } from '../../common/dates/dates';

const n = (v: unknown) => Number(v ?? 0);

@Injectable()
export class BusinessReportsService {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly scope: DataScopeService) {}

  /** One hub, one day: what came in, what was divided, who fell short. */
  async hubDailyClose(user: AuthUser, hubId: string, dateIn?: string) {
    const date = assertIsoDate(dateIn ?? todayAccra());
    this.scope.assertHub(await this.scope.forUser(user), hubId);
    const [hub] = await this.ds.query(`SELECT id, name FROM hubs WHERE id=$1 AND organization_id=$2`, [hubId, user.organizationId]);
    if (!hub) throw new NotFoundException('Hub not found');
    const rows = await this.ds.query(
      `SELECT s.id, s.rider_id, r.full_name AS rider_name, s.vehicle_id, v.plate_number, s.version, s.status,
              s.gross_collected_pesewas g, s.charge_fee_pesewas cf, s.remittance_due_pesewas rd, s.remittance_paid_pesewas rp,
              s.service_fee_pesewas sf, s.chop_pesewas chop, s.shortfall_pesewas sh, s.net_to_owner_pesewas net
         FROM daily_settlements s JOIN riders r ON r.id = s.rider_id JOIN vehicles v ON v.id = s.vehicle_id
        WHERE s.organization_id=$1 AND s.hub_id=$2 AND s.settlement_date=$3 AND s.is_current ORDER BY r.full_name`,
      [user.organizationId, hubId, date]);
    const lines = rows.map((r: any) => ({
      settlementId: r.id, riderId: r.rider_id, riderName: r.rider_name, vehicleId: r.vehicle_id, plateNumber: r.plate_number, version: r.version, status: r.status,
      grossCollected: n(r.g), chargeFee: n(r.cf), remittanceDue: n(r.rd), remittancePaid: n(r.rp), serviceFee: n(r.sf), chop: n(r.chop), shortfall: n(r.sh), netToOwner: n(r.net),
    }));
    const sum = (k: string) => lines.reduce((a: number, l: any) => a + l[k], 0);
    const [{ missing }] = await this.ds.query(
      `SELECT COUNT(*)::int AS missing FROM rider_assignments a
        WHERE a.organization_id=$1 AND a.hub_id=$2 AND a.start_date <= $3 AND (a.end_date IS NULL OR a.end_date >= $3)
          AND NOT EXISTS (SELECT 1 FROM daily_settlements s WHERE s.rider_id=a.rider_id AND s.vehicle_id=a.vehicle_id AND s.settlement_date=$3 AND s.is_current)`,
      [user.organizationId, hubId, date]);
    return {
      hub, date, riders: lines.length, ridersNotYetSettled: missing,
      totals: { grossCollected: sum('grossCollected'), chargeFee: sum('chargeFee'), remittancePaid: sum('remittancePaid'), serviceFee: sum('serviceFee'), chop: sum('chop'), shortfall: sum('shortfall'), netToOwner: sum('netToOwner') },
      shortfalls: lines.filter((l: any) => l.status === 'shortfall'),
      lines,
    };
  }

  async riderStatement(user: AuthUser, riderId: string, from: string, to: string) {
    assertIsoDate(from, 'from'); assertIsoDate(to, 'to');
    const [rider] = await this.ds.query(`SELECT id, full_name, hub_id FROM riders WHERE id=$1 AND organization_id=$2`, [riderId, user.organizationId]);
    if (!rider) throw new NotFoundException('Rider not found');
    const scope = await this.scope.forUser(user);
    if (!scope.all && !(rider.hub_id && scope.hubIds.includes(rider.hub_id))) throw new ForbiddenException('You do not have access to this rider');
    const days = await this.ds.query(
      `SELECT settlement_date::text AS date, status, gross_collected_pesewas g, charge_fee_pesewas cf, remittance_paid_pesewas rp, service_fee_pesewas sf, chop_pesewas chop, shortfall_pesewas sh
         FROM daily_settlements WHERE rider_id=$1 AND is_current AND settlement_date BETWEEN $2 AND $3 ORDER BY settlement_date`, [riderId, from, to]);
    const rows = days.map((d: any) => ({ date: d.date, status: d.status, grossCollected: n(d.g), chargeFee: n(d.cf), remittancePaid: n(d.rp), serviceFee: n(d.sf), chop: n(d.chop), shortfall: n(d.sh) }));
    const sum = (k: string) => rows.reduce((a: number, r: any) => a + r[k], 0);
    // Daily route details: the trips made on the vehicle(s) this rider held on each day.
    const trips = await this.ds.query(
      `SELECT (t.start_time AT TIME ZONE 'UTC')::date::text AS date, v.plate_number, COUNT(*)::int AS trips, COALESCE(SUM(t.distance),0) AS distance,
              MIN(t.start_time) AS first_start, MAX(t.end_time) AS last_end,
              (ARRAY_AGG(t.start_location ORDER BY t.start_time))[1] AS first_location, (ARRAY_AGG(t.end_location ORDER BY t.start_time DESC))[1] AS last_location
         FROM rider_assignments a JOIN trips t ON t.vehicle_id=a.vehicle_id
         JOIN vehicles v ON v.id=t.vehicle_id
        WHERE a.rider_id=$1 AND (t.start_time AT TIME ZONE 'UTC')::date BETWEEN $2 AND $3
          AND (t.start_time AT TIME ZONE 'UTC')::date >= a.start_date AND (a.end_date IS NULL OR (t.start_time AT TIME ZONE 'UTC')::date <= a.end_date)
        GROUP BY 1, 2 ORDER BY 1`, [riderId, from, to]);
    const routes = trips.map((t: any) => ({ date: t.date, plateNumber: t.plate_number, trips: t.trips, distance: n(t.distance), firstStart: t.first_start, lastEnd: t.last_end, startedAt: t.first_location, endedAt: t.last_location }));
    return { riderId, riderName: rider.full_name, from, to, days: rows.length, routes, routeTotals: { trips: routes.reduce((a: number, r: any) => a + r.trips, 0), distance: routes.reduce((a: number, r: any) => a + r.distance, 0) }, totals: { grossCollected: sum('grossCollected'), chargeFee: sum('chargeFee'), remittancePaid: sum('remittancePaid'), serviceFee: sum('serviceFee'), chop: sum('chop'), shortfall: sum('shortfall') }, rows };
  }

  /** What an investor's vehicles earned and what they still owe on their contracts. */
  async ownerStatement(user: AuthUser, ownerId: string, from: string, to: string) {
    assertIsoDate(from, 'from'); assertIsoDate(to, 'to');
    this.scope.assertOwner(await this.scope.forUser(user), ownerId);
    const [owner] = await this.ds.query(`SELECT id, name FROM owners WHERE id=$1 AND organization_id=$2`, [ownerId, user.organizationId]);
    if (!owner) throw new NotFoundException('Owner not found');
    const vehicles = await this.ds.query(
      `SELECT v.id, v.plate_number, COALESCE(SUM(s.net_to_owner_pesewas),0) AS net, COALESCE(SUM(s.gross_collected_pesewas),0) AS gross, COUNT(s.id)::int AS days
         FROM vehicles v LEFT JOIN daily_settlements s ON s.vehicle_id=v.id AND s.is_current AND s.owner_id=$1 AND s.settlement_date BETWEEN $2 AND $3
        WHERE v.owner_id=$1 GROUP BY v.id ORDER BY v.plate_number`, [ownerId, from, to]);
    const contracts = await this.ds.query(
      `SELECT c.id, c.contract_no, c.mode, c.status, c.price_pesewas p,
              COALESCE((SELECT SUM(amount_pesewas) FROM installments WHERE contract_id=c.id),0) AS total,
              COALESCE((SELECT SUM(paid_pesewas) FROM installments WHERE contract_id=c.id),0) AS paid
         FROM sale_contracts c WHERE c.owner_id=$1 ORDER BY c.created_at`, [ownerId]);
    const balance = await this.ds.query(
      `SELECT COALESCE(SUM(e.amount_pesewas) FILTER (WHERE e.direction='credit'),0) - COALESCE(SUM(e.amount_pesewas) FILTER (WHERE e.direction='debit'),0) AS bal
         FROM ledger_accounts a JOIN ledger_entries e ON e.account_id=a.id WHERE a.organization_id=$1 AND a.code='owner_account' AND a.owner_type='owner' AND a.owner_id=$2`, [user.organizationId, ownerId]);
    // Payback progress: what each vehicle has earned for its owner since the start, against the price paid.
    const payback = await this.ds.query(
      `SELECT v.id,
              (SELECT price_pesewas FROM sale_contracts WHERE vehicle_id=v.id AND status IN ('active','completed','defaulted') ORDER BY created_at DESC LIMIT 1) AS price,
              COALESCE((SELECT SUM(net_to_owner_pesewas) FROM daily_settlements WHERE vehicle_id=v.id AND is_current AND owner_id=$1),0) AS lifetime,
              COALESCE((SELECT SUM(net_to_owner_pesewas) FROM daily_settlements WHERE vehicle_id=v.id AND is_current AND owner_id=$1 AND settlement_date > CURRENT_DATE - 56),0) AS last8
         FROM vehicles v WHERE v.owner_id=$1`, [ownerId]);
    const pb = new Map<string, any>(payback.map((p: any) => {
      const price = p.price == null ? null : n(p.price); const lifetime = n(p.lifetime); const weekly = Math.round(n(p.last8) / 8);
      return [p.id, {
        pricePesewas: price, earnedToDatePesewas: lifetime, averageWeeklyNetPesewas: weekly,
        progressPct: price ? Math.min(100, Math.round((lifetime / price) * 1000) / 10) : null,
        projectedPaybackWeeks: price ? paybackWeeks(price, weekly) : null,
        weeksRemaining: price ? (lifetime >= price ? 0 : paybackWeeks(price - lifetime, weekly)) : null,
      }];
    }));
    return {
      owner, from, to, ledgerBalance: n(balance[0]?.bal),
      vehicles: vehicles.map((v: any) => ({ vehicleId: v.id, plateNumber: v.plate_number, grossCollected: n(v.gross), netToOwner: n(v.net), settledDays: v.days, payback: pb.get(v.id) ?? null })),
      contracts: contracts.map((c: any) => ({ contractId: c.id, contractNo: c.contract_no, mode: c.mode, status: c.status, price: n(c.p), installmentsTotal: n(c.total), installmentsPaid: n(c.paid), outstanding: n(c.total) - n(c.paid) })),
      totals: { grossCollected: vehicles.reduce((a: number, v: any) => a + n(v.gross), 0), netToOwner: vehicles.reduce((a: number, v: any) => a + n(v.net), 0) },
    };
  }

  /** Every contract with overdue installments, worst first. */
  async arrears(user: AuthUser) {
    const today = todayAccra();
    const rows = await this.ds.query(
      `SELECT c.id, c.contract_no, c.status, c.default_after_arrears_days, o.name AS owner_name, o.phone, v.plate_number,
              i.id AS iid, i.due_date::text AS due, i.amount_pesewas a, i.paid_pesewas p
         FROM sale_contracts c JOIN owners o ON o.id=c.owner_id JOIN vehicles v ON v.id=c.vehicle_id JOIN installments i ON i.contract_id=c.id
        WHERE c.organization_id=$1 AND c.status IN ('active','defaulted')`, [user.organizationId]);
    const by = new Map<string, any>();
    for (const r of rows) {
      if (!by.has(r.id)) by.set(r.id, { contractId: r.id, contractNo: r.contract_no, status: r.status, ownerName: r.owner_name, ownerPhone: r.phone, plateNumber: r.plate_number, defaultAfterDays: r.default_after_arrears_days, inst: [] });
      by.get(r.id).inst.push({ id: r.iid, dueDate: r.due, amount: n(r.a), paid: n(r.p) });
    }
    return [...by.values()]
      .map(({ inst, ...c }) => ({ ...c, ...summariseArrears(inst, today) }))
      .filter((c) => c.overdueAmount > 0)
      .sort((a, b) => b.arrearsDays - a.arrearsDays);
  }

  /** Weekly or monthly rollup, by day, for the whole organisation or one hub. */
  async periodSummary(user: AuthUser, period: 'week' | 'month', anchorIn?: string, hubId?: string) {
    const anchor = assertIsoDate(anchorIn ?? todayAccra(), 'date');
    const { from, to } = period === 'week' ? weekRange(anchor) : monthRange(anchor);
    const scope = await this.scope.forUser(user);
    if (hubId) this.scope.assertHub(scope, hubId);
    if (!scope.all && !hubId && scope.hubIds.length === 0) throw new ForbiddenException('No hubs are assigned to you');
    const params: unknown[] = [user.organizationId, from, to];
    let filter = '';
    if (hubId) { params.push(hubId); filter = ` AND hub_id = $${params.length}`; }
    else if (!scope.all) { params.push(scope.hubIds); filter = ` AND hub_id = ANY($${params.length})`; }
    const days = await this.ds.query(
      `SELECT settlement_date::text AS date, COUNT(*)::int AS settlements, SUM(gross_collected_pesewas) g, SUM(remittance_paid_pesewas) rp, SUM(remittance_due_pesewas) rd,
              SUM(charge_fee_pesewas) cf, SUM(service_fee_pesewas) sf, SUM(chop_pesewas) chop, SUM(shortfall_pesewas) sh
         FROM daily_settlements WHERE organization_id=$1 AND is_current AND settlement_date BETWEEN $2 AND $3${filter} GROUP BY settlement_date ORDER BY settlement_date`, params);
    const rows = days.map((d: any) => ({ date: d.date, settlements: d.settlements, grossCollected: n(d.g), remittanceDue: n(d.rd), remittancePaid: n(d.rp), chargeFee: n(d.cf), serviceFee: n(d.sf), chop: n(d.chop), shortfall: n(d.sh) }));
    const sum = (k: string) => rows.reduce((a: number, r: any) => a + r[k], 0);
    return {
      period, from, to, hubId: hubId ?? null,
      totals: { grossCollected: sum('grossCollected'), remittanceDue: sum('remittanceDue'), remittancePaid: sum('remittancePaid'), chargeFee: sum('chargeFee'), serviceFee: sum('serviceFee'), chop: sum('chop'), shortfall: sum('shortfall') },
      remittanceCollectionRate: collectionRate(sum('remittancePaid'), sum('remittanceDue')),
      days: rows,
    };
  }

  /** Condition of the fleet: where every vehicle is in its life, which have no tracker or rider, and the state of the batteries. */
  async fleetHealth(user: AuthUser, hubId?: string) {
    const scope = await this.scope.forUser(user);
    if (hubId) this.scope.assertHub(scope, hubId);
    const hubs: string[] | null = hubId ? [hubId] : scope.all ? null : scope.hubIds;
    if (hubs && hubs.length === 0) throw new ForbiddenException('No hubs are assigned to you');
    const hv = hubs ? ' AND v.hub_id = ANY($2)' : '';
    const hb = hubs ? ' AND b.hub_id = ANY($2)' : '';
    const params: unknown[] = hubs ? [user.organizationId, hubs] : [user.organizationId];
    const byStatus = await this.ds.query(`SELECT v.lifecycle_status AS status, COUNT(*)::int AS count FROM vehicles v WHERE v.organization_id=$1${hv} GROUP BY 1 ORDER BY 2 DESC`, params);
    const [flags] = await this.ds.query(
      `SELECT COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM devices d WHERE d.vehicle_id=v.id) AND v.lifecycle_status IN ('sold','assigned','active','locked'))::int AS "noTracker",
              COUNT(*) FILTER (WHERE v.lifecycle_status IN ('sold','assigned','active') AND NOT EXISTS (SELECT 1 FROM riders r WHERE r.assigned_vehicle_id=v.id))::int AS "noRider",
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM immobilizer_state s WHERE s.vehicle_id=v.id AND s.state='immobilized'))::int AS "locked",
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM immobilizer_state s WHERE s.vehicle_id=v.id AND s.state IN ('warning_sent','payment_failed','immobilize_queued')))::int AS "inGracePeriod",
              COUNT(*) FILTER (WHERE v.lifecycle_status IN ('maintenance','stolen'))::int AS "needAttention"
         FROM vehicles v WHERE v.organization_id=$1${hv}`, params);
    const batteriesByStatus = await this.ds.query(`SELECT b.status, COUNT(*)::int AS count FROM batteries b WHERE b.organization_id=$1${hb} GROUP BY 1 ORDER BY 2 DESC`, params);
    const [bstats] = await this.ds.query(
      `SELECT COUNT(*)::int AS total, ROUND(AVG(b.health_pct),1) AS "averageHealthPct", COUNT(*) FILTER (WHERE b.health_pct IS NOT NULL AND b.health_pct < 70)::int AS "below70",
              COUNT(*) FILTER (WHERE b.health_pct IS NULL)::int AS "healthUnknown", COALESCE(MAX(b.cycle_count),0)::int AS "maxCycles"
         FROM batteries b WHERE b.organization_id=$1${hb}`, params);
    const weak = await this.ds.query(
      `SELECT b.serial_no AS "serialNo", b.status, b.health_pct AS "healthPct", b.cycle_count AS "cycleCount", h.name AS "hubName", v.plate_number AS "plateNumber"
         FROM batteries b LEFT JOIN hubs h ON h.id=b.hub_id LEFT JOIN vehicles v ON v.id=b.current_vehicle_id
        WHERE b.organization_id=$1${hb} AND (b.status IN ('faulty','missing') OR (b.health_pct IS NOT NULL AND b.health_pct < 70))
        ORDER BY b.health_pct NULLS FIRST LIMIT 50`, params);
    return { vehiclesByStatus: byStatus, vehicleFlags: flags, batteriesByStatus, batteryStats: { ...bstats, averageHealthPct: bstats.averageHealthPct == null ? null : n(bstats.averageHealthPct) }, batteriesNeedingAttention: weak };
  }

  /** Earnings grouped by vehicle, region or vehicle type over a date range. */
  async summaryBy(user: AuthUser, dimension: string, from: string, to: string, hubId?: string) {
    assertIsoDate(from, 'from'); assertIsoDate(to, 'to');
    const dims: Record<string, { key: string; label: string; joins: string }> = {
      vehicle: { key: 'v.id', label: 'v.plate_number', joins: '' },
      region: { key: 'h.region', label: 'h.region', joins: '' },
      vehicle_type: { key: "COALESCE(vm.vehicle_type,'unknown')", label: "COALESCE(vm.vehicle_type,'unknown')", joins: 'LEFT JOIN vehicle_models vm ON vm.id=v.vehicle_model_id' },
    };
    const d = dims[dimension];
    if (!d) throw new BadRequestException('dimension must be vehicle, region or vehicle_type');
    const scope = await this.scope.forUser(user);
    if (hubId) this.scope.assertHub(scope, hubId);
    const params: unknown[] = [user.organizationId, from, to];
    let filter = '';
    if (hubId) { params.push(hubId); filter = ` AND s.hub_id=$${params.length}`; }
    else if (!scope.all) { params.push(scope.hubIds); filter = ` AND s.hub_id = ANY($${params.length})`; }
    const rows = await this.ds.query(
      `SELECT ${d.key} AS key, ${d.label} AS label, COUNT(*)::int AS settlements, COUNT(DISTINCT s.vehicle_id)::int AS vehicles,
              SUM(s.gross_collected_pesewas) g, SUM(s.remittance_due_pesewas) rd, SUM(s.remittance_paid_pesewas) rp, SUM(s.charge_fee_pesewas) cf,
              SUM(s.service_fee_pesewas) sf, SUM(s.chop_pesewas) chop, SUM(s.shortfall_pesewas) sh, SUM(s.net_to_owner_pesewas) net
         FROM daily_settlements s JOIN vehicles v ON v.id=s.vehicle_id JOIN hubs h ON h.id=s.hub_id ${d.joins}
        WHERE s.organization_id=$1 AND s.is_current AND s.settlement_date BETWEEN $2 AND $3${filter}
        GROUP BY 1, 2 ORDER BY SUM(s.gross_collected_pesewas) DESC`, params);
    const out = rows.map((r: any) => ({ key: r.key, label: r.label, settlements: r.settlements, vehicles: r.vehicles, grossCollected: n(r.g), remittanceDue: n(r.rd), remittancePaid: n(r.rp), chargeFee: n(r.cf), serviceFee: n(r.sf), chop: n(r.chop), shortfall: n(r.sh), netToOwner: n(r.net), collectionRate: collectionRate(n(r.rp), n(r.rd)) }));
    return { dimension, from, to, rows: out };
  }
}
