import { resetGroupScope } from '../geofences/engines/geofence-checker.engine';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthUser } from '../../common/auth/auth-user';
import { Role } from '../../common/constants/roles.constant';
import { GeofencesService } from '../geofences/geofences.service';
import { MapScopeService } from './map-scope.service';
import { assetAlarms, normalizeTelemetry, riskScore } from './engines/telemetry.engine';
import { parseCsv, parseGeoJson } from './engines/geofence-import.engine';
import { haversineDistanceMeters } from '../../helpers/geo.helper';
import { isWorkTime } from './engines/geo.engine';

const WRITE: Role[] = [Role.SUPER_ADMIN, Role.ORG_ADMIN, Role.FLEET_MANAGER, Role.DISPATCHER];
const ADMIN: Role[] = [Role.SUPER_ADMIN, Role.ORG_ADMIN];
const PRIVACY_ADMIN: Role[] = [...ADMIN, Role.FLEET_MANAGER];
const UUID = /^[0-9a-f-]{36}$/i;
const HEX = /^#[0-9a-fA-F]{6}$/;
const rowsOf = (res: any): any[] => (Array.isArray(res) && res.length === 2 && Array.isArray(res[0]) && typeof res[1] === 'number' ? res[0] : res);
const must = (user: AuthUser, roles: Role[], what: string) => { if (!roles.includes(user.role)) throw new ForbiddenException(`Your role cannot ${what}`); };
const num = (v: any) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : undefined);

