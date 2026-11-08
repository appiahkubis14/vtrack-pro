import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VehicleDevice } from './entities/vehicle-device.entity';
import { DeviceTelemetrySource } from './entities/device-telemetry-source.entity';
import { DEFAULT_ROLE_PRIORITY, DeviceRole, TelemetryField } from './entities/device-role.constant';
import { Device } from '../devices/entities/device.entity';
import { DigitalTwinGateway } from '../twin/digital-twin.gateway';

export interface FieldReading<T> {
  deviceId: string;
  value: T;
  observedAt: Date;
}

const STALE_AFTER_MS = 10 * 60 * 1000; // readings older than this are ignored during fusion
const CONFLICT_THRESHOLD = {
  // If two devices disagree by more than this on the same field within the
  // freshness window, flag it as a conflict rather than silently picking one.
  location_meters: 500,
  fuel_percent: 15,
  ev_battery_percent: 10,
};

@Injectable()
export class SensorFusionService {
  private readonly logger = new Logger(SensorFusionService.name);

  constructor(
    @InjectRepository(VehicleDevice) private readonly vehicleDevices: Repository<VehicleDevice>,
    @InjectRepository(DeviceTelemetrySource) private readonly sources: Repository<DeviceTelemetrySource>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    private readonly twinGateway: DigitalTwinGateway,
  ) {}

  listDevicesForVehicle(vehicleId: string) {
    return this.vehicleDevices.find({ where: { vehicleId, isActive: true } });
  }

  addDevice(vehicleId: string, deviceId: string, role: DeviceRole, trustLevel = 50) {
    return this.vehicleDevices.save(
      this.vehicleDevices.create({ vehicleId, deviceId, role, trustLevel, installedAt: new Date() }),
    );
  }

  async setRole(vehicleId: string, deviceId: string, role: DeviceRole) {
    await this.vehicleDevices.update({ vehicleId, deviceId }, { role });
    return this.vehicleDevices.findOne({ where: { vehicleId, deviceId } });
  }

  async removeDevice(vehicleId: string, deviceId: string) {
    await this.vehicleDevices.update({ vehicleId, deviceId }, { isActive: false, removedAt: new Date() });
    return { success: true };
  }

  /** Explicit per-field override, taking precedence over the DEFAULT_ROLE_PRIORITY table. */
  async setFieldSource(vehicleId: string, field: TelemetryField, deviceId: string, priority = 100) {
    return this.sources.save(this.sources.create({ vehicleId, field, deviceId, priority }));
  }

  /**
   * Given several devices' readings for the same field, pick the winner by
   * (1) explicit override in device_telemetry_sources if one exists,
   * (2) otherwise the default role priority table,
   * (3) tie-broken by trust_level, then by most-recent reading.
   * Flags a conflict if the top two candidates disagree beyond threshold.
   */
  async fuse<T>(
    vehicleId: string,
    organizationId: string,
    field: TelemetryField,
    readings: FieldReading<T>[],
  ): Promise<{ winner: FieldReading<T> | null; conflict: boolean }> {
    const fresh = readings.filter((r) => Date.now() - r.observedAt.getTime() <= STALE_AFTER_MS);
    if (!fresh.length) return { winner: null, conflict: false };
    if (fresh.length === 1) return { winner: fresh[0], conflict: false };

    const [vehicleDevices, overrides] = await Promise.all([
      this.vehicleDevices.find({ where: { vehicleId, isActive: true } }),
      this.sources.find({ where: { vehicleId, field } }),
    ]);

    const overrideByDevice = new Map(overrides.map((o) => [o.deviceId, o.priority]));
    const roleByDevice = new Map(vehicleDevices.map((vd) => [vd.deviceId, vd]));
    const defaultRoleOrder = DEFAULT_ROLE_PRIORITY[field] ?? [];

    const scored = fresh.map((reading) => {
      const vd = roleByDevice.get(reading.deviceId);
      const overridePriority = overrideByDevice.get(reading.deviceId);
      const roleRank = vd ? defaultRoleOrder.indexOf(vd.role) : -1;
      // Higher score wins. Explicit override dominates; then role rank
      // (earlier in the list = better, so invert it); then trust level.
      const score =
        (overridePriority ?? 0) * 1_000_000 +
        (roleRank === -1 ? 0 : (defaultRoleOrder.length - roleRank) * 1000) +
        (vd?.trustLevel ?? 0);
      return { reading, score };
    });

    scored.sort((a, b) => b.score - a.score || b.reading.observedAt.getTime() - a.reading.observedAt.getTime());

    const winner = scored[0].reading;
    const runnerUp = scored[1]?.reading;
    const conflict = runnerUp ? this.disagreesBeyondThreshold(field, winner.value, runnerUp.value) : false;

    if (conflict) {
      this.logger.warn(`Sensor conflict on vehicle ${vehicleId} field "${field}": ${JSON.stringify(scored.map((s) => s.reading))}`);
      this.twinGateway.broadcastDeviceConflict(vehicleId, organizationId, field, scored.map((s) => s.reading));
    }

    return { winner, conflict };
  }

  private disagreesBeyondThreshold(field: TelemetryField, a: unknown, b: unknown): boolean {
    if (field === 'fuel' && typeof a === 'number' && typeof b === 'number') {
      return Math.abs(a - b) > CONFLICT_THRESHOLD.fuel_percent;
    }
    if (field === 'ev_battery' && typeof a === 'number' && typeof b === 'number') {
      return Math.abs(a - b) > CONFLICT_THRESHOLD.ev_battery_percent;
    }
    if (field === 'ignition' || field === 'driver_identity') {
      return a !== b;
    }
    // 'location' conflict detection needs haversine distance on two {lat,lng}
    // objects - left to the caller (twin-update.listener.ts) since this
    // generic method doesn't know the shape of T for location readings.
    return false;
  }
}
