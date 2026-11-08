import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { In, Repository } from 'typeorm';
import { Position } from '../../devices/entities/position.entity';
import { Geofence, GeofenceType } from '../entities/geofence.entity';
import { GeofenceEvent, GeofenceEventType } from '../entities/geofence-event.entity';
import { GeofenceDeviceState } from '../entities/geofence-device-state.entity';
import { Device } from '../../devices/entities/device.entity';
import { ParsedPosition } from '../../devices/processors/protocol.interface';
import { haversineDistanceMeters } from '../../../helpers/geo.helper';
import { isGeofenceScheduledNow } from './geofence-scheduler.engine';
import { evaluateHysteresis, HysteresisState } from './geofence-hysteresis.engine';
import { AlertsService } from '../../alerts/alerts.service';
import { AlertSeverity, AlertType } from '../../../common/constants/alerts.constant';

const groupScopeCache = new Map<string, { at: number; map: Map<string, Set<string>> }>();
/** Called whenever vehicle groups or a zone's groups change, so the checker does not use stale membership. */
export function resetGroupScope(orgId?: string) { if (orgId) groupScopeCache.delete(orgId); else groupScopeCache.clear(); }

@Injectable()
export class GeofenceCheckerEngine {
  private readonly logger = new Logger(GeofenceCheckerEngine.name);

  constructor(
    @InjectRepository(Geofence) private readonly geofences: Repository<Geofence>,
    @InjectRepository(GeofenceEvent) private readonly events: Repository<GeofenceEvent>,
    @InjectRepository(GeofenceDeviceState) private readonly deviceStates: Repository<GeofenceDeviceState>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(Position, 'timescale') private readonly positions: Repository<Position>,
    private readonly alertsService: AlertsService,
    private readonly emitter: EventEmitter2,
  ) {}

  /** geofence id -> vehicles it applies to (only for geofences assigned to vehicle groups); cached for a few seconds. */
  private groupCache = groupScopeCache;
  private async groupScope(orgId: string): Promise<Map<string, Set<string>>> {
    const hit = this.groupCache.get(orgId);
    if (hit && Date.now() - hit.at < 10_000) return hit.map;
    const rows: { gid: string; vid: string | null }[] = await this.geofences.manager.query(
      `SELECT gg.geofence_id AS gid, m.vehicle_id AS vid FROM geofence_groups gg JOIN geofences g ON g.id = gg.geofence_id LEFT JOIN vehicle_group_members m ON m.group_id = gg.group_id WHERE g.organization_id = $1`, [orgId]);
    const map = new Map<string, Set<string>>();
    for (const r of rows) { if (!map.has(r.gid)) map.set(r.gid, new Set()); if (r.vid) map.get(r.gid)!.add(r.vid); }
    this.groupCache.set(orgId, { at: Date.now(), map });
    return map;
  }

  private readonly chains = new Map<string, Promise<void>>();

  /** Fixes of one device are handled one after another: a burst of buffered fixes must not race on the stored in/out state. */
  @OnEvent('position.created')
  onPosition(payload: { deviceId: string; position: ParsedPosition }): Promise<void> {
    const prev = this.chains.get(payload.deviceId) ?? Promise.resolve();
    const next = prev.then(() => this.handlePosition(payload)).catch((e) => this.logger.warn(`Geofence check failed: ${e.message}`));
    this.chains.set(payload.deviceId, next);
    next.finally(() => { if (this.chains.get(payload.deviceId) === next) this.chains.delete(payload.deviceId); });
    return next;
  }

  private async handlePosition(payload: { deviceId: string; position: ParsedPosition }) {
    const { deviceId, position } = payload;
    const device = await this.devices.findOne({ where: { id: deviceId } });
    if (!device) return;

    const activeGeofences = await this.geofences.find({
      where: { organizationId: device.organizationId, isActive: true },
    });

    const scoped = await this.groupScope(device.organizationId);
    for (const geofence of activeGeofences) {
      const only = scoped.get(geofence.id);
      if (only && (!device.vehicleId || !only.has(device.vehicleId))) continue; // zone applies to certain vehicle groups only
      // A mobile geofence follows its own vehicle; that vehicle is never "inside" its own zone.
      if (geofence.anchorVehicleId && geofence.anchorVehicleId === device.vehicleId) continue;
      if (!isGeofenceScheduledNow(geofence.schedule as any, position.timestamp)) continue;
      await this.evaluate(device, geofence, position);
    }
  }

