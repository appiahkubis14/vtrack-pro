import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Interval } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { AuthUser } from '../../common/auth/auth-user';
import { haversineDistanceMeters } from '../../helpers/geo.helper';
import { MapScopeService } from './map-scope.service';
import { MatchService } from './match.service';
import { distanceToLine, isWorkTime, thin } from './engines/geo.engine';
import { estimateEta } from './engines/track.engine';
import { profileFor, Priority, scoreRoutes } from './engines/route-advice.engine';
import { normalizeTelemetry } from './engines/telemetry.engine';

const ARRIVE_M = 80, OFF_ROUTE_M = 250;
const rowsOf = (res: any): any[] => (Array.isArray(res) && res.length === 2 && Array.isArray(res[0]) && typeof res[1] === 'number' ? res[0] : res);

/**
 * Dispatch: watches every active destination once a minute (arrival, leaving the planned road route, new ETA, risk of missing the
 * deadline), tells the customer when the ETA moves, and answers "which route" and "who else could take this job".
 */
@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);
  private running = false;
  private readonly offlineMs = Number(process.env.MAP_OFFLINE_MINUTES ?? 10) * 60_000;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectDataSource('timescale') private readonly ts: DataSource,
    private readonly scope: MapScopeService,
    private readonly match: MatchService,
  ) {}

  // ------------------------------------------------------------------ helpers
  private async latest(vehicleIds: string[]): Promise<Map<string, any>> {
    const out = new Map<string, any>(); if (!vehicleIds.length) return out;
    const devs: { id: string; vehicle_id: string }[] = await this.ds.query(`SELECT id, vehicle_id FROM devices WHERE vehicle_id = ANY($1::uuid[]) AND deleted_at IS NULL`, [vehicleIds]);
    if (!devs.length) return out;
    const pos: any[] = await this.ts.query(
      `SELECT p.* FROM unnest($1::uuid[]) AS dev(id) CROSS JOIN LATERAL (SELECT device_id, latitude, longitude, speed, heading, ignition, obd_data, sensors, "timestamp" FROM positions WHERE device_id = dev.id ORDER BY "timestamp" DESC LIMIT 1) p`, [devs.map((d) => d.id)]);
    const byDev = new Map(pos.map((p) => [p.device_id, p]));
    for (const d of devs) { const p = byDev.get(d.id); if (p && (!out.get(d.vehicle_id) || new Date(p.timestamp) > new Date(out.get(d.vehicle_id).timestamp))) out.set(d.vehicle_id, p); }
    return out;
  }

  private async paceKmh(vehicleId: string): Promise<number | null> {
    const devs: { id: string }[] = await this.ds.query(`SELECT id FROM devices WHERE vehicle_id=$1`, [vehicleId]);
    if (!devs.length) return null;
    const [r] = await this.ts.query(`SELECT AVG(speed)::float8 AS kmh, COUNT(*)::int AS n FROM positions WHERE device_id = ANY($1::uuid[]) AND "timestamp" > $2 AND speed > 3`, [devs.map((d) => d.id), new Date(Date.now() - 30 * 60_000)]);
    return r?.n >= 3 ? Math.round(r.kmh * 10) / 10 : null;
  }

  private async event(orgId: string, vehicleId: string, kind: string, detail: object) {
    await this.ds.query(`INSERT INTO dispatch_events (organization_id, vehicle_id, kind, detail) VALUES ($1,$2,$3,$4)`, [orgId, vehicleId, kind, JSON.stringify(detail)]);
  }

  /** Tells the customer through CUSTOMER_NOTIFY_WEBHOOK_URL (connect it to an SMS or email gateway). Every attempt is recorded, including "not configured". */
  async notifyCustomer(orgId: string, vehicleId: string, d: { customer_name?: string; customer_phone?: string; customer_email?: string }, message: string, extra: object = {}) {
    const to = d.customer_phone || d.customer_email || null;
    let status: 'sent' | 'failed' | 'not_configured' = 'not_configured', error: string | null = null; const channel = d.customer_phone ? 'sms' : d.customer_email ? 'email' : 'none';
    const url = process.env.CUSTOMER_NOTIFY_WEBHOOK_URL;
    if (!to) error = 'No phone or email for this customer';
    else if (!url) error = 'CUSTOMER_NOTIFY_WEBHOOK_URL is not set';
    else {
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 6000);
      try {
        const res = await fetch(url, { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', ...(process.env.CUSTOMER_NOTIFY_WEBHOOK_TOKEN ? { authorization: `Bearer ${process.env.CUSTOMER_NOTIFY_WEBHOOK_TOKEN}` } : {}) }, body: JSON.stringify({ channel, to, name: d.customer_name ?? null, message, ...extra }) });
        status = res.ok ? 'sent' : 'failed'; if (!res.ok) error = `Webhook answered ${res.status}`;
      } catch (e: any) { status = 'failed'; error = String(e.message).slice(0, 200); } finally { clearTimeout(timer); }
    }
    await this.ds.query(`INSERT INTO customer_notifications (organization_id, vehicle_id, channel, recipient, message, status, error) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [orgId, vehicleId, channel, to, message.slice(0, 500), status, error]);
    return status;
  }

  // ------------------------------------------------------------------ the watcher
  @Interval(60_000)
  async tick() {
    if (this.running || process.env.DISPATCH_WATCHER === 'off') return;
    this.running = true;
    try {
      const rows: any[] = await this.ds.query(`SELECT x.*, v.plate_number AS plate FROM vehicle_destinations x JOIN vehicles v ON v.id = x.vehicle_id WHERE x.status = 'active' AND v.deleted_at IS NULL`);
      for (const r of rows) { try { await this.check(r); } catch (e: any) { this.logger.warn(`Dispatch check failed for ${r.plate}: ${e.message}`); } }
    } finally { this.running = false; }
  }

  /** Runs one check right away (used when a destination is set, so the first ETA does not wait for the next minute). */
  async checkNow(orgId: string, vehicleId: string) {
    const [r] = await this.ds.query(`SELECT x.*, v.plate_number AS plate FROM vehicle_destinations x JOIN vehicles v ON v.id = x.vehicle_id WHERE x.vehicle_id=$1 AND x.organization_id=$2 AND x.status='active'`, [vehicleId, orgId]);
    if (r) await this.check(r).catch((e) => this.logger.warn(`Dispatch check failed: ${e.message}`));
  }

  private async check(r: any) {
    const orgId = r.organization_id as string, vid = r.vehicle_id as string;
    const pos = (await this.latest([vid])).get(vid);
    if (!pos || Date.now() - new Date(pos.timestamp).getTime() > this.offlineMs) return;
    if (await this.scope.isOffDuty(orgId, vid)) return; // driver privacy: no tracking of private time, so no ETA either
    const here = { lat: Number(pos.latitude), lng: Number(pos.longitude) }, dest = { lat: Number(r.latitude), lng: Number(r.longitude) };
    const straight = haversineDistanceMeters(here.lat, here.lng, dest.lat, dest.lng);

    if (straight <= ARRIVE_M) {
      await this.ds.query(`UPDATE vehicle_destinations SET status='arrived', arrived_at=now(), last_eta_minutes=0, last_eta_at=now() WHERE vehicle_id=$1`, [vid]);
      await this.event(orgId, vid, 'arrived', { label: r.label });
      if (r.notify_customer) await this.notifyCustomer(orgId, vid, r, `Your delivery${r.label ? ` to ${r.label}` : ''} has arrived.`, { kind: 'arrived', plate: r.plate });
      return;
    }

    const routes = await this.match.routes(here, dest, false);
    const fresh = routes?.[0] ?? null;
    let planned: [number, number][] | null = Array.isArray(r.route) ? r.route : null;
    let offCount = r.off_route_count ?? 0, rerouted = false, deviation = 0;
    if (planned && planned.length > 1) {
      deviation = distanceToLine(here, planned);
      offCount = deviation > OFF_ROUTE_M && Number(pos.speed) > 3 ? offCount + 1 : 0;
      if (offCount >= 2 && fresh) { rerouted = true; planned = null; offCount = 0; await this.event(orgId, vid, 'off_route', { deviationM: Math.round(deviation) }); }
    }
    if ((!planned || !planned.length) && fresh) { planned = thin(fresh.geometry, 300); await this.event(orgId, vid, rerouted ? 'rerouted' : 'eta_changed', rerouted ? { reason: 'left the planned route' } : { reason: 'route planned' }).catch(() => undefined); }

    const pace = await this.paceKmh(vid);
    let roadKm: number, freeMin: number;
    if (fresh) { roadKm = fresh.distance / 1000; freeMin = fresh.duration / 60; } else { const e = estimateEta(straight, pace ?? 25); roadKm = e.roadKm; freeMin = e.minutes; }
    const atPace = pace ? (roadKm / Math.max(5, pace)) * 60 : null;
    const minutes = Math.max(1, Math.round(atPace ?? freeMin));
    const congested = pace !== null && freeMin > 0 && (roadKm / freeMin) * 60 > 0 && pace < ((roadKm / freeMin) * 60) * 0.6;

    await this.ds.query(`UPDATE vehicle_destinations SET last_eta_minutes=$2, last_eta_at=now(), off_route_count=$3, route=COALESCE($4::jsonb, route), route_distance_m=COALESCE($5, route_distance_m), route_duration_s=COALESCE($6, route_duration_s) WHERE vehicle_id=$1`,
      [vid, minutes, offCount, planned && (!r.route || rerouted) ? JSON.stringify(planned) : null, fresh && (!r.route || rerouted) ? fresh.distance : null, fresh && (!r.route || rerouted) ? fresh.duration : null]);

    const due = r.due_at ? new Date(r.due_at).getTime() : null;
    if (due && Date.now() + minutes * 60_000 > due) {
      const [last] = await this.ds.query(`SELECT created_at FROM dispatch_events WHERE vehicle_id=$1 AND kind='delay_risk' ORDER BY created_at DESC LIMIT 1`, [vid]);
      if (!last || Date.now() - new Date(last.created_at).getTime() > 30 * 60_000) await this.event(orgId, vid, 'delay_risk', { etaMinutes: minutes, lateByMinutes: Math.round((Date.now() + minutes * 60_000 - due) / 60_000) });
    }

    if (r.notify_customer) {
      const was = r.notified_eta_minutes as number | null;
      const moved = was === null || was === undefined ? true : Math.abs(minutes - was) >= Math.max(10, was * 0.25) || rerouted;
      if (moved) {
        const at = new Date(Date.now() + minutes * 60_000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Accra' });
        const text = was === null || was === undefined ? `Your delivery${r.label ? ` to ${r.label}` : ''} is on its way. Expected around ${at} (${minutes} min).`
          : `Update: your delivery${r.label ? ` to ${r.label}` : ''} is now expected around ${at} (${minutes} min)${rerouted ? ', after a route change' : congested ? ', because of slow traffic' : ''}.`;
        const st = await this.notifyCustomer(orgId, vid, r, text, { kind: 'eta', etaMinutes: minutes, plate: r.plate });
        await this.ds.query(`UPDATE vehicle_destinations SET notified_eta_minutes=$2, notified_at=now() WHERE vehicle_id=$1`, [vid, minutes]);
        await this.event(orgId, vid, 'eta_changed', { from: was ?? null, to: minutes, congested, rerouted, notified: st });
      }
    }
  }

  // ------------------------------------------------------------------ queries for the map
  private async scopeSql(user: AuthUser, alias = 'v', at = 2) {
    const s = await this.scope.hubScope(user);
    if (s.all) return { sql: '', params: [] as unknown[] };
    if (!s.hubIds.length) return { sql: ' AND false', params: [] as unknown[] };
    return { sql: ` AND ${alias}.hub_id = ANY($${at}::uuid[])`, params: [s.hubIds] as unknown[] };
  }

  /** Active and recent jobs with ETA, deadline status, and for late or at-risk ones: other vehicles that could take them and a route suggestion. */
  async board(user: AuthUser) {
    const f = await this.scopeSql(user);
    const rows: any[] = await this.ds.query(
      `SELECT x.*, v.plate_number AS plate, v.hub_id AS hub_id FROM vehicle_destinations x JOIN vehicles v ON v.id = x.vehicle_id WHERE x.organization_id=$1 AND v.deleted_at IS NULL${f.sql} ORDER BY x.created_at DESC`, [user.organizationId, ...f.params]);
    const pos = await this.latest(rows.map((r) => r.vehicle_id));
    const priv = await this.scope.privacy(user.organizationId);
    const now = Date.now();
    const jobs: any[] = [];
    for (const r of rows) {
      const cfg = priv.get(r.vehicle_id); if (cfg && !isWorkTime(cfg, new Date())) continue; // off duty: not shown
      let etaMin: number | null = r.last_eta_minutes !== null ? Math.max(0, Math.round(r.last_eta_minutes - (now - new Date(r.last_eta_at).getTime()) / 60_000)) : null;
      const p = pos.get(r.vehicle_id);
      if (etaMin === null && p) etaMin = estimateEta(haversineDistanceMeters(Number(p.latitude), Number(p.longitude), r.latitude, r.longitude), 25).minutes;
      const due = r.due_at ? new Date(r.due_at).getTime() : null;
      let risk: 'arrived' | 'no_deadline' | 'on_time' | 'at_risk' | 'late' | 'unknown' = r.status === 'arrived' ? 'arrived' : due === null ? 'no_deadline' : etaMin === null ? 'unknown' : 'on_time';
      let slackMin: number | null = null;
      if (r.status === 'active' && due !== null && etaMin !== null) {
        slackMin = Math.round((due - (now + etaMin * 60_000)) / 60_000);
        risk = slackMin < 0 ? 'late' : slackMin < Math.max(10, etaMin * 0.15) ? 'at_risk' : 'on_time';
      }
      jobs.push({ vehicleId: r.vehicle_id, plate: r.plate, label: r.label, lat: r.latitude, lng: r.longitude, customerName: r.customer_name, notifyCustomer: r.notify_customer, status: r.status, dueAt: r.due_at ? new Date(r.due_at).toISOString() : null, etaMinutes: etaMin, slackMinutes: slackMin, risk, route: Array.isArray(r.route) ? r.route : null, offRoute: (r.off_route_count ?? 0) > 0, _p: p ? { lat: Number(p.latitude), lng: Number(p.longitude) } : null });
    }
    // alternatives for jobs that are late or at risk
    const trouble = jobs.filter((j) => j.risk === 'late' || j.risk === 'at_risk');
    if (trouble.length) {
      const f2 = await this.scopeSql(user);
      const free: any[] = await this.ds.query(
        `SELECT v.id, v.plate_number AS plate FROM vehicles v WHERE v.organization_id=$1 AND v.deleted_at IS NULL AND v.lifecycle_status NOT IN ('retired','written_off','stolen') AND NOT EXISTS (SELECT 1 FROM vehicle_destinations d WHERE d.vehicle_id = v.id AND d.status='active')${f2.sql}`, [user.organizationId, ...f2.params]).catch(() => []);
      const fp = await this.latest(free.map((x) => x.id));
      for (const j of trouble) {
        const cands = free.map((x) => { const p = fp.get(x.id); if (!p || now - new Date(p.timestamp).getTime() > this.offlineMs) return null; const cfg = priv.get(x.id); if (cfg && !isWorkTime(cfg, new Date())) return null;
          const m = haversineDistanceMeters(Number(p.latitude), Number(p.longitude), j.lat, j.lng); const e = estimateEta(m, 25);
          return { vehicleId: x.id, plate: x.plate, distanceKm: Math.round(m / 100) / 10, etaMinutes: e.minutes, makesDeadline: j.dueAt ? now + e.minutes * 60_000 <= new Date(j.dueAt).getTime() : null, basis: 'straight line x 1.3 at 25 km/h' };
        }).filter(Boolean) as any[];
        j.alternatives = cands.sort((a, b) => a.etaMinutes - b.etaMinutes).slice(0, 3);
        if (j._p) { const adv = await this.advice(user, j.vehicleId, { lat: j.lat, lng: j.lng }, 'time', j.dueAt, j._p).catch(() => null); if (adv) j.routeAdvice = { best: adv.best, reasoning: adv.reasoning }; }
      }
    }
    jobs.forEach((j) => delete j._p);
    const events: any[] = await this.ds.query(`SELECT e.id, e.kind, e.detail, e.created_at AS "at", v.plate_number AS plate, e.vehicle_id AS "vehicleId" FROM dispatch_events e JOIN vehicles v ON v.id=e.vehicle_id WHERE e.organization_id=$1${f.sql} ORDER BY e.created_at DESC LIMIT 30`, [user.organizationId, ...f.params]);
    const notes: any[] = await this.ds.query(`SELECT n.id, n.channel, n.recipient, n.message, n.status, n.error, n.created_at AS "at", v.plate_number AS plate FROM customer_notifications n LEFT JOIN vehicles v ON v.id=n.vehicle_id WHERE n.organization_id=$1${f.sql ? f.sql.replace('v.hub_id', 'v.hub_id') : ''} ORDER BY n.created_at DESC LIMIT 20`, [user.organizationId, ...f.params]);
    return { jobs, events: events.filter((e) => !priv.has(e.vehicleId) || isWorkTime(priv.get(e.vehicleId)!, new Date(e.at))), notifications: notes, notifyConfigured: !!process.env.CUSTOMER_NOTIFY_WEBHOOK_URL };
  }

  /** Route options from the vehicle's position (or a given start) to a destination, with energy, CO2 and the reasoning. */
  async advice(user: AuthUser, vehicleId: string, to: { lat: number; lng: number }, priority: Priority = 'balanced', dueAt?: string | null, startOverride?: { lat: number; lng: number }) {
    if (!/^[0-9a-f-]{36}$/i.test(vehicleId ?? '')) throw new BadRequestException('vehicleId must be a valid id');
    if (!Number.isFinite(to.lat) || !Number.isFinite(to.lng) || Math.abs(to.lat) > 90 || Math.abs(to.lng) > 180) throw new BadRequestException('Destination must be a valid latitude and longitude');
    const f = await this.scopeSql(user, 'v', 3);
    const [v] = await this.ds.query(`SELECT v.id, v.fuel_type AS "fuelType", v.map_icon AS icon, m.vehicle_type AS "vehicleType" FROM vehicles v LEFT JOIN vehicle_models m ON m.id=v.vehicle_model_id WHERE v.id=$1 AND v.organization_id=$2 AND v.deleted_at IS NULL${f.sql}`, [vehicleId, user.organizationId, ...f.params]);
    if (!v) throw new BadRequestException('Vehicle not found');
    if (await this.scope.isOffDuty(user.organizationId, vehicleId)) throw new BadRequestException('This vehicle is off duty (driver privacy), so its position is not available');
    let from = startOverride;
    let tel: any = null;
    if (!from) { const p = (await this.latest([vehicleId])).get(vehicleId); if (!p) throw new BadRequestException('No position has been received from this vehicle yet'); from = { lat: Number(p.latitude), lng: Number(p.longitude) }; tel = normalizeTelemetry(p.obd_data, p.sensors); }
    const routes = await this.match.routes(from, to, true);
    if (!routes) throw new BadRequestException('The routing service did not answer. Try again in a moment.');
    const pace = await this.paceKmh(vehicleId);
    const ff = routes[0].distance / Math.max(1, routes[0].duration) * 3.6; // free-flow km/h of the fastest route
    const congestion = pace ? Math.min(2.5, Math.max(1, ff / pace)) : 1;
    const due = dueAt ? Math.round((new Date(dueAt).getTime() - Date.now()) / 1000) : null;
    const profile = profileFor(v.vehicleType, v.icon, v.fuelType);
    const { options, best, reasoning } = scoreRoutes(routes.map((r, i) => ({ index: i, distanceM: r.distance, durationS: r.duration, geometry: thin(r.geometry, 250) })), profile, priority, { congestion, dueInSeconds: due });
    if (tel?.soc !== undefined && profile.electric && tel.soc < 20) reasoning.push(`Battery is at ${Math.round(tel.soc)}%: consider charging first (see charging points on the map).`);
    return { vehicleId, from, to, priority, congestionFactor: +congestion.toFixed(2), electric: profile.electric, options, best: { index: best.index, label: best.label }, reasoning, note: 'Rule-based scoring of road routes. Live traffic is only reflected through this vehicle\'s own recent pace.' };
  }
}