@Injectable()
export class AdvancedService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectDataSource('timescale') private readonly ts: DataSource,
    private readonly scope: MapScopeService,
    private readonly geofences: GeofencesService,
  ) {}

  private async visibleVehicleIds(user: AuthUser, ids: string[]) {
    if (!ids.length) return [];
    const s = await this.scope.hubScope(user);
    const rows = await this.ds.query(`SELECT id FROM vehicles WHERE organization_id=$1 AND deleted_at IS NULL AND id = ANY($2::uuid[])${s.all ? '' : ' AND hub_id = ANY($3::uuid[])'}`, s.all ? [user.organizationId, ids] : [user.organizationId, ids, s.hubIds]);
    return rows.map((r: any) => r.id as string);
  }

  async assertCanDispatch(user: AuthUser, vehicleId: string) {
    must(user, WRITE, 'manage dispatch');
    if (!(await this.visibleVehicleIds(user, [vehicleId])).length) throw new NotFoundException('Vehicle not found');
  }

  // ---------------------------------------------------------------- vehicle groups
  async groups(user: AuthUser) {
    const g: any[] = await this.ds.query(`SELECT id, name, color FROM vehicle_groups WHERE organization_id=$1 ORDER BY name`, [user.organizationId]);
    const m: any[] = await this.ds.query(`SELECT m.group_id, m.vehicle_id FROM vehicle_group_members m JOIN vehicle_groups g ON g.id=m.group_id WHERE g.organization_id=$1`, [user.organizationId]);
    const z: any[] = await this.ds.query(`SELECT gg.group_id, gg.geofence_id FROM geofence_groups gg JOIN vehicle_groups g ON g.id=gg.group_id WHERE g.organization_id=$1`, [user.organizationId]);
    return g.map((x) => ({ ...x, vehicleIds: m.filter((r) => r.group_id === x.id).map((r) => r.vehicle_id), geofenceIds: z.filter((r) => r.group_id === x.id).map((r) => r.geofence_id) }));
  }
  private cleanGroup(b: any) {
    const name = String(b?.name ?? '').trim(); if (name.length < 2 || name.length > 80) throw new BadRequestException('Group name must be 2 to 80 characters');
    const color = b?.color ?? '#64748b'; if (!HEX.test(color)) throw new BadRequestException('Colour must look like #1a73e8');
    return { name, color };
  }
  async createGroup(user: AuthUser, b: any) {
    must(user, WRITE, 'change vehicle groups'); const c = this.cleanGroup(b);
    try { const [r] = await this.ds.query(`INSERT INTO vehicle_groups (organization_id, name, color) VALUES ($1,$2,$3) RETURNING id`, [user.organizationId, c.name, c.color]); return { id: r.id }; }
    catch (e: any) { if (e.code === '23505') throw new BadRequestException('A group with this name already exists'); throw e; }
  }
  async updateGroup(user: AuthUser, id: string, b: any) {
    must(user, WRITE, 'change vehicle groups'); const c = this.cleanGroup(b);
    const r = rowsOf(await this.ds.query(`UPDATE vehicle_groups SET name=$3, color=$4 WHERE id=$1 AND organization_id=$2 RETURNING id`, [id, user.organizationId, c.name, c.color]).catch((e) => { if (e.code === '23505') throw new BadRequestException('A group with this name already exists'); throw e; }));
    if (!r.length) throw new NotFoundException('Group not found'); return { id };
  }
  async removeGroup(user: AuthUser, id: string) {
    must(user, WRITE, 'change vehicle groups');
    const r = rowsOf(await this.ds.query(`DELETE FROM vehicle_groups WHERE id=$1 AND organization_id=$2 RETURNING id`, [id, user.organizationId]));
    if (!r.length) throw new NotFoundException('Group not found'); resetGroupScope(user.organizationId); return { success: true };
  }
  private async groupOrThrow(user: AuthUser, id: string) { const [g] = await this.ds.query(`SELECT id FROM vehicle_groups WHERE id=$1 AND organization_id=$2`, [id, user.organizationId]); if (!g) throw new NotFoundException('Group not found'); }
  async setMembers(user: AuthUser, id: string, vehicleIds: unknown) {
    must(user, WRITE, 'change vehicle groups'); await this.groupOrThrow(user, id);
    if (!Array.isArray(vehicleIds) || vehicleIds.some((x) => !UUID.test(String(x))) || vehicleIds.length > 2000) throw new BadRequestException('vehicleIds must be a list of vehicle ids');
    const ok = await this.visibleVehicleIds(user, vehicleIds as string[]);
    if (ok.length !== new Set(vehicleIds as string[]).size) throw new BadRequestException('Some vehicles do not exist or are outside your area');
    await this.ds.transaction(async (m) => { await m.query(`DELETE FROM vehicle_group_members WHERE group_id=$1`, [id]); if (ok.length) await m.query(`INSERT INTO vehicle_group_members (group_id, vehicle_id) SELECT $1, unnest($2::uuid[])`, [id, ok]); });
    resetGroupScope(user.organizationId);
    return { id, vehicles: ok.length };
  }
  /** Which vehicle groups a geofence applies to (none = every vehicle). */
  async setGeofenceGroups(user: AuthUser, geofenceId: string, groupIds: unknown) {
    must(user, WRITE, 'change geofences');
    const [g] = await this.ds.query(`SELECT id FROM geofences WHERE id=$1 AND organization_id=$2`, [geofenceId, user.organizationId]); if (!g) throw new NotFoundException('Geofence not found');
    if (!Array.isArray(groupIds) || groupIds.some((x) => !UUID.test(String(x)))) throw new BadRequestException('groupIds must be a list of group ids');
    const ok: any[] = groupIds.length ? await this.ds.query(`SELECT id FROM vehicle_groups WHERE organization_id=$1 AND id = ANY($2::uuid[])`, [user.organizationId, groupIds]) : [];
    if (ok.length !== new Set(groupIds as string[]).size) throw new BadRequestException('Some groups do not exist');
    await this.ds.transaction(async (m) => { await m.query(`DELETE FROM geofence_groups WHERE geofence_id=$1`, [geofenceId]); if (ok.length) await m.query(`INSERT INTO geofence_groups (geofence_id, group_id) SELECT $1, unnest($2::uuid[])`, [geofenceId, ok.map((x) => x.id)]); });
    resetGroupScope(user.organizationId);
    return { geofenceId, groups: ok.length };
  }

  // ---------------------------------------------------------------- bulk import
  async importGeofences(user: AuthUser, b: any) {
    must(user, WRITE, 'import geofences');
    const format = String(b?.format ?? '').toLowerCase(), content = typeof b?.content === 'string' ? b.content : '';
    if (!['csv', 'geojson'].includes(format)) throw new BadRequestException('format must be csv or geojson (convert a shapefile with QGIS or ogr2ogr first)');
    if (!content.trim()) throw new BadRequestException('content is empty');
    if (content.length > 6_000_000) throw new BadRequestException('The file is too large (limit about 6 MB)');
    const rule = b?.rule === undefined ? 'notify' : b.rule; if (!['notify', 'restricted', 'allowed', 'lez'].includes(rule)) throw new BadRequestException('rule must be notify, restricted, allowed or lez');
    const groupIds: string[] = Array.isArray(b?.groupIds) ? b.groupIds : [];
    if (groupIds.length) { const ok = await this.ds.query(`SELECT id FROM vehicle_groups WHERE organization_id=$1 AND id = ANY($2::uuid[])`, [user.organizationId, groupIds]); if (ok.length !== new Set(groupIds).size) throw new BadRequestException('Some groups do not exist'); }
    const parsed = format === 'csv' ? parseCsv(content) : parseGeoJson(content);
    if (parsed.length === 1 && parsed[0].row === 0) throw new BadRequestException(parsed[0].error);
    const existing = new Set((await this.ds.query(`SELECT lower(name) AS n FROM geofences WHERE organization_id=$1`, [user.organizationId])).map((r: any) => r.n));
    const results: { row: number; name?: string; status: 'created' | 'skipped' | 'error' | 'ok'; message?: string; id?: string }[] = [];
    const dry = b?.dryRun === true;
    for (const p of parsed) {
      if (p.error) { results.push({ row: p.row, status: 'error', message: p.error }); continue; }
      const body = { ...p.body, rule, ...(b.color && !p.body.color ? { color: b.color } : {}) };
      const key = String(body.name ?? '').trim().toLowerCase();
      if (existing.has(key)) { results.push({ row: p.row, name: body.name, status: 'skipped', message: 'A geofence with this name already exists' }); continue; }
      if (dry) { results.push({ row: p.row, name: body.name, status: 'ok' }); existing.add(key); continue; }
      try {
        const g: any = await this.geofences.create(user, body);
        if (groupIds.length) await this.ds.query(`INSERT INTO geofence_groups (geofence_id, group_id) SELECT $1, unnest($2::uuid[])`, [g.id, groupIds]);
        existing.add(key); results.push({ row: p.row, name: body.name, status: 'created', id: g.id });
      } catch (e: any) { results.push({ row: p.row, name: body.name, status: 'error', message: e.response?.message ?? e.message }); }
    }
    resetGroupScope(user.organizationId);
    const count = (s: string) => results.filter((r) => r.status === s).length;
    return { dryRun: dry, total: results.length, created: count('created'), valid: count('ok'), skipped: count('skipped'), failed: count('error'), results: results.slice(0, 1000) };
  }

  // ---------------------------------------------------------------- map scope per user (admins)
  async getScope(user: AuthUser, userId: string) {
    must(user, ADMIN, 'set who sees which hubs');
    const rows = await this.ds.query(`SELECT hub_id AS "hubId" FROM user_map_scope WHERE user_id=$1 AND organization_id=$2`, [userId, user.organizationId]);
    return { userId, hubIds: rows.map((r: any) => r.hubId) };
  }
  async setScope(user: AuthUser, userId: string, hubIds: unknown) {
    must(user, ADMIN, 'set who sees which hubs');
    if (!UUID.test(userId)) throw new BadRequestException('Invalid user');
    const [u] = await this.ds.query(`SELECT id FROM users WHERE id=$1 AND organization_id=$2`, [userId, user.organizationId]); if (!u) throw new NotFoundException('User not found');
    if (!Array.isArray(hubIds) || hubIds.some((x) => !UUID.test(String(x)))) throw new BadRequestException('hubIds must be a list of hub ids');
    const ok: any[] = hubIds.length ? await this.ds.query(`SELECT id FROM hubs WHERE organization_id=$1 AND id = ANY($2::uuid[])`, [user.organizationId, hubIds]) : [];
    if (ok.length !== new Set(hubIds as string[]).size) throw new BadRequestException('Some hubs do not exist');
    await this.ds.transaction(async (m) => { await m.query(`DELETE FROM user_map_scope WHERE user_id=$1 AND organization_id=$2`, [userId, user.organizationId]); if (ok.length) await m.query(`INSERT INTO user_map_scope (user_id, organization_id, hub_id) SELECT $1, $2, unnest($3::uuid[])`, [userId, user.organizationId, ok.map((x) => x.id)]); });
    return { userId, hubIds: ok.map((x) => x.id) };
  }
  async myScope(user: AuthUser) {
    const s = await this.scope.hubScope(user);
    const hubs = s.all ? [] : await this.ds.query(`SELECT id, name FROM hubs WHERE id = ANY($1::uuid[])`, [s.hubIds]);
    return { all: s.all, hubs };
  }

  // ---------------------------------------------------------------- driver privacy
  async privacyList(user: AuthUser) {
    must(user, PRIVACY_ADMIN, 'see privacy settings');
    return this.ds.query(`SELECT p.vehicle_id AS "vehicleId", v.plate_number AS plate, p.enabled, p.timezone, p.work_days AS "workDays", to_char(p.start_time,'HH24:MI') AS start, to_char(p.end_time,'HH24:MI') AS "end" FROM vehicle_privacy p JOIN vehicles v ON v.id=p.vehicle_id WHERE p.organization_id=$1 ORDER BY v.plate_number`, [user.organizationId]);
  }
  async setPrivacy(user: AuthUser, vehicleId: string, b: any) {
    must(user, PRIVACY_ADMIN, 'change privacy settings');
    const [v] = await this.ds.query(`SELECT id FROM vehicles WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, [vehicleId, user.organizationId]); if (!v) throw new NotFoundException('Vehicle not found');
    const tz = String(b?.timezone ?? 'Africa/Accra'); try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { throw new BadRequestException('Unknown time zone (use a name like Africa/Accra)'); }
    const days = Array.isArray(b?.workDays) ? b.workDays.map(Number) : [1, 2, 3, 4, 5]; if (!days.length || days.some((d: number) => !Number.isInteger(d) || d < 1 || d > 7)) throw new BadRequestException('workDays must be numbers 1 (Monday) to 7 (Sunday)');
    const t = /^([01]\d|2[0-3]):[0-5]\d$/; const start = String(b?.start ?? '07:00'), end = String(b?.end ?? '19:00'); if (!t.test(start) || !t.test(end)) throw new BadRequestException('start and end must look like 07:00');
    await this.ds.query(`INSERT INTO vehicle_privacy (vehicle_id, organization_id, enabled, timezone, work_days, start_time, end_time) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (vehicle_id) DO UPDATE SET enabled=EXCLUDED.enabled, timezone=EXCLUDED.timezone, work_days=EXCLUDED.work_days, start_time=EXCLUDED.start_time, end_time=EXCLUDED.end_time`, [vehicleId, user.organizationId, b?.enabled !== false, tz, [...new Set(days)], start, end]);
    this.scope.clearPrivacy(user.organizationId);
    return { vehicleId };
  }
  async removePrivacy(user: AuthUser, vehicleId: string) {
    must(user, PRIVACY_ADMIN, 'change privacy settings');
    await this.ds.query(`DELETE FROM vehicle_privacy WHERE vehicle_id=$1 AND organization_id=$2`, [vehicleId, user.organizationId]); this.scope.clearPrivacy(user.organizationId);
    return { success: true };
  }

  // ---------------------------------------------------------------- dashcam links
  async camera(user: AuthUser, vehicleId: string) {
    const ids = await this.visibleVehicleIds(user, [vehicleId]); if (!ids.length) throw new NotFoundException('Vehicle not found');
    if (await this.scope.isOffDuty(user.organizationId, vehicleId)) throw new ForbiddenException('This vehicle is off duty (driver privacy)');
    const [c] = await this.ds.query(`SELECT provider, kind, live_url AS "liveUrl", clip_url_template AS "clipTemplate" FROM vehicle_cameras WHERE vehicle_id=$1 AND organization_id=$2`, [vehicleId, user.organizationId]);
    if (!c) return { configured: false };
    const now = Date.now(), iso = (t: number) => new Date(t).toISOString(), unix = (t: number) => String(Math.floor(t / 1000));
    const clip = c.clipTemplate ? c.clipTemplate.replace('{from}', encodeURIComponent(iso(now - 10_000))).replace('{to}', encodeURIComponent(iso(now))).replace('{from_unix}', unix(now - 10_000)).replace('{to_unix}', unix(now)) : null;
    return { configured: true, provider: c.provider, kind: c.kind, liveUrl: c.liveUrl, clipUrl: clip, note: 'Video comes from your camera provider. V-Track only stores the links.' };
  }
  async setCamera(user: AuthUser, vehicleId: string, b: any) {
    must(user, WRITE, 'change camera links');
    const [v] = await this.ds.query(`SELECT id FROM vehicles WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, [vehicleId, user.organizationId]); if (!v) throw new NotFoundException('Vehicle not found');
    const kind = String(b?.kind ?? ''); if (!['hls', 'mp4', 'iframe'].includes(kind)) throw new BadRequestException('kind must be hls, mp4 or iframe');
    const https = (u: any, what: string) => { if (u === undefined || u === null || u === '') return null; const s = String(u).trim(); if (s.length > 500 || !/^https:\/\/[^\s]+$/i.test(s.replace(/\{[a-z_]+\}/g, 'x'))) throw new BadRequestException(`${what} must be an https:// address`); return s; };
    const live = https(b.liveUrl, 'Live address'), clip = https(b.clipTemplate, 'Clip address');
    if (!live && !clip) throw new BadRequestException('Give a live address, a clip address, or both');
    await this.ds.query(`INSERT INTO vehicle_cameras (vehicle_id, organization_id, provider, kind, live_url, clip_url_template, updated_at) VALUES ($1,$2,$3,$4,$5,$6, now())
      ON CONFLICT (vehicle_id) DO UPDATE SET provider=EXCLUDED.provider, kind=EXCLUDED.kind, live_url=EXCLUDED.live_url, clip_url_template=EXCLUDED.clip_url_template, updated_at=now()`, [vehicleId, user.organizationId, b.provider ? String(b.provider).slice(0, 60) : null, kind, live, clip]);
    return { vehicleId };
  }
  async removeCamera(user: AuthUser, vehicleId: string) { must(user, WRITE, 'change camera links'); await this.ds.query(`DELETE FROM vehicle_cameras WHERE vehicle_id=$1 AND organization_id=$2`, [vehicleId, user.organizationId]); return { success: true }; }

  // ---------------------------------------------------------------- charging points
  async setAvailability(user: AuthUser, poiId: string, b: any) {
    must(user, WRITE, 'update charging availability');
    const cap = num(b?.capacity), av = num(b?.available);
    if (cap === undefined || av === undefined || (cap !== null && (!Number.isInteger(cap) || cap < 0)) || (av !== null && (!Number.isInteger(av) || av < 0))) throw new BadRequestException('capacity and available must be whole numbers, 0 or more');
    if (cap !== null && av !== null && av > cap) throw new BadRequestException('available cannot be more than capacity');
    const r = rowsOf(await this.ds.query(`UPDATE pois SET capacity=$3, available=$4, availability_updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id`, [poiId, user.organizationId, cap, av]));
    if (!r.length) throw new NotFoundException('Place not found'); return { id: poiId, capacity: cap, available: av };
  }

  // ---------------------------------------------------------------- sensor assets (trailers, generators, coolers)
  async assets(user: AuthUser) {
    const rows: any[] = await this.ds.query(`SELECT id, name, kind, latitude AS lat, longitude AS lng, last_report_at AS "lastReportAt", status, limits FROM map_assets WHERE organization_id=$1 AND is_active ORDER BY name`, [user.organizationId]);
    return rows.map((a) => ({ ...a, alarms: assetAlarms(a.status ?? {}, a.limits ?? {}), stale: !a.lastReportAt || Date.now() - new Date(a.lastReportAt).getTime() > 6 * 3600_000 }));
  }
  private cleanAsset(b: any, partial = false) {
    const out: any = {};
    if (!partial || b.name !== undefined) { const n = String(b?.name ?? '').trim(); if (n.length < 2 || n.length > 120) throw new BadRequestException('Name must be 2 to 120 characters'); out.name = n; }
    if (b.kind !== undefined) { if (!['trailer', 'generator', 'container', 'cooler', 'other'].includes(b.kind)) throw new BadRequestException('kind must be trailer, generator, container, cooler or other'); out.kind = b.kind; }
    if (b.limits !== undefined) { const l = b.limits ?? {}; const lim: any = {}; for (const k of ['tempMin', 'tempMax', 'batteryMin']) { if (l[k] !== undefined && l[k] !== null && l[k] !== '') { const n = Number(l[k]); if (!Number.isFinite(n)) throw new BadRequestException(`${k} must be a number`); lim[k] = n; } } out.limits = lim; }
    return out;
  }
  async createAsset(user: AuthUser, b: any) {
    must(user, WRITE, 'change assets'); const c = this.cleanAsset(b);
    const [r] = await this.ds.query(`INSERT INTO map_assets (organization_id, name, kind, limits) VALUES ($1,$2,$3,$4) RETURNING id`, [user.organizationId, c.name, c.kind ?? 'other', JSON.stringify(c.limits ?? {})]); return { id: r.id };
  }
  async updateAsset(user: AuthUser, id: string, b: any) {
    must(user, WRITE, 'change assets'); const c = this.cleanAsset(b, true);
    const [a] = await this.ds.query(`SELECT * FROM map_assets WHERE id=$1 AND organization_id=$2`, [id, user.organizationId]); if (!a) throw new NotFoundException('Asset not found');
    await this.ds.query(`UPDATE map_assets SET name=$3, kind=$4, limits=$5 WHERE id=$1 AND organization_id=$2`, [id, user.organizationId, c.name ?? a.name, c.kind ?? a.kind, JSON.stringify(c.limits ?? a.limits)]); return { id };
  }
  async removeAsset(user: AuthUser, id: string) { must(user, WRITE, 'change assets'); const r = rowsOf(await this.ds.query(`UPDATE map_assets SET is_active=false WHERE id=$1 AND organization_id=$2 RETURNING id`, [id, user.organizationId])); if (!r.length) throw new NotFoundException('Asset not found'); return { success: true }; }
  /** A sensor tracker reports its position and readings (called by the telemetry gateway, see docs/map.md). */
  async reportAsset(id: string, b: any) {
    const lat = num(b?.latitude), lng = num(b?.longitude);
    if ((lat !== null && (lat === undefined || Math.abs(lat) > 90)) || (lng !== null && (lng === undefined || Math.abs(lng) > 180))) throw new BadRequestException('latitude/longitude out of range');
    const st: any = {};
    for (const k of ['temperatureC', 'batteryPct', 'humidity']) { const n = num(b?.[k]); if (n === undefined) throw new BadRequestException(`${k} must be a number`); if (n !== null) st[k] = n; }
    if (b?.doorOpen !== undefined) st.doorOpen = b.doorOpen === true || b.doorOpen === 1;
    const r = rowsOf(await this.ds.query(`UPDATE map_assets SET latitude=COALESCE($3, latitude), longitude=COALESCE($4, longitude), status = status || $5::jsonb, last_report_at=now() WHERE id=$1 AND is_active AND $2::text IS NULL RETURNING id`, [id, null, lat, lng, JSON.stringify(st)]));
    if (!r.length) throw new NotFoundException('Asset not found'); return { id };
  }

  // ---------------------------------------------------------------- breakdown risk
  /** Per-vehicle risk with reasons (rule-based, from CAN/OBD/sensor readings, tracker battery and overdue maintenance) and whether it is far from a hub. */
  async risk(user: AuthUser) {
    const s = await this.scope.hubScope(user);
    const veh: any[] = await this.ds.query(
      `SELECT v.id, v.plate_number AS plate, v.fuel_type AS "fuelType", v.hub_id AS "hubId", d.id AS "deviceId", d.battery_level AS "deviceBattery",
              (SELECT count(*)::int FROM maintenance mt WHERE mt.vehicle_id = v.id AND mt.status='scheduled' AND mt.scheduled_date < CURRENT_DATE) AS overdue
         FROM vehicles v LEFT JOIN LATERAL (SELECT * FROM devices WHERE vehicle_id=v.id AND deleted_at IS NULL ORDER BY last_communication_at DESC NULLS LAST LIMIT 1) d ON true
        WHERE v.organization_id=$1 AND v.deleted_at IS NULL${s.all ? '' : ' AND v.hub_id = ANY($2::uuid[])'}`, s.all ? [user.organizationId] : [user.organizationId, s.hubIds]);
    const devIds = veh.map((v) => v.deviceId).filter(Boolean);
    const pos: any[] = devIds.length ? await this.ts.query(`SELECT p.* FROM unnest($1::uuid[]) AS dev(id) CROSS JOIN LATERAL (SELECT device_id, latitude, longitude, fuel_level, obd_data, sensors, "timestamp" FROM positions WHERE device_id = dev.id ORDER BY "timestamp" DESC LIMIT 1) p`, [devIds]) : [];
    const byDev = new Map(pos.map((p) => [p.device_id, p]));
    const hubs: any[] = await this.ds.query(`SELECT id, name, latitude, longitude FROM hubs WHERE organization_id=$1 AND latitude IS NOT NULL AND longitude IS NOT NULL`, [user.organizationId]);
    const priv = await this.scope.privacy(user.organizationId);
    const remoteKm = Number(process.env.MAP_REMOTE_KM ?? 15);
    const out: any[] = [];
    for (const v of veh) {
      const cfg = priv.get(v.id); if (cfg && !isWorkTime(cfg, new Date())) continue;
      const p = v.deviceId ? byDev.get(v.deviceId) : null; if (!p) continue;
      const t = normalizeTelemetry(p.obd_data, p.sensors, p.fuel_level);
      const r = riskScore(t, { deviceBattery: v.deviceBattery !== null ? Number(v.deviceBattery) : null, overdueMaintenance: v.overdue, electric: !/petrol|diesel|gas/i.test(v.fuelType ?? '') });
      if (r.score === 0) continue;
      let nearest: { name: string; km: number } | null = null;
      for (const h of hubs) { const km = haversineDistanceMeters(Number(p.latitude), Number(p.longitude), Number(h.latitude), Number(h.longitude)) / 1000; if (!nearest || km < nearest.km) nearest = { name: h.name, km: Math.round(km * 10) / 10 }; }
      const remote = !!nearest && nearest.km > remoteKm;
      out.push({ vehicleId: v.id, plate: v.plate, lat: Number(p.latitude), lng: Number(p.longitude), ...r, nearestHub: nearest, remote, advice: r.level === 'high' ? (remote ? 'High risk and far from a hub: do not dispatch to remote areas; recover or service first.' : 'High risk: service before the next long job.') : r.level === 'medium' ? 'Watch closely; avoid remote jobs if it gets worse.' : 'Low risk.', telemetry: t });
    }
    out.sort((a, b) => b.score - a.score);
    return { generatedAt: new Date().toISOString(), remoteKm, vehicles: out };
  }

  /** Places where fault readings were recorded in the last days (hot engine, fault codes, low charge) as a heat map. */
  async riskAreas(user: AuthUser, q: { days?: string; precision?: string }) {
    const days = Math.max(1, Math.min(31, Number(q.days ?? 7) || 7));
    const s = await this.scope.hubScope(user);
    const devs: any[] = await this.ds.query(`SELECT d.id, d.vehicle_id FROM devices d JOIN vehicles v ON v.id=d.vehicle_id WHERE d.organization_id=$1 AND v.deleted_at IS NULL${s.all ? '' : ' AND v.hub_id = ANY($2::uuid[])'}`, s.all ? [user.organizationId] : [user.organizationId, s.hubIds]);
    const priv = await this.scope.privacy(user.organizationId);
    const ids = devs.filter((d) => !priv.has(d.vehicle_id)).map((d) => d.id); // vehicles with working-hours privacy are left out of area statistics
    if (!ids.length) return { cells: [], max: 0, days };
    const step = { 3: 0.001, 2: 0.01 }[Number(q.precision) as 2 | 3] ?? 0.005;
    const num = (k: string) => `CASE WHEN jsonb_typeof(obd_data->'${k}')='number' THEN (obd_data->>'${k}')::numeric END`;
    const rows: any[] = await this.ts.query(
      `SELECT (ROUND(latitude / $3::numeric) * $3::numeric)::float8 AS lat, (ROUND(longitude / $3::numeric) * $3::numeric)::float8 AS lng, COUNT(*)::int AS n
         FROM positions WHERE device_id = ANY($1::uuid[]) AND "timestamp" > $2 AND obd_data IS NOT NULL
          AND (${num('coolantTemp')} >= 95 OR ${num('motorTemp')} >= 85 OR ${num('soc')} <= 15 OR (jsonb_typeof(obd_data->'dtc')='array' AND jsonb_array_length(obd_data->'dtc') > 0))
        GROUP BY 1, 2 ORDER BY n DESC LIMIT 5000`, [ids, new Date(Date.now() - days * 86400_000), step]);
    return { cells: rows.map((r) => [r.lat, r.lng, r.n]), max: rows.length ? rows[0].n : 0, days, cellMeters: Math.round(step * 111000) };
  }
}
