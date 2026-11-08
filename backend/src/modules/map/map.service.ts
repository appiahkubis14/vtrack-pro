import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthUser } from '../../common/auth/auth-user';
import { Role } from '../../common/constants/roles.constant';
import { DataScopeService } from '../hubs/data-scope.service';
import { MapScopeService } from './map-scope.service';
import { haversineDistanceMeters } from '../../helpers/geo.helper';
import { isWorkTime } from './engines/geo.engine';
import { analyseTrack, downsample, estimateEta, TrackPoint } from './engines/track.engine';
import { normalizeTelemetry, riskScore } from './engines/telemetry.engine';
import { MatchService } from './match.service';

export const MAP_ICONS = ['ebike', 'trike', 'truck', 'van', 'car', 'bus', 'motorbike', 'excavator', 'arrow'] as const;
export const POI_CATEGORIES = ['depot', 'hub', 'customer', 'fuel', 'charging', 'parking', 'service', 'other'] as const;
const MAX_RANGE_DAYS = 31;
/** TypeORM returns [rows, affectedCount] for UPDATE ... RETURNING, but plain rows for SELECT and INSERT. */
const rowsOf = (res: any): any[] => (Array.isArray(res) && res.length === 2 && Array.isArray(res[0]) && typeof res[1] === 'number' ? res[0] : res);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const isLat = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
const isLng = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;

