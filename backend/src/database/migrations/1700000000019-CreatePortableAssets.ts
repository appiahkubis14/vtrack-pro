import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePortableAssets1700000000019 implements MigrationInterface {
  name = 'CreatePortableAssets1700000000019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE portable_assets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        device_id UUID REFERENCES devices(id),
        asset_type VARCHAR(30) NOT NULL, -- vehicle|motorcycle|truck|trailer|container|generator|construction_equipment|cargo|package|equipment|investigation
        asset_name VARCHAR(255) NOT NULL,
        asset_identifier VARCHAR(100), -- e.g. container number, asset tag
        is_battery_powered BOOLEAN DEFAULT true,
        is_magnetic_casing BOOLEAN DEFAULT false,
        ip_rating VARCHAR(10),
        is_covert_capable BOOLEAN DEFAULT false,
        current_power_profile VARCHAR(30) DEFAULT 'interval_5m',
        qr_activation_code VARCHAR(50) UNIQUE,
        status VARCHAR(20) DEFAULT 'available', -- available|deployed|maintenance|lost|retired
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_portable_assets_org ON portable_assets (organization_id);
      CREATE INDEX idx_portable_assets_device ON portable_assets (device_id);

      -- Temporary assignment workflow: tracker attached to an asset for a
      -- bounded period, with expected vs actual return tracked separately
      -- so "overdue return" reminders have something concrete to compare against.
      CREATE TABLE asset_deployments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        portable_asset_id UUID REFERENCES portable_assets(id) ON DELETE CASCADE,
        deployment_purpose VARCHAR(255),
        deployment_location VARCHAR(255),
        responsible_user_id UUID REFERENCES users(id),
        deployed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expected_return_date TIMESTAMP,
        actual_return_date TIMESTAMP,
        return_condition VARCHAR(20), -- good|damaged|lost|not_returned
        deployment_notes TEXT,
        recovery_checklist JSONB, -- e.g. {"deviceIntact": true, "batteryOk": true, "caseIntact": true}
        is_covert BOOLEAN DEFAULT false,
        covert_justification TEXT,
        covert_approved_by UUID REFERENCES users(id),
        covert_approved_at TIMESTAMP,
        status VARCHAR(20) DEFAULT 'active', -- active|returned|overdue|lost
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_asset_deployments_asset ON asset_deployments (portable_asset_id, deployed_at DESC);
      CREATE INDEX idx_asset_deployments_status ON asset_deployments (status) WHERE status IN ('active', 'overdue');

      -- Audit trail specifically for covert-mode actions - separate from the
      -- general audit_logs table because covert operations need stricter,
      -- append-only, more granular logging per the legal requirements.
      CREATE TABLE deployment_audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        deployment_id UUID REFERENCES asset_deployments(id) ON DELETE CASCADE,
        action VARCHAR(50) NOT NULL, -- 'covert_requested'|'covert_approved'|'covert_denied'|'visibility_restricted'|'alert_redacted'
        performed_by UUID REFERENCES users(id),
        reason TEXT,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_deployment_audit_deployment ON deployment_audit_logs (deployment_id, created_at);

      CREATE TABLE device_power_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(30) UNIQUE NOT NULL, -- matches the power_profile enum used on portable_assets.current_power_profile
        report_interval_seconds INTEGER, -- NULL for event-driven profiles (motion_triggered, sos_only, etc.)
        wake_trigger VARCHAR(30), -- 'timer'|'motion'|'geofence'|'remote'|'sos'|'none'
        estimated_battery_days_2000mah DECIMAL(6,1), -- rough runway estimate for a common 2000mAh cell, for the UI to show
        description TEXT
      );
      INSERT INTO device_power_profiles (name, report_interval_seconds, wake_trigger, estimated_battery_days_2000mah, description) VALUES
        ('continuous', 1, 'timer', 1.5, 'Continuous reporting - shortest battery life, use for active recovery only'),
        ('interval_10s', 10, 'timer', 4, 'Report every 10 seconds'),
        ('interval_30s', 30, 'timer', 10, 'Report every 30 seconds'),
        ('interval_1m', 60, 'timer', 20, 'Report every minute'),
        ('interval_5m', 300, 'timer', 45, 'Report every 5 minutes - good default for most deployments'),
        ('interval_15m', 900, 'timer', 90, 'Report every 15 minutes'),
        ('heartbeat_1h', 3600, 'timer', 180, 'Hourly heartbeat only'),
        ('heartbeat_6h', 21600, 'timer', 365, 'Every 6 hours'),
        ('heartbeat_24h', 86400, 'timer', 720, 'Daily heartbeat - long-term dormant asset monitoring'),
        ('motion_triggered', NULL, 'motion', 200, 'Only reports when accelerometer detects movement'),
        ('geofence_triggered', NULL, 'geofence', 250, 'Only reports on geofence entry/exit'),
        ('sos_only', NULL, 'sos', 400, 'Silent until panic button pressed'),
        ('deep_sleep', NULL, 'remote', 600, 'Dormant until remotely woken - longest standby, no autonomous reporting');

      CREATE TABLE battery_telemetry (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
        battery_percent DECIMAL(5,2),
        battery_voltage DECIMAL(5,2),
        is_charging BOOLEAN DEFAULT false,
        estimated_days_remaining DECIMAL(6,1),
        power_profile VARCHAR(30),
        timestamp TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_battery_telemetry_device_time ON battery_telemetry (device_id, timestamp DESC);

      CREATE TABLE device_sleep_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
        reason VARCHAR(30), -- 'scheduled'|'low_battery'|'remote_command'|'power_profile_change'
        power_profile_at_sleep VARCHAR(30),
        timestamp TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE wake_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
        trigger_type VARCHAR(30) NOT NULL, -- 'accelerometer'|'geofence_entry'|'geofence_exit'|'scheduled'|'remote_command'
        trigger_metadata JSONB,
        timestamp TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_wake_events_device_time ON wake_events (device_id, timestamp DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS wake_events`);
    await queryRunner.query(`DROP TABLE IF EXISTS device_sleep_events`);
    await queryRunner.query(`DROP TABLE IF EXISTS battery_telemetry`);
    await queryRunner.query(`DROP TABLE IF EXISTS device_power_profiles`);
    await queryRunner.query(`DROP TABLE IF EXISTS deployment_audit_logs`);
    await queryRunner.query(`DROP TABLE IF EXISTS asset_deployments`);
    await queryRunner.query(`DROP TABLE IF EXISTS portable_assets`);
  }
}
