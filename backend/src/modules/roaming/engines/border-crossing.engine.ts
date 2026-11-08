import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { BorderCrossing } from '../entities/border-crossing.entity';
import { CorridorEvent } from '../entities/corridor-event.entity';
import { TravelCorridor } from '../entities/travel-corridor.entity';
import { CountryBoundary } from '../entities/country-boundary.entity';
import { SimProfile } from '../entities/sim-profile.entity';
import { Device } from '../../devices/entities/device.entity';
import { ParsedPosition } from '../../devices/processors/protocol.interface';
import { AlertsService } from '../../alerts/alerts.service';
import { AlertSeverity, AlertType } from '../../../common/constants/alerts.constant';
import { RealtimeEventsGateway } from '../../realtime/realtime-events.gateway';
import { ServerEvents } from '../../../common/constants/websocket-events.constant';

interface DeviceCountryState {
  country: string | null;
  sinceTimestamp: Date;
}

@Injectable()
export class BorderCrossingEngine {
  private readonly logger = new Logger(BorderCrossingEngine.name);
  /** In-memory last-known country per device - move to Redis before running more than one instance. */
  private readonly lastCountry = new Map<string, DeviceCountryState>();

  constructor(
    @InjectRepository(BorderCrossing) private readonly crossings: Repository<BorderCrossing>,
    @InjectRepository(CorridorEvent) private readonly corridorEvents: Repository<CorridorEvent>,
    @InjectRepository(TravelCorridor) private readonly corridors: Repository<TravelCorridor>,
    @InjectRepository(CountryBoundary) private readonly boundaries: Repository<CountryBoundary>,
    @InjectRepository(SimProfile) private readonly simProfiles: Repository<SimProfile>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    private readonly alertsService: AlertsService,
    private readonly realtimeGateway: RealtimeEventsGateway,
  ) {}

  @OnEvent('position.created')
  async onPosition(payload: { deviceId: string; position: ParsedPosition }) {
    const country = await this.detectCountry(payload.position.latitude, payload.position.longitude);
    const previous = this.lastCountry.get(payload.deviceId);

    if (!previous) {
      this.lastCountry.set(payload.deviceId, { country, sinceTimestamp: payload.position.timestamp });
      return;
    }

    if (country !== previous.country) {
      await this.handleCrossing(payload.deviceId, previous.country, country, payload.position);
      this.lastCountry.set(payload.deviceId, { country, sinceTimestamp: payload.position.timestamp });
    }
  }

  /** Point-in-polygon lookup against the real country_boundaries table via PostGIS. Returns null if outside every known boundary. */
  private async detectCountry(lat: number, lon: number): Promise<string | null> {
    const result = await this.boundaries.query(
      `SELECT country_code FROM country_boundaries
       WHERE ST_Contains(geom::geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326))
       LIMIT 1`,
      [lon, lat],
    );
    return result?.[0]?.country_code ?? null;
  }

