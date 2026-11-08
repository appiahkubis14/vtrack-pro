import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Geofence, GeofenceType } from './entities/geofence.entity';
import { GeofenceEvent } from './entities/geofence-event.entity';
import { isInsideCircle } from '../../helpers/geo.helper';
import { AuthUser } from '../../common/auth/auth-user';

const HEX = /^#[0-9a-fA-F]{6}$/;
const lat = (v: any) => typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
const lng = (v: any) => typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;
const WRITABLE = ['name', 'description', 'type', 'coordinates', 'radius', 'centerLatitude', 'centerLongitude', 'speedLimit', 'schedule', 'alerts', 'color', 'isActive', 'anchorVehicleId', 'hysteresis', 'rule'];

/** All reads and writes are limited to the caller's organization. */
@Injectable()
export class GeofencesService {
  constructor(
    @InjectRepository(Geofence) private readonly geofences: Repository<Geofence>,
    @InjectRepository(GeofenceEvent) private readonly geofenceEvents: Repository<GeofenceEvent>,
  ) {}

  findAll(user: AuthUser) {
    return this.geofences.find({ where: { organizationId: user.organizationId }, order: { createdAt: 'DESC' } });
  }

  active(user: AuthUser) {
    return this.geofences.find({ where: { organizationId: user.organizationId, isActive: true }, order: { createdAt: 'DESC' } });
  }

  async findOne(user: AuthUser, id: string) {
    const g = await this.geofences.findOne({ where: { id, organizationId: user.organizationId } });
    if (!g) throw new NotFoundException('Geofence not found');
    return g;
  }

  /** Checks a request body and returns only the fields that may be stored. Throws a readable message for anything wrong. */
  private async clean(user: AuthUser, b: any, existing?: Geofence): Promise<Partial<Geofence>> {
    if (!b || typeof b !== 'object') throw new BadRequestException('Send the geofence as a JSON object');
    const out: any = {};
    for (const k of WRITABLE) if (b[k] !== undefined) out[k] = b[k];
    const type = (out.type ?? existing?.type) as GeofenceType;
    if (!existing || out.name !== undefined) {
      const n = String(out.name ?? '').trim();
      if (n.length < 2 || n.length > 120) throw new BadRequestException('Name must be 2 to 120 characters');
      out.name = n;
    }
    if (!existing && ![GeofenceType.CIRCLE, GeofenceType.POLYGON, GeofenceType.RECTANGLE].includes(type)) throw new BadRequestException('Type must be circle, polygon or rectangle');
    if (existing && out.type !== undefined && out.type !== existing.type) throw new BadRequestException('The shape type cannot be changed; draw a new geofence instead');
    if (out.description !== undefined) out.description = out.description ? String(out.description).slice(0, 1000) : null;
    if (out.rule !== undefined && !['notify', 'restricted', 'allowed', 'lez'].includes(out.rule)) throw new BadRequestException('rule must be notify, restricted, allowed or lez');
    if (out.color !== undefined && !HEX.test(out.color)) throw new BadRequestException('Colour must look like #1a73e8');
    if (!existing && out.color === undefined) out.color = '#358ffc';
    if (out.speedLimit !== undefined && out.speedLimit !== null) {
      const s = Number(out.speedLimit); if (!Number.isInteger(s) || s < 1 || s > 300) throw new BadRequestException('Speed limit must be a whole number from 1 to 300 km/h'); out.speedLimit = s;
    }
    if (out.alerts !== undefined) {
      const a = out.alerts; if (a === null || typeof a !== 'object' || Array.isArray(a)) throw new BadRequestException('alerts must be an object like {"onEntry":true,"onExit":true}');
      out.alerts = { onEntry: a.onEntry !== false, onExit: a.onExit !== false };
    } else if (!existing) out.alerts = { onEntry: true, onExit: true };
    if (out.schedule !== undefined && out.schedule !== null && (typeof out.schedule !== 'object' || Array.isArray(out.schedule))) throw new BadRequestException('schedule must be an object');
    if (out.hysteresis !== undefined) {
      const h = out.hysteresis; if (h === null || typeof h !== 'object') throw new BadRequestException('hysteresis must be an object');
      const pick = (k: string, min: number, max: number, dflt: number) => { const v = h[k] === undefined ? dflt : Number(h[k]); if (!Number.isFinite(v) || v < min || v > max) throw new BadRequestException(`hysteresis.${k} must be between ${min} and ${max}`); return v; };
      out.hysteresis = { entryDwellSeconds: pick('entryDwellSeconds', 0, 3600, 10), exitDwellSeconds: pick('exitDwellSeconds', 0, 3600, 15), accuracyThresholdMeters: pick('accuracyThresholdMeters', 0, 500, 30), bufferMeters: pick('bufferMeters', 0, 500, 10), cooldownSeconds: pick('cooldownSeconds', 0, 86400, 300) };
    }

    if (type === GeofenceType.CIRCLE) {
      const cLat = out.centerLatitude ?? existing?.centerLatitude, cLng = out.centerLongitude ?? existing?.centerLongitude;
      const r = out.radius !== undefined ? Number(out.radius) : Number(existing?.radius);
      if (!lat(Number(cLat)) || !lng(Number(cLng))) throw new BadRequestException('A circle needs centerLatitude and centerLongitude');
      if (!Number.isFinite(r) || r < 10 || r > 100000) throw new BadRequestException('Radius must be from 10 to 100000 metres');
      out.centerLatitude = Number(cLat); out.centerLongitude = Number(cLng); out.radius = r; out.coordinates = null;
    } else if (type) {
      if (out.coordinates !== undefined || !existing) this.checkPolygon(out.coordinates);
      if (out.anchorVehicleId) throw new BadRequestException('Only a circle can follow a vehicle');
      out.centerLatitude = null; out.centerLongitude = null; out.radius = null;
    }

    if (out.anchorVehicleId !== undefined && out.anchorVehicleId !== null) {
      if (type !== GeofenceType.CIRCLE) throw new BadRequestException('Only a circle can follow a vehicle');
      const [v] = await this.geofences.query(`SELECT id FROM vehicles WHERE id = $1::uuid AND organization_id = $2 AND deleted_at IS NULL`, [String(out.anchorVehicleId), user.organizationId]).catch(() => []);
      if (!v) throw new BadRequestException('The vehicle this zone should follow was not found');
    }
    return out;
  }

