import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMultiTrackerAndDigitalTwin1700000000012 implements MigrationInterface {
  name = 'CreateMultiTrackerAndDigitalTwin1700000000012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      -- One vehicle can carry multiple devices, each with a role and trust level.
      CREATE TABLE vehicle_devices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
        device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
        role VARCHAR(50) NOT NULL,
        trust_level INTEGER NOT NULL DEFAULT 50,
        is_active BOOLEAN DEFAULT true,
        installed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        removed_at TIMESTAMP,
        UNIQUE (vehicle_id, device_id, role)
      );
      CREATE INDEX idx_vehicle_devices_vehicle ON vehicle_devices (vehicle_id) WHERE is_active;
      CREATE INDEX idx_vehicle_devices_device ON vehicle_devices (device_id);

      -- Which device role is the source-of-truth for each telemetry field, per vehicle.
      -- Falls back to trust_level ordering on vehicle_devices when no explicit override exists.
      CREATE TABLE device_telemetry_sources (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
        field VARCHAR(50) NOT NULL, -- 'location' | 'fuel' | 'ev_battery' | 'ignition' | 'driver_identity'
        device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
        priority INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (vehicle_id, field, device_id)
      );
      CREATE INDEX idx_telemetry_sources_vehicle_field ON device_telemetry_sources (vehicle_id, field, priority DESC);

      -- Periodic snapshot of the Redis digital twin, for recovery / historical audit
      -- (Redis itself is the live source of truth - see modules/twin).
      CREATE TABLE vehicle_digital_twin_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        state JSONB NOT NULL,
        captured_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_twin_snapshots_vehicle_time ON vehicle_digital_twin_snapshots (vehicle_id, captured_at DESC);

      -- Per-geofence, per-device hysteresis state (entry/exit debounce tracking),
      -- so the in-memory map in geofence-checker.engine.ts can be persisted/recovered.
      CREATE TABLE geofence_device_states (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        geofence_id UUID REFERENCES geofences(id) ON DELETE CASCADE,
        device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
        candidate_state VARCHAR(10) NOT NULL, -- 'in' | 'out' - not yet confirmed past dwell time
        confirmed_state VARCHAR(10) NOT NULL DEFAULT 'out',
        candidate_since TIMESTAMP,
        last_alert_at TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (geofence_id, device_id)
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS geofence_device_states`);
    await queryRunner.query(`DROP TABLE IF EXISTS vehicle_digital_twin_snapshots`);
    await queryRunner.query(`DROP TABLE IF EXISTS device_telemetry_sources`);
    await queryRunner.query(`DROP TABLE IF EXISTS vehicle_devices`);
  }
}