@Injectable()
export class MapService {
  private readonly logger = new Logger(MapService.name);
  private readonly offlineMinutes = Number(process.env.MAP_OFFLINE_MINUTES ?? 10);
  private readonly routingUrl = (process.env.ROUTING_URL || 'https://router.project-osrm.org').replace(/\/$/, '');
  private readonly etaCache = new Map<string, { at: number; value: any }>();

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectDataSource('timescale') private readonly ts: DataSource,
    private readonly scopes: DataScopeService,
    private readonly mapScope: MapScopeService,
    private readonly matcher: MatchService,
  ) {}

  // ------------------------------------------------------------------ settings
  async config(user: AuthUser) {
    const [c] = await this.ds.query(
      `SELECT AVG(latitude) AS lat, AVG(longitude) AS lng FROM hubs WHERE organization_id=$1 AND latitude IS NOT NULL AND longitude IS NOT NULL`, [user.organizationId]);
    return {
      center: { lat: num(c?.lat) ?? 5.6037, lng: num(c?.lng) ?? -0.187 }, // Accra when nothing else is known
      refreshSeconds: Number(process.env.MAP_REFRESH_SECONDS ?? 30),
      offlineMinutes: this.offlineMinutes,
      traffic: process.env.MAP_TRAFFIC_TILE_URL
        ? { enabled: true, tileUrl: process.env.MAP_TRAFFIC_TILE_URL, attribution: process.env.MAP_TRAFFIC_ATTRIBUTION || 'Traffic data' }
        : { enabled: false, reason: 'Live traffic needs a traffic tile provider. Set MAP_TRAFFIC_TILE_URL on the server (see docs/map.md).' },
      weather: process.env.MAP_WEATHER_TILE_URL
        ? { enabled: true, provider: 'custom', tileUrl: process.env.MAP_WEATHER_TILE_URL, attribution: process.env.MAP_WEATHER_ATTRIBUTION || 'Weather data' }
        : { enabled: true, provider: 'rainviewer', attribution: 'Radar: RainViewer', note: 'Free radar, coarse resolution (zoom 7), last 2 hours.' },
      icons: MAP_ICONS, poiCategories: POI_CATEGORIES,
      canEdit: this.canEdit(user),
    };
  }

  canEdit(user: AuthUser) { return [Role.SUPER_ADMIN, Role.ORG_ADMIN, Role.FLEET_MANAGER, Role.DISPATCHER].includes(user.role); }
  private assertEdit(user: AuthUser) { if (!this.canEdit(user)) throw new ForbiddenException('Your role cannot change map data'); }

  // ------------------------------------------------------------------ scope helpers
  private async hubFilter(user: AuthUser, alias = 'v', startAt = 2): Promise<{ sql: string; params: unknown[] }> {
    const scope = await this.mapScope.hubScope(user);
    if (scope.all) return { sql: '', params: [] };
    if (!scope.hubIds.length) return { sql: ' AND false', params: [] };
    return { sql: ` AND ${alias}.hub_id = ANY($${startAt}::uuid[])`, params: [scope.hubIds] };
  }

  private async vehicleOrThrow(user: AuthUser, vehicleId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(vehicleId ?? '')) throw new BadRequestException('vehicleId must be a valid id');
    const f = await this.hubFilter(user, 'v', 3);
    const [v] = await this.ds.query(`SELECT v.id, v.plate_number AS plate, v.hub_id AS "hubId" FROM vehicles v WHERE v.id=$1 AND v.organization_id=$2 AND v.deleted_at IS NULL${f.sql}`, [vehicleId, user.organizationId, ...f.params]);
    if (!v) throw new NotFoundException('Vehicle not found');
    return v as { id: string; plate: string; hubId: string | null };
  }

  private async deviceIds(user: AuthUser, vehicleId: string): Promise<string[]> {
    const rows = await this.ds.query(`SELECT id FROM devices WHERE vehicle_id=$1 AND organization_id=$2`, [vehicleId, user.organizationId]);
    return rows.map((r: any) => r.id);
  }

  private parseRange(from?: string, to?: string, defaultHours = 24) {
    const t = to ? new Date(to) : new Date();
    const f = from ? new Date(from) : new Date(t.getTime() - defaultHours * 3600_000);
    if (isNaN(+f) || isNaN(+t)) throw new BadRequestException('from and to must be valid dates');
    if (f >= t) throw new BadRequestException('from must be before to');
    if (t.getTime() - f.getTime() > MAX_RANGE_DAYS * 86400_000) throw new BadRequestException(`Choose a period of at most ${MAX_RANGE_DAYS} days`);
    return { f, t };
  }

  // ------------------------------------------------------------------ live fleet
  async fleet(user: AuthUser) {
    const f = await this.hubFilter(user);
    const rows: any[] = await this.ds.query(
      `SELECT v.id, v.plate_number AS plate, v.map_icon AS "mapIcon", v.color, v.lifecycle_status AS lifecycle, v.hub_id AS "hubId", h.name AS "hubName",
              m.vehicle_type AS "vehicleType", m.name AS "modelName", v.fuel_type AS "fuelType",
              d.id AS "deviceId", d.imei, d.status AS "deviceStatus", d.battery_level AS "deviceBattery", d.signal_strength AS signal, d.last_communication_at AS "lastCommunicationAt",
              r.id AS "riderId", r.full_name AS "riderName", r.phone AS "riderPhone",
              x.label AS "destLabel", x.latitude AS "destLat", x.longitude AS "destLng", x.due_at AS "destDue", x.customer_name AS "destCustomer", x.status AS "destStatus", x.last_eta_minutes AS "destEta", x.last_eta_at AS "destEtaAt", x.notify_customer AS "destNotify",
              (SELECT array_agg(gm.group_id) FROM vehicle_group_members gm WHERE gm.vehicle_id = v.id) AS "groupIds"
         FROM vehicles v
         LEFT JOIN hubs h ON h.id = v.hub_id
         LEFT JOIN vehicle_models m ON m.id = v.vehicle_model_id
         LEFT JOIN LATERAL (SELECT * FROM devices WHERE vehicle_id = v.id AND deleted_at IS NULL ORDER BY last_communication_at DESC NULLS LAST LIMIT 1) d ON true
         LEFT JOIN rider_assignments a ON a.vehicle_id = v.id AND a.status = 'active'
         LEFT JOIN riders r ON r.id = a.rider_id
         LEFT JOIN vehicle_destinations x ON x.vehicle_id = v.id
        WHERE v.organization_id = $1 AND v.deleted_at IS NULL${f.sql}
        ORDER BY v.plate_number`, [user.organizationId, ...f.params]);

    const deviceIds = rows.map((r) => r.deviceId).filter(Boolean);
    const last = new Map<string, any>();
    const inside = new Map<string, string[]>();
    if (deviceIds.length) {
      const pos: any[] = await this.ts.query(
        `SELECT p.* FROM unnest($1::uuid[]) AS dev(id)
           CROSS JOIN LATERAL (SELECT device_id, latitude, longitude, speed, heading, ignition, satellites, fuel_level, obd_data, sensors, "timestamp"
                                 FROM positions WHERE device_id = dev.id ORDER BY "timestamp" DESC LIMIT 1) p`, [deviceIds]);
      pos.forEach((p) => last.set(p.device_id, p));
      const st: any[] = await this.ds.query(`SELECT device_id, array_agg(geofence_id) AS ids FROM geofence_device_states WHERE confirmed_state='in' AND device_id = ANY($1::uuid[]) GROUP BY device_id`, [deviceIds]);
      st.forEach((s) => inside.set(s.device_id, s.ids));
    }

    const now = Date.now();
    const priv = await this.mapScope.privacy(user.organizationId);
    let vehicles: any[] = rows.map((r) => {
      let p = r.deviceId ? last.get(r.deviceId) : null;
      const cfg = priv.get(r.id);
      const offDuty = !!cfg && !isWorkTime(cfg, new Date());
      if (offDuty) p = null; // driver privacy: no position, no telemetry, outside working hours
      const ageMs = p ? now - new Date(p.timestamp).getTime() : null;
      const speed = p ? Number(p.speed ?? 0) : 0;
      const ignition = p ? !!p.ignition : false;
      let status: string;
      if (offDuty) status = 'off_duty';
      else if (!p) status = 'no_gps';
      else if (ageMs! > this.offlineMinutes * 60_000) status = 'offline';
      else if (speed > 3) status = 'moving';
      else status = ignition ? 'idle' : 'parked';
      const electric = !/petrol|diesel|gas/i.test(r.fuelType ?? '');
      const telemetry = p ? normalizeTelemetry(p.obd_data, p.sensors, p.fuel_level) : null;
      const hasTelemetry = !!telemetry && Object.keys(telemetry).length > 0;
      const risk = p ? riskScore(telemetry ?? {}, { deviceBattery: num(r.deviceBattery), electric }) : null;
      return {
        id: r.id, plate: r.plate, vehicleType: r.vehicleType ?? null, modelName: r.modelName ?? null, icon: r.mapIcon ?? null, fuelType: r.fuelType ?? null,
        lifecycle: r.lifecycle, hubId: r.hubId, hubName: r.hubName, groupIds: r.groupIds ?? [],
        rider: r.riderId ? { id: r.riderId, name: r.riderName, phone: r.riderPhone } : null,
        device: r.deviceId && !offDuty ? { id: r.deviceId, imei: r.imei, battery: num(r.deviceBattery), signal: num(r.signal), lastCommunicationAt: r.lastCommunicationAt } : null,
        position: p ? { lat: Number(p.latitude), lng: Number(p.longitude), speed, heading: Number(p.heading ?? 0), ignition, satellites: num(p.satellites), fuelLevel: num(p.fuel_level), time: new Date(p.timestamp).toISOString(), ageSeconds: Math.round(ageMs! / 1000) } : null,
        status, offDuty,
        telemetry: hasTelemetry ? telemetry : null,
        risk: risk && risk.score > 0 ? risk : null,
        insideGeofenceIds: r.deviceId && !offDuty ? inside.get(r.deviceId) ?? [] : [],
        destination: r.destLat !== null && r.destLat !== undefined && !offDuty
          ? { label: r.destLabel, lat: Number(r.destLat), lng: Number(r.destLng), dueAt: r.destDue ? new Date(r.destDue).toISOString() : null, customerName: r.destCustomer ?? null, status: r.destStatus, etaMinutes: num(r.destEta), etaCheckedAt: r.destEtaAt ? new Date(r.destEtaAt).toISOString() : null, notifyCustomer: !!r.destNotify }
          : null,
      };
    });
    if (this.matcher.liveEnabled) {
      // Move moving vehicles onto the road centre line (cached; only vehicles that are driving).
      const movers = vehicles.filter((v) => v.status === 'moving' && v.position);
      for (let i = 0; i < movers.length; i += 6) {
        await Promise.all(movers.slice(i, i + 6).map(async (v) => { const s = await this.matcher.snapPoint(v.position.lat, v.position.lng, v.position.heading); if (s) v.position.snapped = { lat: s.lat, lng: s.lng, distanceM: s.distanceM }; }));
      }
    }
    return { generatedAt: new Date().toISOString(), offlineMinutes: this.offlineMinutes, snapLive: this.matcher.liveEnabled, vehicles };
  }

  // ------------------------------------------------------------------ history / replay
  async history(user: AuthUser, q: { vehicleId: string; from?: string; to?: string; maxPoints?: string; minStopMinutes?: string; match?: string }) {
    const v = await this.vehicleOrThrow(user, q.vehicleId);
    const { f, t } = this.parseRange(q.from, q.to);
    const ids = await this.deviceIds(user, v.id);
    if (!ids.length) return { vehicle: v, from: f.toISOString(), to: t.toISOString(), points: [], stops: [], stats: analyseTrack([]).stats, note: 'This vehicle has no tracker.' };
    const rows: any[] = await this.ts.query(
      `SELECT latitude, longitude, speed, heading, ignition, "timestamp" FROM positions WHERE device_id = ANY($1::uuid[]) AND "timestamp" BETWEEN $2 AND $3 ORDER BY "timestamp" ASC LIMIT 60001`, [ids, f, t]);
    const truncated = rows.length > 60000;
    let all: TrackPoint[] = rows.slice(0, 60000).map((r) => ({ t: new Date(r.timestamp).toISOString(), lat: Number(r.latitude), lng: Number(r.longitude), speed: Number(r.speed ?? 0), heading: Number(r.heading ?? 0), ignition: !!r.ignition }));
    const cfg = (await this.mapScope.privacy(user.organizationId)).get(v.id);
    let hidden = 0;
    if (cfg) { const before = all.length; all = all.filter((p) => isWorkTime(cfg, new Date(p.t))); hidden = before - all.length; } // driver privacy: only working hours are shown
    const minStop = Math.max(1, Math.min(240, Number(q.minStopMinutes ?? 3) || 3)) * 60;
    const { stops, stats } = analyseTrack(all, { minStopSeconds: minStop });
    const max = Math.max(50, Math.min(20000, Number(q.maxPoints ?? 4000) || 4000));
    let points: any[] = downsample(all, max);
    let matching: any = null;
    if (q.match === 'true' && all.length > 1) {
      const m = await this.matcher.matchTrace(all);
      matching = { method: m.method, snappedShare: m.snappedShare, note: m.note ?? null, rawDistanceKm: stats.distanceKm };
      if (m.method === 'osrm') {
        points = m.points;
        let d = 0; for (let i = 1; i < m.points.length; i++) if ((new Date(m.points[i].t).getTime() - new Date(m.points[i - 1].t).getTime()) < 600_000) d += haversineDistanceMeters(m.points[i - 1].lat, m.points[i - 1].lng, m.points[i].lat, m.points[i].lng);
        stats.distanceKm = Math.round(d / 100) / 10;
      }
    }
    return { vehicle: v, from: f.toISOString(), to: t.toISOString(), points, stops, stats, truncated, matching, privacy: cfg ? { hiddenPoints: hidden, note: 'Positions outside working hours are not shown for this vehicle.' } : null };
  }

  async heatmap(user: AuthUser, q: { from?: string; to?: string; vehicleId?: string; hubId?: string; precision?: string; movingOnly?: string }) {
    const { f, t } = this.parseRange(q.from, q.to, 24 * 7);
    const flt = await this.hubFilter(user, 'v', 2);
    let sql = `SELECT d.id, v.id AS vid FROM devices d JOIN vehicles v ON v.id = d.vehicle_id WHERE d.organization_id=$1 AND v.deleted_at IS NULL${flt.sql}`;
    const params: unknown[] = [user.organizationId, ...flt.params];
    if (q.vehicleId) { params.push(q.vehicleId); sql += ` AND v.id=$${params.length}::uuid`; }
    if (q.hubId) { params.push(q.hubId); sql += ` AND v.hub_id=$${params.length}::uuid`; }
    const devs: { id: string; vid: string }[] = await this.ds.query(sql, params);
    if (!devs.length) return { cells: [], max: 0, from: f.toISOString(), to: t.toISOString() };
    const priv = await this.mapScope.privacy(user.organizationId);
    const plainIds = devs.filter((d) => !priv.has(d.vid)).map((d) => d.id);
    const step = { 3: 0.001, 4: 0.0001, 2: 0.01 }[Number(q.precision) as 2 | 3 | 4] ?? 0.0005; // about 1 km, 110 m, 11 m, 55 m
    const moving = q.movingOnly === 'true' ? ' AND speed > 2' : '';
    const sp: unknown[] = [f, t, step, plainIds];
    const serverTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const ors = ['device_id = ANY($4::uuid[])'];
    // driver privacy: vehicles with working hours contribute only the points recorded inside those hours (stored times are server-local)
    const byCfg = new Map<string, { cfg: any; ids: string[] }>();
    for (const d of devs) { const c = priv.get(d.vid); if (!c) continue; const k = JSON.stringify(c); if (!byCfg.has(k)) byCfg.set(k, { cfg: c, ids: [] }); byCfg.get(k)!.ids.push(d.id); }
    for (const { cfg, ids: pids } of byCfg.values()) {
      const n = sp.length; sp.push(pids, serverTz, cfg.timezone, cfg.work_days, cfg.start_time, cfg.end_time);
      const loc = `(("timestamp" AT TIME ZONE $${n + 2}) AT TIME ZONE $${n + 3})`;
      const inHours = cfg.start_time <= cfg.end_time ? `${loc}::time >= $${n + 5}::time AND ${loc}::time < $${n + 6}::time` : `(${loc}::time >= $${n + 5}::time OR ${loc}::time < $${n + 6}::time)`;
      ors.push(`(device_id = ANY($${n + 1}::uuid[]) AND EXTRACT(isodow FROM ${loc})::int = ANY($${n + 4}::int[]) AND ${inHours})`);
    }
    const cells: any[] = await this.ts.query(
      `SELECT (ROUND(latitude / $3::numeric) * $3::numeric)::float8 AS lat, (ROUND(longitude / $3::numeric) * $3::numeric)::float8 AS lng, COUNT(*)::int AS n
         FROM positions WHERE (${ors.join(' OR ')}) AND "timestamp" BETWEEN $1 AND $2${moving} GROUP BY 1, 2 ORDER BY n DESC LIMIT 20000`, sp);
    return { cells: cells.map((c) => [c.lat, c.lng, c.n]), max: cells.length ? cells[0].n : 0, from: f.toISOString(), to: t.toISOString(), cellMeters: Math.round(step * 111000) };
  }

  async events(user: AuthUser, q: { since?: string; limit?: string }) {
    const since = q.since ? new Date(q.since) : new Date(Date.now() - 24 * 3600_000);
    if (isNaN(+since)) throw new BadRequestException('since must be a valid date');
    const f = await this.hubFilter(user, 'v', 3);
    const limit = Math.max(1, Math.min(200, Number(q.limit ?? 50) || 50));
    const rows = await this.ds.query(
      `SELECT e.id, e.event_type AS "type", e.latitude, e.longitude, e."timestamp" AS "time", g.id AS "geofenceId", g.name AS "geofenceName", v.id AS "vehicleId", v.plate_number AS plate
         FROM geofence_events e JOIN geofences g ON g.id = e.geofence_id LEFT JOIN vehicles v ON v.id = e.vehicle_id
        WHERE g.organization_id = $1 AND e."timestamp" > $2${f.sql} ORDER BY e."timestamp" DESC LIMIT ${limit}`, [user.organizationId, since, ...f.params]);
    const priv = await this.mapScope.privacy(user.organizationId);
    return rows
      .filter((r: any) => { const c = r.vehicleId ? priv.get(r.vehicleId) : null; return !c || isWorkTime(c, new Date(r.time)); }) // driver privacy
      .map((r: any) => ({ ...r, latitude: num(r.latitude), longitude: num(r.longitude), time: new Date(r.time).toISOString() }));
  }

  // ------------------------------------------------------------------ points of interest
  async listPois(user: AuthUser) {
    const rows = await this.ds.query(`SELECT id, name, category, latitude AS lat, longitude AS lng, address, notes, capacity, available, availability_updated_at AS "availabilityUpdatedAt" FROM pois WHERE organization_id=$1 AND is_active ORDER BY name`, [user.organizationId]);
    return rows;
  }
  private cleanPoi(b: any, partial = false) {
    const out: any = {};
    if (!partial || b.name !== undefined) { const n = String(b.name ?? '').trim(); if (n.length < 2 || n.length > 120) throw new BadRequestException('Name must be 2 to 120 characters'); out.name = n; }
    if (!partial || b.category !== undefined) { const c = b.category ?? 'other'; if (!POI_CATEGORIES.includes(c)) throw new BadRequestException(`Category must be one of: ${POI_CATEGORIES.join(', ')}`); out.category = c; }
    if (!partial || b.lat !== undefined) { if (!isLat(b.lat)) throw new BadRequestException('lat must be a number between -90 and 90'); out.latitude = b.lat; }
    if (!partial || b.lng !== undefined) { if (!isLng(b.lng)) throw new BadRequestException('lng must be a number between -180 and 180'); out.longitude = b.lng; }
    if (b.address !== undefined) out.address = b.address ? String(b.address).slice(0, 255) : null;
    if (b.notes !== undefined) out.notes = b.notes ? String(b.notes).slice(0, 2000) : null;
    return out;
  }
  async createPoi(user: AuthUser, b: any) {
    this.assertEdit(user);
    const c = this.cleanPoi(b ?? {});
    const [r] = await this.ds.query(`INSERT INTO pois (organization_id, name, category, latitude, longitude, address, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, name, category, latitude AS lat, longitude AS lng, address, notes`,
      [user.organizationId, c.name, c.category, c.latitude, c.longitude, c.address ?? null, c.notes ?? null, user.sub]);
    return r;
  }
  async updatePoi(user: AuthUser, id: string, b: any) {
    this.assertEdit(user);
    const c = this.cleanPoi(b ?? {}, true);
    const keys = Object.keys(c);
    if (!keys.length) throw new BadRequestException('Nothing to change');
    const set = keys.map((k, i) => `${k}=$${i + 3}`).join(', ');
    const rows = rowsOf(await this.ds.query(`UPDATE pois SET ${set}, updated_at=now() WHERE id=$1 AND organization_id=$2 AND is_active RETURNING id, name, category, latitude AS lat, longitude AS lng, address, notes`, [id, user.organizationId, ...keys.map((k) => c[k])]));
    if (!rows.length) throw new NotFoundException('Point of interest not found');
    return rows[0];
  }
  async removePoi(user: AuthUser, id: string) {
    this.assertEdit(user);
    const r = rowsOf(await this.ds.query(`UPDATE pois SET is_active=false, updated_at=now() WHERE id=$1 AND organization_id=$2 AND is_active RETURNING id`, [id, user.organizationId]));
    if (!r.length) throw new NotFoundException('Point of interest not found');
    return { success: true };
  }

  // ------------------------------------------------------------------ per-vehicle icon and destination
  async setIcon(user: AuthUser, vehicleId: string, icon: unknown) {
    this.assertEdit(user);
    const v = await this.vehicleOrThrow(user, vehicleId);
    if (icon !== null && !MAP_ICONS.includes(icon as any)) throw new BadRequestException(`Icon must be one of: ${MAP_ICONS.join(', ')}`);
    await this.ds.query(`UPDATE vehicles SET map_icon=$1 WHERE id=$2`, [icon, v.id]);
    return { vehicleId: v.id, icon };
  }

  async setDestination(user: AuthUser, vehicleId: string, b: any) {
    this.assertEdit(user);
    const v = await this.vehicleOrThrow(user, vehicleId);
    if (!isLat(b?.lat) || !isLng(b?.lng)) throw new BadRequestException('lat and lng must be valid coordinates');
    const label = b.label ? String(b.label).slice(0, 160) : null;
    const name = b.customerName ? String(b.customerName).trim().slice(0, 120) : null;
    const phone = b.customerPhone ? String(b.customerPhone).trim().slice(0, 40) : null;
    const email = b.customerEmail ? String(b.customerEmail).trim().slice(0, 160) : null;
    if (phone && !/^[+0-9 ()-]{6,40}$/.test(phone)) throw new BadRequestException('Phone number may only contain digits, spaces, + ( ) -');
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequestException('Email address is not valid');
    let due: Date | null = null;
    if (b.dueAt) { due = new Date(b.dueAt); if (isNaN(+due)) throw new BadRequestException('dueAt must be a valid date and time'); }
    const notify = b.notifyCustomer === true;
    if (notify && !phone && !email) throw new BadRequestException('Add the customer\'s phone or email to notify them');
    // a new destination starts a new job: ETA, route and notification state are reset
    await this.ds.query(`INSERT INTO vehicle_destinations (vehicle_id, organization_id, label, latitude, longitude, set_by, customer_name, customer_phone, customer_email, notify_customer, due_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (vehicle_id) DO UPDATE SET label=EXCLUDED.label, latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude, set_by=EXCLUDED.set_by, created_at=now(),
        customer_name=EXCLUDED.customer_name, customer_phone=EXCLUDED.customer_phone, customer_email=EXCLUDED.customer_email, notify_customer=EXCLUDED.notify_customer, due_at=EXCLUDED.due_at,
        status='active', arrived_at=NULL, route=NULL, route_distance_m=NULL, route_duration_s=NULL, last_eta_minutes=NULL, last_eta_at=NULL, notified_eta_minutes=NULL, notified_at=NULL, off_route_count=0`,
      [v.id, user.organizationId, label, b.lat, b.lng, user.sub, name, phone, email, notify, due]);
    this.etaCache.delete(v.id);
    return { vehicleId: v.id, label, lat: b.lat, lng: b.lng };
  }
  async clearDestination(user: AuthUser, vehicleId: string) {
    this.assertEdit(user);
    const v = await this.vehicleOrThrow(user, vehicleId);
    await this.ds.query(`DELETE FROM vehicle_destinations WHERE vehicle_id=$1`, [v.id]);
    this.etaCache.delete(v.id);
    return { success: true };
  }

  // ------------------------------------------------------------------ ETA
  async eta(user: AuthUser, vehicleId: string, b: { lat?: number; lng?: number } = {}) {
    const v = await this.vehicleOrThrow(user, vehicleId);
    let dest = { lat: b.lat as number, lng: b.lng as number };
    if (b.lat === undefined || b.lng === undefined) {
      const [d] = await this.ds.query(`SELECT latitude, longitude FROM vehicle_destinations WHERE vehicle_id=$1`, [v.id]);
      if (!d) throw new BadRequestException('No destination is set for this vehicle');
      dest = { lat: Number(d.latitude), lng: Number(d.longitude) };
    } else if (!isLat(b.lat) || !isLng(b.lng)) throw new BadRequestException('lat and lng must be valid coordinates');

    const ids = await this.deviceIds(user, v.id);
    if (!ids.length) throw new BadRequestException('This vehicle has no tracker, so its position is unknown');
    const [p] = await this.ts.query(`SELECT latitude, longitude, speed, "timestamp" FROM positions WHERE device_id = ANY($1::uuid[]) ORDER BY "timestamp" DESC LIMIT 1`, [ids]);
    if (!p) throw new BadRequestException('No position has been received from this vehicle yet');
    const from = { lat: Number(p.latitude), lng: Number(p.longitude) };

    const key = `${v.id}:${from.lat.toFixed(3)},${from.lng.toFixed(3)}:${dest.lat.toFixed(4)},${dest.lng.toFixed(4)}`;
    const hit = this.etaCache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.value;

    // average speed while actually driving over the last 30 minutes: reflects the traffic this vehicle is meeting
    const [pace] = await this.ts.query(`SELECT AVG(speed)::float8 AS kmh, COUNT(*)::int AS n FROM positions WHERE device_id = ANY($1::uuid[]) AND "timestamp" > $2 AND speed > 3`, [ids, new Date(Date.now() - 30 * 60_000)]);
    const paceKmh: number | null = pace?.n >= 3 ? Math.round(pace.kmh * 10) / 10 : (Number(p.speed) > 3 ? Number(p.speed) : null);

    const straightM = haversineDistanceMeters(from.lat, from.lng, dest.lat, dest.lng);
    let roadKm: number, freeFlowMin: number, basis: 'road' | 'estimate' = 'estimate';
    const route = await this.route(from, dest);
    if (route) { roadKm = Math.round(route.distance / 100) / 10; freeFlowMin = Math.round(route.duration / 60); basis = 'road'; }
    else { const e = estimateEta(straightM, paceKmh ?? 25); roadKm = e.roadKm; freeFlowMin = e.minutes; }
    const atPaceMin = paceKmh ? Math.round((roadKm / Math.max(5, paceKmh)) * 60) : null;
    const minutes = atPaceMin ?? freeFlowMin;
    const value = {
      vehicleId: v.id, from, to: dest, straightKm: Math.round(straightM / 100) / 10, roadKm, basis,
      freeFlowMinutes: freeFlowMin, atCurrentPaceMinutes: atPaceMin, paceKmh,
      etaAt: new Date(Date.now() + minutes * 60_000).toISOString(), minutes,
      note: basis === 'road' ? 'Road distance from the routing service. Live traffic is only included if a traffic provider is configured; "at current pace" uses this vehicle\'s own recent speed.' : 'Routing service unavailable: straight-line distance times 1.3 was used.',
    };
    this.etaCache.set(key, { at: Date.now(), value });
    if (this.etaCache.size > 500) this.etaCache.delete(this.etaCache.keys().next().value as string);
    return value;
  }

  private async route(a: { lat: number; lng: number }, b: { lat: number; lng: number }): Promise<{ distance: number; duration: number } | null> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    try {
      const res = await fetch(`${this.routingUrl}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`, { signal: ctl.signal, headers: { 'User-Agent': 'VTrackPro/1.0' } });
      if (!res.ok) return null;
      const j: any = await res.json();
      const r = j?.routes?.[0];
      return r && Number.isFinite(r.distance) ? { distance: r.distance, duration: r.duration } : null;
    } catch (e: any) {
      this.logger.debug(`Routing unavailable: ${e.message}`);
      return null;
    } finally { clearTimeout(timer); }
  }
}