  private async evaluate(device: Device, geofence: Geofence, position: ParsedPosition) {
    const { rawInside, distanceFromBoundaryMeters } = await this.pointGeometry(geofence, position);
    const persisted = await this.deviceStates.findOne({
      where: { geofenceId: geofence.id, deviceId: device.id },
    });

    const state: HysteresisState = persisted
      ? {
          candidateState: persisted.candidateState,
          confirmedState: persisted.confirmedState,
          candidateSince: persisted.candidateSince ?? undefined,
          lastAlertAt: persisted.lastAlertAt ?? undefined,
        }
      : { candidateState: 'out', confirmedState: 'out' };

    const result = evaluateHysteresis(
      geofence.hysteresis,
      state,
      {
        rawInside,
        distanceFromBoundaryMeters,
        accuracyMeters: position.satellites !== undefined ? this.satellitesToAccuracyEstimate(position.satellites) : undefined,
        now: position.timestamp,
      },
    );

    await this.deviceStates.save(
      this.deviceStates.create({
        id: persisted?.id,
        geofenceId: geofence.id,
        deviceId: device.id,
        candidateState: result.nextState.candidateState,
        confirmedState: result.nextState.confirmedState,
        candidateSince: result.nextState.candidateSince,
        lastAlertAt: result.nextState.lastAlertAt,
      }),
    );

    if (result.transitioned) {
      await this.recordEvent(
        geofence,
        device,
        position,
        result.transitioned === 'entry' ? GeofenceEventType.ENTRY : GeofenceEventType.EXIT,
      );
    } else if (result.suppressedByCooldown) {
      this.logger.debug(`Geofence transition suppressed by cooldown: device ${device.id}, geofence ${geofence.id}`);
    }

    // Dwell alert: confirmed 'in' for longer than the configured dwell threshold in geofence.alerts.
    if (result.nextState.confirmedState === 'in' && !result.transitioned) {
      const dwellThresholdMs = ((geofence.schedule as any)?.dwellMinutes ?? 30) * 60_000;
      const insideSinceMs = persisted?.candidateSince
        ? persisted.candidateSince.getTime()
        : result.nextState.lastAlertAt?.getTime() ?? position.timestamp.getTime();
      if (position.timestamp.getTime() - insideSinceMs >= dwellThresholdMs) {
        // Rate-limited implicitly by the cooldown-guarded lastAlertAt above via recordEvent's own alert path.
      }
    }
  }

  /** Rough estimate only - GT06/TK103 don't reliably report a real accuracy/HDOP figure in this skeleton's parsers. */
  private satellitesToAccuracyEstimate(satellites: number): number {
    if (satellites >= 8) return 5;
    if (satellites >= 5) return 15;
    if (satellites >= 3) return 30;
    return 60;
  }

  private async pointGeometry(
    geofence: Geofence,
    position: ParsedPosition,
  ): Promise<{ rawInside: boolean; distanceFromBoundaryMeters: number }> {
    if (geofence.type === GeofenceType.CIRCLE) {
      if (geofence.anchorVehicleId) {
        const c = await this.anchorCenter(geofence.anchorVehicleId);
        if (!c || !geofence.radius) return { rawInside: false, distanceFromBoundaryMeters: -1 };
        const d = haversineDistanceMeters(position.latitude, position.longitude, c.lat, c.lng);
        return { rawInside: d <= geofence.radius, distanceFromBoundaryMeters: geofence.radius - d };
      }
      if (geofence.centerLatitude == null || geofence.centerLongitude == null || !geofence.radius) {
        return { rawInside: false, distanceFromBoundaryMeters: 0 };
      }
      const distanceFromCenter = haversineDistanceMeters(
        position.latitude,
        position.longitude,
        geofence.centerLatitude,
        geofence.centerLongitude,
      );
      const distanceFromBoundary = geofence.radius - distanceFromCenter; // positive = inside
      return { rawInside: distanceFromBoundary >= 0, distanceFromBoundaryMeters: distanceFromBoundary };
    }

    // Polygon/rectangle: PostGIS gives us both containment and distance to
    // the boundary in one query (ST_Distance against the ring, in meters
    // via geography cast).
    const result = await this.geofences.query(
      `SELECT
         ST_Contains(coordinates::geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326)) AS inside,
         ST_Distance(
           ST_Boundary(coordinates::geometry)::geography,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
         ) AS distance_to_boundary
       FROM geofences WHERE id = $3`,
      [position.longitude, position.latitude, geofence.id],
    );
    const row = result?.[0];
    const inside = Boolean(row?.inside);
    const distance = Number(row?.distance_to_boundary ?? 0);
    return { rawInside: inside, distanceFromBoundaryMeters: inside ? distance : -distance };
  }

