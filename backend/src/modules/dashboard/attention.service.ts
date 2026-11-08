import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthUser } from '../../common/auth/auth-user';
import { Role } from '../../common/constants/roles.constant';
import { MapScopeService } from '../map/map-scope.service';

export type Severity = 'critical' | 'warning' | 'info';
export interface AttentionItem { key: string; severity: Severity; title: string; count: number; detail: string; link: string; rows: { label: string; sub?: string }[] }

const MONEY_ROLES: string[] = [Role.SUPER_ADMIN, Role.ORG_ADMIN, Role.FLEET_MANAGER, Role.HUB_MANAGER, Role.FINANCE, Role.AUDITOR];
const ghs = (p: number) => 'GHS ' + (Number(p || 0) / 100).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** What needs a person's attention right now, and the money and fleet numbers behind it. Everything is limited to the caller's organization and (for hub managers) hubs. */
@Injectable()
export class AttentionService {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly scope: MapScopeService) {}

  async build(user: AuthUser) {
    const org = user.organizationId;
    const s = await this.scope.hubScope(user);
    const money = MONEY_ROLES.includes(user.role as string);
    // hub restriction appended to queries whose vehicle/hub is aliased
    const hub = (col: string) => (s.all ? '' : ` AND ${col} = ANY($2::uuid[])`);
    const p = (): unknown[] => (s.all ? [org] : [org, s.hubIds]);
    const empty = !s.all && !s.hubIds.length;
    const q = async (sql: string): Promise<any[]> => (empty ? [] : this.ds.query(sql, p()).catch(() => []));
    const items: AttentionItem[] = [];
    const add = (i: AttentionItem) => { if (i.count > 0) items.push(i); };
    const top = (rows: any[], f: (r: any) => { label: string; sub?: string }) => rows.slice(0, 5).map(f);

    // ---- safety and security
    const theft = await q(`SELECT v.plate_number plate, t.status, t.reported_at FROM theft_cases t JOIN vehicles v ON v.id=t.vehicle_id WHERE t.organization_id=$1 AND t.status NOT IN ('resolved','closed','recovered','cancelled')${hub('v.hub_id')} ORDER BY t.reported_at DESC`);
    add({ key: 'theft', severity: 'critical', title: 'Open theft cases', count: theft.length, detail: 'Vehicles reported stolen that are not recovered yet.', link: 'theft-recovery.html', rows: top(theft, (r) => ({ label: r.plate, sub: `${r.status}, reported ${new Date(r.reported_at).toLocaleDateString('en-GB')}` })) });
    const alerts = await q(`SELECT a.title, a.severity, a.created_at, v.plate_number plate FROM alerts a LEFT JOIN vehicles v ON v.id=a.vehicle_id WHERE a.organization_id=$1 AND NOT a.is_resolved AND a.severity IN ('high','critical')${hub('v.hub_id')} ORDER BY a.created_at DESC`);
    add({ key: 'alerts', severity: 'critical', title: 'High-priority alerts not resolved', count: alerts.length, detail: 'Geofence violations, tampering and other serious alerts.', link: 'alerts.html', rows: top(alerts, (r) => ({ label: `${r.plate ? r.plate + ': ' : ''}${r.title}`, sub: new Date(r.created_at).toLocaleString('en-GB') })) });
    const late = await q(`SELECT v.plate_number plate, d.label, d.due_at FROM vehicle_destinations d JOIN vehicles v ON v.id=d.vehicle_id WHERE d.organization_id=$1 AND d.status='active' AND d.due_at IS NOT NULL AND d.due_at < now()${hub('v.hub_id')} ORDER BY d.due_at`);
    add({ key: 'late', severity: 'critical', title: 'Deliveries past their deadline', count: late.length, detail: 'Vehicles that have not arrived by the time they were due.', link: 'live-map.html', rows: top(late, (r) => ({ label: `${r.plate} to ${r.label || 'destination'}`, sub: `due ${new Date(r.due_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` })) });

    // ---- fleet health
    const off = await q(`SELECT v.plate_number plate, d.imei, d.last_communication_at AS last FROM devices d JOIN vehicles v ON v.id=d.vehicle_id WHERE d.organization_id=$1 AND d.is_active AND d.deleted_at IS NULL AND v.deleted_at IS NULL AND v.is_active AND d.status::text <> 'online' AND (d.last_communication_at IS NULL OR d.last_communication_at < now() - interval '24 hours')${hub('v.hub_id')} ORDER BY d.last_communication_at NULLS FIRST`);
    add({ key: 'offline', severity: 'warning', title: 'Trackers silent for over 24 hours', count: off.length, detail: 'May be unplugged, out of credit or tampered with.', link: 'devices.html', rows: top(off, (r) => ({ label: r.plate, sub: r.last ? `last seen ${new Date(r.last).toLocaleString('en-GB')}` : 'never reported' })) });
    const maint = await q(`SELECT v.plate_number plate, m.service_type, m.scheduled_date FROM maintenance m JOIN vehicles v ON v.id=m.vehicle_id WHERE m.organization_id=$1 AND m.status IN ('scheduled','pending','in_progress','open') AND m.scheduled_date < CURRENT_DATE${hub('v.hub_id')} ORDER BY m.scheduled_date`);
    add({ key: 'maintenance', severity: 'warning', title: 'Maintenance overdue', count: maint.length, detail: 'Scheduled service that has passed its date.', link: 'vehicles.html', rows: top(maint, (r) => ({ label: `${r.plate}: ${r.service_type}`, sub: `was due ${String(r.scheduled_date).slice(0, 10)}` })) });
    const docs = await q(`SELECT plate_number plate, kind, due FROM (
        SELECT plate_number, 'Insurance' kind, insurance_expiry::date due, hub_id FROM vehicles WHERE organization_id=$1 AND deleted_at IS NULL AND is_active
        UNION ALL SELECT plate_number, 'Road registration', registration_expiry::date, hub_id FROM vehicles WHERE organization_id=$1 AND deleted_at IS NULL AND is_active
        UNION ALL SELECT plate_number, 'Inspection', inspection_due_date::date, hub_id FROM vehicles WHERE organization_id=$1 AND deleted_at IS NULL AND is_active) x
      WHERE due IS NOT NULL AND due < CURRENT_DATE + 30${hub('hub_id')} ORDER BY due`);
    const expired = docs.filter((d) => new Date(d.due) < new Date(new Date().toDateString()));
    add({ key: 'docs', severity: expired.length ? 'critical' : 'warning', title: 'Insurance, registration or inspection due', count: docs.length, detail: `${expired.length} already expired, the rest within 30 days. Driving uninsured is an offence.`, link: 'vehicles.html', rows: top(docs, (r) => ({ label: `${r.plate}: ${r.kind}`, sub: `${new Date(r.due) < new Date(new Date().toDateString()) ? 'EXPIRED ' : 'expires '}${String(r.due).slice(0, 10)}` })) });
    const bat = await q(`SELECT serial_no, status, health_pct FROM batteries b WHERE b.organization_id=$1 AND (b.status='faulty' OR (b.health_pct IS NOT NULL AND b.health_pct < 70))${hub('b.hub_id')} ORDER BY health_pct NULLS FIRST`);
    add({ key: 'batteries', severity: 'warning', title: 'Batteries faulty or worn out', count: bat.length, detail: 'Health below 70% or marked faulty; they shorten range and risk breakdowns.', link: 'batteries.html', rows: top(bat, (r) => ({ label: r.serial_no, sub: `${r.status}${r.health_pct != null ? `, health ${Math.round(r.health_pct)}%` : ''}` })) });

    // ---- money (finance roles only)
    let moneyBlock: any = null;
    if (money) {
      const imm = await q(`SELECT v.plate_number plate, r.full_name, i.state FROM immobilizer_state i JOIN vehicles v ON v.id=i.vehicle_id LEFT JOIN riders r ON r.id=i.rider_id WHERE v.organization_id=$1 AND i.state IN ('immobilized','warning_sent','payment_failed')${hub('v.hub_id')} ORDER BY i.state`);
      const locked = imm.filter((x) => x.state === 'immobilized');
      add({ key: 'immobilized', severity: 'critical', title: 'Vehicles locked or about to be locked for non-payment', count: imm.length, detail: `${locked.length} locked now; the rest have been warned.`, link: 'enforcement.html', rows: top(imm, (r) => ({ label: `${r.plate}${r.full_name ? ' (' + r.full_name + ')' : ''}`, sub: r.state.replace(/_/g, ' ') })) });
      const owed = await q(`SELECT r.full_name, v.plate_number plate, sum(ds.shortfall_pesewas)::bigint owed FROM daily_settlements ds JOIN riders r ON r.id=ds.rider_id LEFT JOIN vehicles v ON v.id=ds.vehicle_id WHERE ds.organization_id=$1 AND ds.is_current AND ds.shortfall_pesewas > 0 AND ds.settlement_date >= CURRENT_DATE - 30${hub('ds.hub_id')} GROUP BY r.full_name, v.plate_number ORDER BY owed DESC`);
      const totalOwed = owed.reduce((a, r) => a + Number(r.owed), 0);
      add({ key: 'shortfall', severity: 'warning', title: 'Riders with unpaid shortfall (30 days)', count: owed.length, detail: `${ghs(totalOwed)} outstanding in total.`, link: 'settlements.html', rows: top(owed, (r) => ({ label: `${r.full_name}${r.plate ? ' (' + r.plate + ')' : ''}`, sub: ghs(Number(r.owed)) })) });
      const arrears = await q(`SELECT c.contract_no, o.name owner, count(*)::int n, sum(i.amount_pesewas - i.paid_pesewas)::bigint due, max(c.default_after_arrears_days) lim, CURRENT_DATE - min(i.due_date)::date AS days FROM installments i JOIN sale_contracts c ON c.id=i.contract_id LEFT JOIN owners o ON o.id=c.owner_id LEFT JOIN vehicles v ON v.id=c.vehicle_id WHERE c.organization_id=$1 AND c.status='active' AND i.due_date < CURRENT_DATE AND i.paid_pesewas < i.amount_pesewas${hub('v.hub_id')} GROUP BY c.contract_no, o.name ORDER BY days DESC`).catch(() => []);
      add({ key: 'arrears', severity: arrears.some((a) => a.lim && a.days >= a.lim) ? 'critical' : 'warning', title: 'Sale contracts in arrears', count: arrears.length, detail: 'Instalments past their due date.', link: 'contracts.html', rows: top(arrears, (r) => ({ label: `${r.contract_no}${r.owner ? ' (' + r.owner + ')' : ''}`, sub: `${ghs(Number(r.due))} overdue, oldest ${r.days} days${r.lim && r.days >= r.lim ? ', past default limit' : ''}` })) });
      const missing = await q(`SELECT r.full_name, v.plate_number plate FROM rider_assignments a JOIN riders r ON r.id=a.rider_id JOIN vehicles v ON v.id=a.vehicle_id WHERE a.organization_id=$1 AND a.status='active' AND a.daily_remittance_pesewas > 0 AND NOT EXISTS (SELECT 1 FROM daily_settlements ds WHERE ds.rider_id=a.rider_id AND ds.is_current AND ds.settlement_date = CURRENT_DATE - 1)${hub('v.hub_id')} ORDER BY r.full_name`);
      add({ key: 'unsettled', severity: 'info', title: "Yesterday's collections not settled", count: missing.length, detail: 'Active riders with no settlement recorded for yesterday.', link: 'settlements.html', rows: top(missing, (r) => ({ label: r.full_name, sub: r.plate })) });
      const ser = await q(`SELECT d::date AS day, coalesce(sum(ds.remittance_due_pesewas),0)::bigint due, coalesce(sum(ds.remittance_paid_pesewas),0)::bigint paid, coalesce(sum(ds.shortfall_pesewas),0)::bigint short FROM generate_series(CURRENT_DATE - 13, CURRENT_DATE, interval '1 day') d LEFT JOIN daily_settlements ds ON ds.settlement_date = d::date AND ds.organization_id=$1 AND ds.is_current${hub('ds.hub_id')} GROUP BY d ORDER BY d`);
      const sum = (rows: any[], f: string) => rows.reduce((a, r) => a + Number(r[f]), 0);
      const cur = ser.slice(7), prev = ser.slice(0, 7);
      moneyBlock = {
        series: ser.map((r) => ({ date: String(r.day instanceof Date ? r.day.toISOString() : r.day).slice(0, 10), due: Number(r.due), paid: Number(r.paid), shortfall: Number(r.short) })),
        paidWeek: sum(cur, 'paid'), paidPrevWeek: sum(prev, 'paid'), dueWeek: sum(cur, 'due'), dueEarlier: sum(prev, 'due'),
        collectionRatePct: sum(cur, 'due') > 0 ? Math.round((sum(cur, 'paid') / sum(cur, 'due')) * 100) : null,
        changePct: sum(prev, 'paid') > 0 ? Math.round(((sum(cur, 'paid') - sum(prev, 'paid')) / sum(prev, 'paid')) * 100) : null,
        outstandingShortfall: totalOwed,
      };
    }

    // ---- fleet numbers
    const fleetRows = await q(`SELECT lifecycle_status AS st, count(*)::int n FROM vehicles v WHERE v.organization_id=$1 AND v.deleted_at IS NULL${hub('v.hub_id')} GROUP BY 1`);
    const assigned = (await q(`SELECT count(DISTINCT a.vehicle_id)::int n FROM rider_assignments a JOIN vehicles v ON v.id=a.vehicle_id WHERE a.organization_id=$1 AND a.status='active'${hub('v.hub_id')}`))[0]?.n ?? 0;
    const totalVeh = fleetRows.reduce((a, r) => a + r.n, 0);
    const retired = fleetRows.filter((r) => ['retired', 'written_off', 'stolen'].includes(r.st)).reduce((a, r) => a + r.n, 0);
    const usable = totalVeh - retired;
    const fleet = { total: totalVeh, usable, assigned, idleUnassigned: Math.max(0, usable - assigned), utilisationPct: usable ? Math.round((assigned / usable) * 100) : null, byStatus: Object.fromEntries(fleetRows.map((r) => [r.st ?? 'unknown', r.n])) };

    const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
    items.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);
    return {
      generatedAt: new Date().toISOString(),
      summary: { critical: items.filter((i) => i.severity === 'critical').length, warning: items.filter((i) => i.severity === 'warning').length, info: items.filter((i) => i.severity === 'info').length },
      items, money: moneyBlock, fleet,
    };
  }
}
