import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthUser } from '../../common/auth/auth-user';
import { MapScopeService } from '../map/map-scope.service';
import { isWorkTime } from '../map/engines/geo.engine';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 86_400_000;
const MAX_POINTS = 150_000;

export type EventKind = 'trip' | 'alert' | 'maintenance' | 'rider' | 'battery' | 'collection' | 'lock' | 'zone' | 'task' | 'theft' | 'contract' | 'device' | 'record';
export interface HistoryEvent { id: string; kind: EventKind; at: string; title: string; detail?: string; severity?: 'info' | 'good' | 'warning' | 'critical'; amountPesewas?: number }
interface Pt { t: number; lat: number; lng: number; speed: number }

const hav = (a: Pt, b: Pt) => {
  const R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
};
const iso = (d: any) => (d ? new Date(d).toISOString() : '');
const money = (p: any) => `GH₵ ${(Number(p || 0) / 100).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const label = (s: string) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Everything one vehicle has done and had done to it: a unified timeline plus an analysis of the period. */
@Injectable()
export class VehicleHistoryService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectDataSource('timescale') private readonly ts: DataSource,
    private readonly scope: MapScopeService,
  ) {}

  /** The vehicle, only if it is in the caller's organisation and hub scope. */
  private async vehicle(user: AuthUser, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Vehicle not found');
    const [v] = await this.ds.query(
      `SELECT v.*, h.name AS hub_name, o.name AS owner_name FROM vehicles v LEFT JOIN hubs h ON h.id=v.hub_id LEFT JOIN owners o ON o.id=v.owner_id WHERE v.id=$1 AND v.organization_id=$2`, [id, user.organizationId]);
    if (!v) throw new NotFoundException('Vehicle not found');
    const s = await this.scope.hubScope(user);
    if (!s.all && (!v.hub_id || !s.hubIds.includes(v.hub_id))) throw new NotFoundException('Vehicle not found');
    return v;
  }

  private range(q: { days?: string; from?: string; to?: string }) {
    let to = q.to ? new Date(q.to) : new Date();
    let from = q.from ? new Date(q.from) : new Date(to.getTime() - (Number(q.days) || 30) * DAY);
    if (isNaN(+from) || isNaN(+to)) throw new BadRequestException('from/to must be valid dates');
    if (to < from) [from, to] = [to, from];
    if (to.getTime() - from.getTime() > 400 * DAY) throw new BadRequestException('A history range can be at most 400 days');
    return { from, to };
  }

  /** Position points for the vehicle's devices, with driver-privacy applied (nothing outside working hours). */
  private async points(user: AuthUser, vehicleId: string, from: Date, to: Date): Promise<{ pts: Pt[]; truncated: boolean }> {
    const devs: { device_id: string }[] = await this.ds.query(
      `SELECT device_id FROM vehicle_devices WHERE vehicle_id=$1 UNION SELECT id FROM devices WHERE vehicle_id=$1 AND organization_id=$2`, [vehicleId, user.organizationId]);
    const ids = devs.map((d) => d.device_id);
    if (!ids.length) return { pts: [], truncated: false };
    const rows: any[] = await this.ts.query(
      `SELECT latitude, longitude, speed, "timestamp" FROM positions WHERE device_id = ANY($1::uuid[]) AND "timestamp" BETWEEN $2 AND $3 ORDER BY "timestamp" ASC LIMIT ${MAX_POINTS + 1}`, [ids, from, to]);
    const truncated = rows.length > MAX_POINTS; if (truncated) rows.length = MAX_POINTS;
    const cfg = (await this.scope.privacy(user.organizationId)).get(vehicleId);
    const pts: Pt[] = [];
    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      if (cfg && !isWorkTime(cfg, new Date(t))) continue; // driver privacy: off-duty movement is never shown
      pts.push({ t, lat: Number(r.latitude), lng: Number(r.longitude), speed: Number(r.speed) || 0 });
    }
    return { pts, truncated };
  }

  private drive(pts: Pt[], from: number, to: number) {
    let km = 0, movingMs = 0, idleMs = 0, maxSpeed = 0, speedSum = 0, speedN = 0;
    const perDay = new Map<string, { km: number; movingMin: number; maxSpeed: number }>();
    const byHour = new Array(24).fill(0);
    const day = (t: number) => new Date(t).toISOString().slice(0, 10);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], dt = b.t - a.t;
      if (b.t < from || b.t > to || dt <= 0 || dt > 10 * 60_000) continue; // a gap means the tracker was off, not that the vehicle moved
      const d = hav(a, b);
      if (d / (dt / 3_600_000) > 160) continue; // a GPS jump, not a movement
      const moving = b.speed > 3 || d / (dt / 3_600_000) > 3;
      const e = perDay.get(day(b.t)) ?? { km: 0, movingMin: 0, maxSpeed: 0 };
      if (moving) { km += d; movingMs += dt; e.km += d; e.movingMin += dt / 60_000; byHour[new Date(b.t).getUTCHours()] += dt / 60_000; speedSum += b.speed; speedN++; }
      else idleMs += dt;
      if (b.speed > maxSpeed) maxSpeed = b.speed;
      if (b.speed > e.maxSpeed) e.maxSpeed = b.speed;
      perDay.set(day(b.t), e);
    }
    return { km, movingMs, idleMs, maxSpeed, avgSpeed: speedN ? speedSum / speedN : 0, perDay, byHour };
  }

  /** Summary, analysis and plain-language findings for a period. */
  async analysis(user: AuthUser, id: string, q: { days?: string; from?: string; to?: string }) {
    const v = await this.vehicle(user, id);
    const { from, to } = this.range(q);
    const span = to.getTime() - from.getTime(), prevFrom = new Date(from.getTime() - span);
    const org = user.organizationId, F = from, T = to;

    const [{ pts, truncated }, trips, alerts, maint, swaps, locks, zones, tasks, coll, riders, contract, devices, battery, theft] = await Promise.all([
      this.points(user, id, prevFrom, to),
      this.ds.query(`SELECT count(*)::int n, COALESCE(sum(distance),0)::float km, COALESCE(max(max_speed),0)::float maxs FROM trips WHERE vehicle_id=$1 AND start_time BETWEEN $2 AND $3`, [id, F, T]),
      this.ds.query(`SELECT type, severity, count(*)::int n, count(*) FILTER (WHERE NOT is_resolved)::int open FROM alerts WHERE vehicle_id=$1 AND organization_id=$2 AND created_at BETWEEN $3 AND $4 GROUP BY 1,2`, [id, org, F, T]),
      this.ds.query(`SELECT count(*)::int n, count(*) FILTER (WHERE status='completed')::int done, COALESCE(sum(cost),0)::float cost FROM maintenance WHERE vehicle_id=$1 AND organization_id=$2 AND COALESCE(completed_date, scheduled_date) BETWEEN $3::date AND $4::date`, [id, org, F, T]),
      this.ds.query(`SELECT count(*)::int n FROM battery_swaps WHERE vehicle_id=$1 AND organization_id=$2 AND swapped_at BETWEEN $3 AND $4`, [id, org, F, T]),
      this.ds.query(`SELECT kind, status, count(*)::int n FROM lock_requests WHERE vehicle_id=$1 AND organization_id=$2 AND created_at BETWEEN $3 AND $4 GROUP BY 1,2`, [id, org, F, T]),
      this.ds.query(`SELECT event_type, count(*)::int n FROM geofence_events WHERE vehicle_id=$1 AND timestamp BETWEEN $2 AND $3 GROUP BY 1`, [id, F, T]),
      this.ds.query(`SELECT status, count(*)::int n FROM task_runs WHERE vehicle_id=$1 AND organization_id=$2 AND triggered_at BETWEEN $3 AND $4 GROUP BY 1`, [id, org, F, T]),
      this.ds.query(`SELECT collection_date::text d, COALESCE(sum(amount_pesewas),0)::float amt FROM daily_collections WHERE vehicle_id=$1 AND organization_id=$2 AND collection_date BETWEEN $3::date AND $4::date GROUP BY 1`, [id, org, F, T]),
      this.ds.query(`SELECT ra.id, ra.start_date, ra.end_date, ra.status, r.full_name FROM rider_assignments ra JOIN riders r ON r.id=ra.rider_id WHERE ra.vehicle_id=$1 AND ra.organization_id=$2 ORDER BY ra.start_date DESC LIMIT 20`, [id, org]),
      this.ds.query(`SELECT c.id, c.contract_no, c.status, c.mode, c.price_pesewas, o.name owner FROM sale_contracts c LEFT JOIN owners o ON o.id=c.owner_id WHERE c.vehicle_id=$1 AND c.organization_id=$2 ORDER BY c.created_at DESC LIMIT 1`, [id, org]),
      this.ds.query(`SELECT d.id, d.imei, d.name, d.status, d.battery_level, d.last_communication_at, vd.role FROM vehicle_devices vd JOIN devices d ON d.id=vd.device_id WHERE vd.vehicle_id=$1 AND vd.is_active UNION SELECT d.id, d.imei, d.name, d.status, d.battery_level, d.last_communication_at, 'primary' FROM devices d WHERE d.vehicle_id=$1 AND d.organization_id=$2 AND NOT EXISTS (SELECT 1 FROM vehicle_devices x WHERE x.device_id=d.id AND x.vehicle_id=$1 AND x.is_active)`, [id, org]),
      this.ds.query(`SELECT serial_no, health_pct, cycle_count, status FROM batteries WHERE current_vehicle_id=$1 AND organization_id=$2 LIMIT 1`, [id, org]),
      this.ds.query(`SELECT count(*)::int n FROM theft_cases WHERE vehicle_id=$1 AND organization_id=$2`, [id, org]),
    ]);

    const cur = this.drive(pts, F.getTime(), T.getTime()), prev = this.drive(pts, prevFrom.getTime(), F.getTime());
    const days = Math.max(1, Math.round(span / DAY)), calDays = Math.floor((Date.UTC(T.getUTCFullYear(), T.getUTCMonth(), T.getUTCDate()) - Date.UTC(F.getUTCFullYear(), F.getUTCMonth(), F.getUTCDate())) / DAY) + 1;
    const collMap = new Map<string, number>(coll.map((c: any) => [c.d, c.amt]));
    const dailyRows: { date: string; km: number; movingMin: number; maxSpeed: number; collected: number }[] = [];
    const d0 = Date.UTC(F.getUTCFullYear(), F.getUTCMonth(), F.getUTCDate()), d1 = Date.UTC(T.getUTCFullYear(), T.getUTCMonth(), T.getUTCDate());
    for (let t = d0; t <= d1; t += DAY) {
      const d = new Date(t).toISOString().slice(0, 10), e = cur.perDay.get(d);
      dailyRows.push({ date: d, km: +(e?.km ?? 0).toFixed(1), movingMin: Math.round(e?.movingMin ?? 0), maxSpeed: Math.round(e?.maxSpeed ?? 0), collected: collMap.get(d) ?? 0 });
    }
    const activeDays = dailyRows.filter((d) => d.km >= 0.5).length;
    const alertTotal = alerts.reduce((s: number, a: any) => s + a.n, 0), alertHigh = alerts.filter((a: any) => ['high', 'critical'].includes(a.severity)).reduce((s: number, a: any) => s + a.n, 0);
    const collected = coll.reduce((s: number, c: any) => s + c.amt, 0);
    const taskDone = tasks.find((t: any) => t.status === 'completed')?.n ?? 0, taskAll = tasks.reduce((s: number, t: any) => s + t.n, 0);
    const lastPoint = pts.length ? pts[pts.length - 1].t : null;
    const lastMove = [...dailyRows].reverse().find((d) => d.km >= 0.5)?.date ?? null;
    const km = +cur.km.toFixed(1), prevKm = +prev.km.toFixed(1);
    const kmChangePct = prevKm > 0 ? Math.round(((km - prevKm) / prevKm) * 100) : null;

    // Plain-language findings, most urgent first.
    const insights: { level: 'critical' | 'warning' | 'info' | 'good'; text: string }[] = [];
    const dayLeft = (d: any) => (d ? Math.ceil((new Date(d).getTime() - Date.now()) / DAY) : null);
    for (const [name, d] of [['Insurance', v.insurance_expiry], ['Registration', v.registration_expiry], ['Inspection', v.inspection_due_date]] as const) {
      const n = dayLeft(d); if (n !== null && n < 0) insights.push({ level: 'critical', text: `${name} expired ${-n} day${-n === 1 ? '' : 's'} ago.` }); else if (n !== null && n <= 30) insights.push({ level: 'warning', text: `${name} runs out in ${n} day${n === 1 ? '' : 's'}.` });
    }
    if (theft[0]?.n) insights.push({ level: 'critical', text: `This vehicle has ${theft[0].n} theft case${theft[0].n === 1 ? '' : 's'} on record.` });
    if (alertHigh) insights.push({ level: 'warning', text: `${alertHigh} serious alert${alertHigh === 1 ? '' : 's'} in this period${alerts.some((a: any) => a.open) ? ', some still open' : ''}.` });
    if (activeDays === 0 && v.lifecycle_status !== 'in_stock' && v.lifecycle_status !== 'retired') insights.push({ level: 'warning', text: lastMove ? `No movement in this period. It last moved on ${lastMove}.` : 'No movement recorded in this period.' });
    if (kmChangePct !== null && Math.abs(kmChangePct) >= 25) insights.push({ level: kmChangePct < 0 ? 'warning' : 'info', text: `Distance is ${Math.abs(kmChangePct)}% ${kmChangePct < 0 ? 'lower' : 'higher'} than the period before (${prevKm} km → ${km} km).` });
    if (cur.maxSpeed > 70) insights.push({ level: 'warning', text: `Top speed reached ${Math.round(cur.maxSpeed)} km/h.` });
    if (battery[0] && Number(battery[0].health_pct) < 70) insights.push({ level: 'warning', text: `Fitted battery ${battery[0].serial_no} is at ${Math.round(battery[0].health_pct)}% health.` });
    if (maint[0].n && maint[0].done < maint[0].n) insights.push({ level: 'info', text: `${maint[0].n - maint[0].done} maintenance job${maint[0].n - maint[0].done === 1 ? '' : 's'} not completed yet.` });
    if (km > 0 && collected > 0) insights.push({ level: 'good', text: `Collected ${money(collected)} over ${km} km (${money(collected / km)} per km).` });
    if (!insights.length) insights.push({ level: 'good', text: 'Nothing needs attention for this vehicle in this period.' });
    const rank = { critical: 0, warning: 1, info: 2, good: 3 }; insights.sort((a, b) => rank[a.level] - rank[b.level]);

    return {
      vehicle: {
        id: v.id, plateNumber: v.plate_number, make: v.make, model: v.model, year: v.year, color: v.color, fuelType: v.fuel_type, vin: v.vin, chassisNo: v.chassis_no, motorNo: v.motor_no,
        lifecycleStatus: v.lifecycle_status, isActive: v.is_active, odometer: v.odometer == null ? null : Number(v.odometer), hubId: v.hub_id, hubName: v.hub_name, ownerName: v.owner_name,
        registeredAt: iso(v.created_at), insuranceExpiry: v.insurance_expiry, registrationExpiry: v.registration_expiry, inspectionDue: v.inspection_due_date,
        currentRider: riders.find((r: any) => r.status === 'active')?.full_name ?? null,
      },
      contract: contract[0] ? { id: contract[0].id, contractNo: contract[0].contract_no, status: contract[0].status, mode: contract[0].mode, owner: contract[0].owner, pricePesewas: Number(contract[0].price_pesewas) } : null,
      devices: devices.map((d: any) => ({ id: d.id, imei: d.imei, name: d.name, status: d.status, batteryLevel: d.battery_level, lastSeen: iso(d.last_communication_at), role: d.role })),
      battery: battery[0] ? { serialNo: battery[0].serial_no, healthPct: battery[0].health_pct == null ? null : Number(battery[0].health_pct), cycles: battery[0].cycle_count, status: battery[0].status } : null,
      riders: riders.map((r: any) => ({ name: r.full_name, from: r.start_date, to: r.end_date, status: r.status })),
      range: { from: F.toISOString(), to: T.toISOString(), days },
      privacy: (await this.scope.privacy(org)).has(id),
      truncated,
      totals: {
        distanceKm: km, previousDistanceKm: prevKm, distanceChangePct: kmChangePct,
        movingHours: +(cur.movingMs / 3_600_000).toFixed(1), idleHours: +(cur.idleMs / 3_600_000).toFixed(1),
        avgSpeedKmh: Math.round(cur.avgSpeed), maxSpeedKmh: Math.round(cur.maxSpeed),
        activeDays, utilisationPct: Math.round((activeDays / calDays) * 100), avgKmPerActiveDay: activeDays ? +(km / activeDays).toFixed(1) : 0,
        trips: trips[0].n, lastSeenAt: lastPoint ? new Date(lastPoint).toISOString() : null, lastMovedOn: lastMove,
        collectedPesewas: collected, collectedPerKmPesewas: km > 0 ? Math.round(collected / km) : 0,
        alerts: alertTotal, highAlerts: alertHigh, openAlerts: alerts.reduce((s: number, a: any) => s + a.open, 0),
        maintenanceJobs: maint[0].n, maintenanceCost: maint[0].cost, batterySwaps: swaps[0].n,
        locks: locks.filter((l: any) => l.kind === 'lock').reduce((s: number, l: any) => s + l.n, 0), unlocks: locks.filter((l: any) => l.kind === 'unlock').reduce((s: number, l: any) => s + l.n, 0),
        zoneEntries: zones.filter((z: any) => ['enter', 'entry'].includes(z.event_type)).reduce((n: number, z: any) => n + z.n, 0), zoneExits: zones.find((z: any) => z.event_type === 'exit')?.n ?? 0,
        tasksDone: taskDone, tasksTotal: taskAll,
      },
      daily: dailyRows,
      hourlyMovingMin: cur.byHour.map((m: number) => Math.round(m)),
      alertsByType: Object.values(alerts.reduce((m: any, a: any) => { (m[a.type] ??= { type: a.type, count: 0 }).count += a.n; return m; }, {})).sort((a: any, b: any) => b.count - a.count).slice(0, 8),
      insights,
    };
  }

  /** The route driven in the period as a thinned polyline, with driver privacy applied. */
  async route(user: AuthUser, id: string, q: { days?: string; from?: string; to?: string }) {
    await this.vehicle(user, id);
    const { from, to } = this.range(q);
    const { pts } = await this.points(user, id, from, to);
    const step = Math.max(1, Math.ceil(pts.length / 1200));
    const segments: [number, number][][] = []; let cur: [number, number][] = [], last: Pt | null = null;
    for (let i = 0; i < pts.length; i += step) {
      const p = pts[i];
      if (last && p.t - last.t > 10 * 60_000 * step) { if (cur.length > 1) segments.push(cur); cur = []; }
      cur.push([+p.lat.toFixed(5), +p.lng.toFixed(5)]); last = p;
    }
    if (cur.length > 1) segments.push(cur);
    return { segments, from: from.toISOString(), to: to.toISOString() };
  }

  /** One chronological list of everything that happened to or with the vehicle (newest first). */
  async events(user: AuthUser, id: string, q: { days?: string; from?: string; to?: string; before?: string; types?: string; limit?: string }) {
    const v = await this.vehicle(user, id);
    const { from, to } = this.range(q);
    const before = q.before ? new Date(q.before) : to; if (isNaN(+before)) throw new BadRequestException('before must be a date');
    const limit = Math.min(Math.max(parseInt(q.limit || '50', 10) || 50, 1), 200);
    const want = new Set((q.types || '').split(',').map((s) => s.trim()).filter(Boolean));
    const on = (k: EventKind) => !want.size || want.has(k);
    const org = user.organizationId, F = from, B = before, N = limit + 1;
    const out: HistoryEvent[] = [];
    const run = async (kind: EventKind, sql: string, params: any[], map: (r: any) => HistoryEvent | HistoryEvent[]) => {
      if (!on(kind)) return;
      const rows: any[] = await this.ds.query(sql, params);
      for (const r of rows) { const m = map(r); (Array.isArray(m) ? m : [m]).forEach((e) => out.push(e)); }
    };
    await Promise.all([
      run('trip', `SELECT id, start_time, end_time, distance::float km, duration::float dur, max_speed::float maxs, stop_count FROM trips WHERE vehicle_id=$1 AND start_time > $2 AND start_time < $3 ORDER BY start_time DESC LIMIT ${N}`, [id, F, B],
        (r) => ({ id: 'trip-' + r.id, kind: 'trip', at: iso(r.start_time), title: `Trip of ${(r.km || 0).toFixed(1)} km`, detail: `${Math.round((r.dur || 0) / 60)} min, top speed ${Math.round(r.maxs || 0)} km/h${r.stop_count ? `, ${r.stop_count} stops` : ''}`, severity: 'info' })),
      run('alert', `SELECT id, type, severity, title, description, created_at, is_resolved, resolved_at FROM alerts WHERE vehicle_id=$1 AND organization_id=$2 AND created_at > $3 AND created_at < $4 ORDER BY created_at DESC LIMIT ${N}`, [id, org, F, B],
        (r) => ({ id: 'alert-' + r.id, kind: 'alert', at: iso(r.created_at), title: r.title || label(r.type), detail: `${label(r.severity)} alert${r.is_resolved ? ', resolved' : ', still open'}${r.description ? `. ${String(r.description).slice(0, 140)}` : ''}`, severity: ['high', 'critical'].includes(r.severity) ? 'critical' : r.severity === 'medium' ? 'warning' : 'info' })),
      run('maintenance', `SELECT id, service_type, status, priority, description, scheduled_date, completed_date, cost::float cost, vendor_name, created_at FROM maintenance WHERE vehicle_id=$1 AND organization_id=$2 AND COALESCE(completed_date, scheduled_date, created_at::date) > $3::date AND COALESCE(completed_date, scheduled_date, created_at::date) < $4::date ORDER BY COALESCE(completed_date, scheduled_date) DESC LIMIT ${N}`, [id, org, F, B],
        (r) => ({ id: 'maint-' + r.id, kind: 'maintenance', at: iso(r.completed_date || r.scheduled_date || r.created_at), title: `${label(r.service_type)} ${r.status === 'completed' ? 'done' : r.status === 'overdue' ? 'overdue' : 'planned'}`, detail: [r.description, r.cost ? `Cost ${money(r.cost * 100)}` : '', r.vendor_name].filter(Boolean).join(' · '), severity: r.status === 'overdue' ? 'warning' : r.status === 'completed' ? 'good' : 'info' })),
      run('rider', `SELECT ra.id, ra.start_date, ra.end_date, ra.status, ra.ended_reason, r.full_name FROM rider_assignments ra JOIN riders r ON r.id=ra.rider_id WHERE ra.vehicle_id=$1 AND ra.organization_id=$2 ORDER BY ra.start_date DESC LIMIT 100`, [id, org],
        (r) => { const ev: HistoryEvent[] = [{ id: 'ra-s-' + r.id, kind: 'rider', at: iso(r.start_date), title: `Given to ${r.full_name}`, detail: 'Rider assignment started', severity: 'info' }]; if (r.end_date) ev.push({ id: 'ra-e-' + r.id, kind: 'rider', at: iso(r.end_date), title: `Returned by ${r.full_name}`, detail: r.ended_reason ? label(r.ended_reason) : 'Rider assignment ended', severity: 'info' }); return ev; }),
      run('battery', `SELECT s.id, s.swapped_at, bi.serial_no sin, bo.serial_no sout, r.full_name FROM battery_swaps s LEFT JOIN batteries bi ON bi.id=s.battery_in_id LEFT JOIN batteries bo ON bo.id=s.battery_out_id LEFT JOIN riders r ON r.id=s.rider_id WHERE s.vehicle_id=$1 AND s.organization_id=$2 AND s.swapped_at > $3 AND s.swapped_at < $4 ORDER BY s.swapped_at DESC LIMIT ${N}`, [id, org, F, B],
        (r) => ({ id: 'swap-' + r.id, kind: 'battery', at: iso(r.swapped_at), title: `Battery swapped${r.sin ? ` to ${r.sin}` : ''}`, detail: [r.sout ? `Removed ${r.sout}` : '', r.full_name ? `by ${r.full_name}` : ''].filter(Boolean).join(' ') })),
      run('collection', `SELECT c.id, c.collection_date, c.amount_pesewas::float amt, c.source, r.full_name FROM daily_collections c LEFT JOIN riders r ON r.id=c.rider_id WHERE c.vehicle_id=$1 AND c.organization_id=$2 AND c.collection_date > $3::date AND c.collection_date < $4::date ORDER BY c.collection_date DESC LIMIT ${N}`, [id, org, F, B],
        (r) => ({ id: 'col-' + r.id, kind: 'collection', at: iso(r.collection_date), title: `Collected ${money(r.amt)}`, detail: [r.full_name ? `from ${r.full_name}` : '', r.source ? label(r.source) : ''].filter(Boolean).join(' · '), severity: 'good', amountPesewas: r.amt })),
      run('lock', `SELECT id, kind, status, reason, created_at, decided_at FROM lock_requests WHERE vehicle_id=$1 AND organization_id=$2 AND created_at > $3 AND created_at < $4 ORDER BY created_at DESC LIMIT ${N}`, [id, org, F, B],
        (r) => ({ id: 'lock-' + r.id, kind: 'lock', at: iso(r.created_at), title: `${r.kind === 'unlock' ? 'Unlock' : 'Lock'} request ${label(r.status).toLowerCase()}`, detail: r.reason ? String(r.reason).slice(0, 160) : undefined, severity: r.kind === 'lock' ? 'warning' : 'info' })),
      run('lock', `SELECT id, state, immobilized_at, unlocked_at, unlock_reason, trigger_source FROM immobilizer_state WHERE vehicle_id=$1 AND COALESCE(immobilized_at, created_at) > $2 AND COALESCE(immobilized_at, created_at) < $3 ORDER BY COALESCE(immobilized_at, created_at) DESC LIMIT ${N}`, [id, F, B],
        (r) => { const ev: HistoryEvent[] = []; if (r.immobilized_at) ev.push({ id: 'imm-' + r.id, kind: 'lock', at: iso(r.immobilized_at), title: 'Vehicle immobilised', detail: r.trigger_source ? `Started by ${label(r.trigger_source).toLowerCase()}` : undefined, severity: 'critical' }); if (r.unlocked_at) ev.push({ id: 'unl-' + r.id, kind: 'lock', at: iso(r.unlocked_at), title: 'Vehicle unlocked', detail: r.unlock_reason || undefined, severity: 'good' }); return ev; }),
      run('zone', `SELECT e.id, e.event_type, e.timestamp, e.dwell_time, g.name FROM geofence_events e LEFT JOIN geofences g ON g.id=e.geofence_id WHERE e.vehicle_id=$1 AND (g.organization_id=$2 OR g.id IS NULL) AND e.timestamp > $3 AND e.timestamp < $4 ORDER BY e.timestamp DESC LIMIT ${N}`, [id, org, F, B],
        (r) => ({ id: 'zone-' + r.id, kind: 'zone', at: iso(r.timestamp), title: `${r.event_type === 'exit' ? 'Left' : ['enter', 'entry'].includes(r.event_type) ? 'Entered' : label(r.event_type)} ${r.name || 'a zone'}`, detail: r.dwell_time ? `Stayed ${Math.round(r.dwell_time / 60)} min` : undefined })),
      run('task', `SELECT id, title, status, geofence_name, triggered_at, completed_at FROM task_runs WHERE vehicle_id=$1 AND organization_id=$2 AND triggered_at > $3 AND triggered_at < $4 ORDER BY triggered_at DESC LIMIT ${N}`, [id, org, F, B],
        (r) => ({ id: 'task-' + r.id, kind: 'task', at: iso(r.completed_at || r.triggered_at), title: `${r.title || 'Checklist'} ${r.status === 'completed' ? 'completed' : r.status}`, detail: r.geofence_name ? `At ${r.geofence_name}` : undefined, severity: r.status === 'completed' ? 'good' : r.status === 'expired' ? 'warning' : 'info' })),
      run('theft', `SELECT id, status, reported_at, police_reference, resolved_at, resolution_notes FROM theft_cases WHERE vehicle_id=$1 AND organization_id=$2 ORDER BY reported_at DESC LIMIT 20`, [id, org],
        (r) => { const ev: HistoryEvent[] = [{ id: 'th-' + r.id, kind: 'theft', at: iso(r.reported_at), title: 'Reported stolen', detail: r.police_reference ? `Police ref ${r.police_reference}` : undefined, severity: 'critical' }]; if (r.resolved_at) ev.push({ id: 'thr-' + r.id, kind: 'theft', at: iso(r.resolved_at), title: 'Theft case closed', detail: r.resolution_notes || undefined, severity: 'good' }); return ev; }),
      run('contract', `SELECT id, contract_no, mode, status, created_at, activated_at, closed_at FROM sale_contracts WHERE vehicle_id=$1 AND organization_id=$2 ORDER BY created_at DESC LIMIT 20`, [id, org],
        (r) => { const ev: HistoryEvent[] = [{ id: 'c-' + r.id, kind: 'contract', at: iso(r.created_at), title: `Contract ${r.contract_no} drawn up`, detail: label(r.mode) }]; if (r.activated_at) ev.push({ id: 'ca-' + r.id, kind: 'contract', at: iso(r.activated_at), title: `Contract ${r.contract_no} started`, severity: 'good' }); if (r.closed_at) ev.push({ id: 'cc-' + r.id, kind: 'contract', at: iso(r.closed_at), title: `Contract ${r.contract_no} ${r.status}`, severity: r.status === 'completed' ? 'good' : 'warning' }); return ev; }),
      run('device', `SELECT vd.id, vd.role, vd.installed_at, vd.removed_at, d.imei, d.name FROM vehicle_devices vd JOIN devices d ON d.id=vd.device_id WHERE vd.vehicle_id=$1 ORDER BY vd.installed_at DESC LIMIT 40`, [id],
        (r) => { const ev: HistoryEvent[] = []; if (r.installed_at) ev.push({ id: 'di-' + r.id, kind: 'device', at: iso(r.installed_at), title: `Tracker fitted: ${r.name || r.imei}`, detail: label(r.role) }); if (r.removed_at) ev.push({ id: 'dr-' + r.id, kind: 'device', at: iso(r.removed_at), title: `Tracker removed: ${r.name || r.imei}`, severity: 'warning' }); return ev; }),
      run('record', `SELECT a.id, a.action, a.created_at, a.old_values, a.new_values, u.email FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.organization_id=$1 AND a.resource_id=$2 AND a.resource_type IN ('vehicle','vehicles') AND a.created_at > $3 AND a.created_at < $4 ORDER BY a.created_at DESC LIMIT ${N}`, [org, id, F, B],
        (r) => { const keys = r.new_values && typeof r.new_values === 'object' ? Object.keys(r.new_values).filter((k) => !['updatedAt', 'updated_at'].includes(k)).slice(0, 6) : []; return { id: 'au-' + r.id, kind: 'record', at: iso(r.created_at), title: `Record ${String(r.action).toLowerCase().includes('creat') ? 'created' : String(r.action).toLowerCase().includes('delet') ? 'deleted' : 'changed'}`, detail: [keys.length ? `Fields: ${keys.join(', ')}` : '', r.email ? `by ${r.email}` : ''].filter(Boolean).join(' · ') }; }),
    ]);
    if (on('record') && v.created_at && new Date(v.created_at) > F && new Date(v.created_at) < B) out.push({ id: 'reg-' + id, kind: 'record', at: iso(v.created_at), title: 'Vehicle registered in V-Track', severity: 'good' });

    const cfg = (await this.scope.privacy(org)).get(id);
    const hidden = (e: HistoryEvent) => !!cfg && (e.kind === 'trip' || e.kind === 'zone') && !isWorkTime(cfg, new Date(e.at));
    const all = out.filter((e) => e.at && new Date(e.at) > F && new Date(e.at) < B && !hidden(e)).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    const page = all.slice(0, limit);
    return { events: page, next: all.length > limit ? page[page.length - 1].at : null, kinds: [...new Set(all.map((e) => e.kind))] };
  }
}