  private async handleCrossing(deviceId: string, fromCountry: string | null, toCountry: string | null, position: ParsedPosition) {
    if (!toCountry) return; // left all known boundaries - nothing to record yet

    const device = await this.devices.findOne({ where: { id: deviceId } });
    if (!device) return;

    const sim = await this.simProfiles.findOne({ where: { deviceId } });
    const isAuthorized = this.isCountryAuthorized(toCountry, sim);

    const crossing = await this.crossings.save(
      this.crossings.create({
        deviceId,
        vehicleId: device.vehicleId,
        crossingType: 'entry',
        fromCountry: fromCountry ?? undefined,
        toCountry,
        latitude: position.latitude,
        longitude: position.longitude,
        crossedAt: position.timestamp,
        isAuthorized,
      }),
    );

    this.logger.log(`Border crossing: device ${deviceId} entered ${toCountry} (from ${fromCountry ?? 'unknown'})`);

    this.realtimeGateway.emit(device.organizationId, ServerEvents.BORDER_CROSSING_DETECTED, {
      deviceId,
      vehicleId: device.vehicleId,
      fromCountry,
      toCountry,
      isAuthorized,
      latitude: position.latitude,
      longitude: position.longitude,
      crossedAt: position.timestamp,
    });

    // "Roaming" in the SIM sense means outside the org's home country - a
    // real SIM profile check would compare against the SIM's registered
    // home network; here we treat any crossing away from the device's
    // *previous* country as a roaming status change, which is the
    // information a dashboard actually needs regardless of SIM specifics.
    this.realtimeGateway.emit(device.organizationId, ServerEvents.ROAMING_STATUS_CHANGED, {
      deviceId,
      country: toCountry,
      roaming: Boolean(fromCountry && fromCountry !== toCountry),
    });

    if (!isAuthorized) {
      await this.alertsService.raise({
        organizationId: device.organizationId,
        deviceId,
        vehicleId: device.vehicleId,
        type: AlertType.GEOFENCE_ENTRY,
        severity: AlertSeverity.HIGH,
        title: `Unauthorized country entry: ${device.name ?? device.imei} entered ${toCountry}`,
        position: { latitude: position.latitude, longitude: position.longitude },
        metadata: { crossingId: crossing.id, fromCountry, toCountry },
      });
    }

    await this.checkCorridorCompliance(device, toCountry, position, crossing.id);
  }

  private isCountryAuthorized(country: string, sim: SimProfile | null): boolean {
    if (!sim) return true; // no SIM policy configured - don't block on missing data
    if (sim.blockedCountries?.includes(country)) return false;
    if (sim.allowedCountries?.length && !sim.allowedCountries.includes(country)) return false;
    return true;
  }

  private async checkCorridorCompliance(device: Device, enteredCountry: string, position: ParsedPosition, crossingId: string) {
    const corridors = await this.corridors.find({ where: { organizationId: device.organizationId, isActive: true } });

    for (const corridor of corridors) {
      if (!corridor.expectedCountries.includes(enteredCountry)) {
        await this.corridorEvents.save(
          this.corridorEvents.create({
            corridorId: corridor.id,
            deviceId: device.id,
            eventType: 'unauthorized_country',
            country: enteredCountry,
            latitude: position.latitude,
            longitude: position.longitude,
            details: { crossingId },
            timestamp: position.timestamp,
          }),
        );

        await this.alertsService.raise({
          organizationId: device.organizationId,
          deviceId: device.id,
          vehicleId: device.vehicleId,
          type: AlertType.ROUTE_DEVIATION,
          severity: AlertSeverity.HIGH,
          title: `Corridor deviation: ${device.name ?? device.imei} entered ${enteredCountry}, outside "${corridor.name}"'s expected route`,
          position: { latitude: position.latitude, longitude: position.longitude },
        });

        this.realtimeGateway.emit(device.organizationId, ServerEvents.CORRIDOR_DEVIATION_DETECTED, {
          deviceId: device.id,
          corridorId: corridor.id,
          corridorName: corridor.name,
          enteredCountry,
          latitude: position.latitude,
          longitude: position.longitude,
        });
      }
    }
  }

  /** Called by a scheduled sweep to flag border stops exceeding a corridor's configured dwell threshold. */
  async checkLongBorderStops(): Promise<void> {
    const activeStates = [...this.lastCountry.entries()];
    for (const [deviceId, state] of activeStates) {
      const dwellMinutes = (Date.now() - state.sinceTimestamp.getTime()) / 60_000;
      const device = await this.devices.findOne({ where: { id: deviceId } });
      if (!device) continue;

      const corridors = await this.corridors.find({ where: { organizationId: device.organizationId, isActive: true } });
      for (const corridor of corridors) {
        if (dwellMinutes > corridor.maxBorderDwellMinutes) {
          await this.corridorEvents.save(
            this.corridorEvents.create({
              corridorId: corridor.id,
              deviceId,
              eventType: 'long_stop',
              country: state.country ?? undefined,
              details: { dwellMinutes: Math.round(dwellMinutes) },
              timestamp: new Date(),
            }),
          );
        }
      }
    }
  }
}
