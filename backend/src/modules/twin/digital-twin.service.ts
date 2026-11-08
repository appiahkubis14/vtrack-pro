import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '../../services/redis.service';
import { DigitalTwinSnapshot } from './entities/digital-twin-snapshot.entity';
import { DigitalTwinPatch, DigitalTwinState } from './digital-twin-state.interface';
import { DigitalTwinGateway } from './digital-twin.gateway';

const KEY_PREFIX = 'vehicle:';
const KEY_SUFFIX = ':state';
// Digital twin entries expire if nothing refreshes them - this is how
// "device went offline / stopped reporting" surfaces without a separate
// polling job. Refreshed on every write; a device that stops transmitting
// simply lets its twin key expire.
const TTL_SECONDS = 15 * 60;

/**
 * Redis-backed live state store, per the v2 architecture's "Digital Twin"
 * requirement: TimescaleDB stays the historical source of truth, but the
 * live-map / dashboard lookup path reads this instead of querying positions
 * for thousands of vehicles on every page load.
 */
@Injectable()
export class DigitalTwinService {
  private readonly logger = new Logger(DigitalTwinService.name);

  constructor(
    private readonly redis: RedisService,
    @InjectRepository(DigitalTwinSnapshot) private readonly snapshots: Repository<DigitalTwinSnapshot>,
    private readonly gateway: DigitalTwinGateway,
  ) {}

  private key(vehicleId: string): string {
    return `${KEY_PREFIX}${vehicleId}${KEY_SUFFIX}`;
  }

  async get(vehicleId: string): Promise<DigitalTwinState | null> {
    const raw = await this.redis.client.get(this.key(vehicleId));
    return raw ? (JSON.parse(raw) as DigitalTwinState) : null;
  }

  async getMany(vehicleIds: string[]): Promise<Record<string, DigitalTwinState | null>> {
    if (!vehicleIds.length) return {};
    const keys = vehicleIds.map((id) => this.key(id));
    const values = await this.redis.client.mget(...keys);
    return Object.fromEntries(
      vehicleIds.map((id, i) => [id, values[i] ? (JSON.parse(values[i] as string) as DigitalTwinState) : null]),
    );
  }

  /**
   * Merge a partial update into the twin (last-write-wins per field, not
   * per-document - callers that need conflict resolution across multiple
   * devices should route through fusion.service.ts first, which decides
   * *which* device's value should even reach here for a given field).
   */
  async patch(vehicleId: string, organizationId: string, patch: DigitalTwinPatch): Promise<DigitalTwinState> {
    const existing = await this.get(vehicleId);
    const next: DigitalTwinState = {
      vehicleId,
      organizationId,
      geofences: existing?.geofences ?? [],
      alerts: existing?.alerts ?? [],
      status: existing?.status ?? 'offline',
      ignition: existing?.ignition ?? false,
      deviceHealth: existing?.deviceHealth ?? { online: false },
      ...existing,
      ...patch,
      lastUpdatedAt: new Date().toISOString(),
    };

    await this.redis.client.set(this.key(vehicleId), JSON.stringify(next), 'EX', TTL_SECONDS);
    this.gateway.broadcastUpdate(next);
    return next;
  }

  async markOffline(vehicleId: string): Promise<void> {
    const existing = await this.get(vehicleId);
    if (!existing) return;
    await this.patch(vehicleId, existing.organizationId, {
      status: 'offline',
      deviceHealth: { ...existing.deviceHealth, online: false },
    });
  }

  addGeofence(vehicleId: string, organizationId: string, geofenceId: string) {
    return this.get(vehicleId).then((existing) =>
      this.patch(vehicleId, organizationId, {
        geofences: Array.from(new Set([...(existing?.geofences ?? []), geofenceId])),
      }),
    );
  }

  removeGeofence(vehicleId: string, organizationId: string, geofenceId: string) {
    return this.get(vehicleId).then((existing) =>
      this.patch(vehicleId, organizationId, {
        geofences: (existing?.geofences ?? []).filter((id) => id !== geofenceId),
      }),
    );
  }

  /** Persist a durable snapshot for recovery/audit - call periodically (e.g. hourly cron), not per-update. */
  async persistSnapshot(vehicleId: string): Promise<void> {
    const state = await this.get(vehicleId);
    if (!state) return;
    await this.snapshots.save(
      this.snapshots.create({
        vehicleId,
        organizationId: state.organizationId,
        state: state as unknown as Record<string, unknown>,
        capturedAt: new Date(),
      }),
    );
  }

  /** Recovery path if Redis is flushed/lost - rehydrate from the most recent snapshot. */
  async recoverFromSnapshot(vehicleId: string): Promise<DigitalTwinState | null> {
    const latest = await this.snapshots.findOne({ where: { vehicleId }, order: { capturedAt: 'DESC' } });
    if (!latest) return null;
    const state = latest.state as unknown as DigitalTwinState;
    await this.redis.client.set(this.key(vehicleId), JSON.stringify(state), 'EX', TTL_SECONDS);
    this.logger.log(`Recovered digital twin for vehicle ${vehicleId} from snapshot ${latest.capturedAt.toISOString()}`);
    return state;
  }
}