  private checkPolygon(c: any) {
    if (!c || c.type !== 'Polygon' || !Array.isArray(c.coordinates) || c.coordinates.length < 1) throw new BadRequestException('A polygon needs coordinates as GeoJSON: {"type":"Polygon","coordinates":[[[lng,lat],...]]}');
    const ring = c.coordinates[0];
    if (!Array.isArray(ring) || ring.length < 4) throw new BadRequestException('A polygon needs at least 3 corners');
    if (ring.length > 501) throw new BadRequestException('A polygon can have at most 500 corners');
    for (const p of ring) if (!Array.isArray(p) || p.length < 2 || !lng(p[0]) || !lat(p[1])) throw new BadRequestException('Every corner must be [longitude, latitude] within valid ranges');
    const first = ring[0], last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) throw new BadRequestException('The polygon must close: the last corner must equal the first');
    c.coordinates = [ring.map((p: number[]) => [p[0], p[1]])];
  }

  /** Rejects shapes that cross themselves, using PostGIS. */
  private async assertValidShape(coords: any) {
    const [r] = await this.geofences.query(`SELECT ST_IsValid(g) AS ok, ST_IsValidReason(g) AS why FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g) t`, [JSON.stringify(coords)]);
    if (!r?.ok) throw new BadRequestException(`That shape is not valid (${r?.why ?? 'unknown'}). Make sure its sides do not cross.`);
  }

  async create(user: AuthUser, body: any) {
    const c = await this.clean(user, body);
    if (c.coordinates) await this.assertValidShape(c.coordinates);
    const g = this.geofences.create({ ...c, organizationId: user.organizationId, createdBy: user.sub } as any) as unknown as Geofence;
    return this.geofences.save(g);
  }

  async update(user: AuthUser, id: string, body: any) {
    const existing = await this.findOne(user, id);
    const c = await this.clean(user, body, existing);
    if (c.coordinates) await this.assertValidShape(c.coordinates);
    if (!Object.keys(c).length) throw new BadRequestException('Nothing to change');
    await this.geofences.update({ id, organizationId: user.organizationId }, c as any);
    return this.findOne(user, id);
  }

  async remove(user: AuthUser, id: string) {
    await this.findOne(user, id);
    await this.geofences.softDelete({ id, organizationId: user.organizationId });
    return { success: true };
  }

  async test(user: AuthUser, id: string, body: { latitude: number; longitude: number }) {
    if (!lat(body?.latitude) || !lng(body?.longitude)) throw new BadRequestException('latitude and longitude must be valid numbers');
    const g = await this.findOne(user, id);
    if (g.type === 'circle') {
      if (g.centerLatitude == null || g.centerLongitude == null || !g.radius) return { inside: false, reason: 'circle geofence missing center/radius' };
      return { inside: isInsideCircle(body.latitude, body.longitude, Number(g.centerLatitude), Number(g.centerLongitude), Number(g.radius)) };
    }
    const r = await this.geofences.query(`SELECT ST_Contains(coordinates::geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326)) AS inside FROM geofences WHERE id = $3`, [body.longitude, body.latitude, id]);
    return { inside: Boolean(r?.[0]?.inside) };
  }

  async events(user: AuthUser, id: string) {
    await this.findOne(user, id);
    return this.geofenceEvents.find({ where: { geofenceId: id }, order: { timestamp: 'DESC' }, take: 200 });
  }
}