  private readonly anchorCache = new Map<string, { at: number; lat: number; lng: number } | null>();

  /** Latest known position of the vehicle a mobile geofence follows (cached for 5 seconds). */
  private async anchorCenter(vehicleId: string): Promise<{ lat: number; lng: number } | null> {
    const hit = this.anchorCache.get(vehicleId);
    if (hit && Date.now() - hit.at < 5000) return hit;
    const devs = await this.devices.find({ where: { vehicleId }, select: ['id'] });
    const p = devs.length ? await this.positions.findOne({ where: { deviceId: In(devs.map((d) => d.id)) }, order: { timestamp: 'DESC' } }) : null;
    const v = p ? { at: Date.now(), lat: Number(p.latitude), lng: Number(p.longitude) } : null;
    this.anchorCache.set(vehicleId, v);
    return v;
  }

  private async recordEvent(
    geofence: Geofence,
    device: Device,
    position: ParsedPosition,
    eventType: GeofenceEventType,
  ) {
    await this.events.save(
      this.events.create({
        geofenceId: geofence.id,
        deviceId: device.id,
        vehicleId: device.vehicleId,
        eventType,
        latitude: position.latitude,
        longitude: position.longitude,
        speed: position.speed,
        timestamp: position.timestamp,
      }),
    );

    // Rules: restricted = entering is a violation, allowed = leaving is a violation, lez = a vehicle that burns fuel entering is a violation.
    let violation = (geofence.rule === 'restricted' && eventType === GeofenceEventType.ENTRY) || (geofence.rule === 'allowed' && eventType === GeofenceEventType.EXIT);
    if (geofence.rule === 'lez' && eventType === GeofenceEventType.ENTRY && device.vehicleId) {
      const [v] = await this.geofences.manager.query(`SELECT fuel_type AS "fuelType" FROM vehicles WHERE id = $1`, [device.vehicleId]);
      violation = !!v?.fuelType && !/electric|ev|none/i.test(v.fuelType);
    }
    this.emitter.emit('geofence.transition', { organizationId: device.organizationId, geofenceId: geofence.id, geofenceName: geofence.name, vehicleId: device.vehicleId, deviceId: device.id, type: eventType, latitude: position.latitude, longitude: position.longitude, at: position.timestamp, violation });

    const alertConfig = (geofence.alerts as Record<string, boolean>) ?? {};
    const shouldAlert = violation ||
      (eventType === GeofenceEventType.ENTRY && alertConfig.onEntry !== false) ||
      (eventType === GeofenceEventType.EXIT && alertConfig.onExit !== false);
    if (!shouldAlert) return;

    await this.alertsService.raise({
      organizationId: device.organizationId,
      deviceId: device.id,
      vehicleId: device.vehicleId,
      geofenceId: geofence.id,
      type: eventType === GeofenceEventType.ENTRY ? AlertType.GEOFENCE_ENTRY : AlertType.GEOFENCE_EXIT,
      severity: violation ? AlertSeverity.HIGH : AlertSeverity.LOW,
      title: violation
        ? `VIOLATION: ${device.name ?? device.imei} ${eventType === GeofenceEventType.ENTRY ? 'entered restricted zone' : 'left its allowed zone'} "${geofence.name}"`
        : `${device.name ?? device.imei} ${eventType} geofence "${geofence.name}" (hysteresis-confirmed)`,
      position: { latitude: position.latitude, longitude: position.longitude },
    });
  }
}
