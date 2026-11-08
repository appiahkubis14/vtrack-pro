import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCommandLogsAndDiagnostics1700000000014 implements MigrationInterface {
  name = 'CreateCommandLogsAndDiagnostics1700000000014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      -- Every state transition of a remote_commands row, for the full
      -- created -> approved -> queued -> waiting_for_device -> sent ->
      -- delivered -> acknowledged -> executed|failed|timeout|cancelled trail.
      CREATE TABLE device_command_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        command_id UUID REFERENCES remote_commands(id) ON DELETE CASCADE,
        from_state VARCHAR(30),
        to_state VARCHAR(30) NOT NULL,
        reason TEXT,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_command_logs_command ON device_command_logs (command_id, created_at);

      CREATE TABLE sms_wakeup_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        command_id UUID REFERENCES remote_commands(id) ON DELETE CASCADE,
        device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
        phone_number VARCHAR(20),
        wakeup_string VARCHAR(255),
        status VARCHAR(20) DEFAULT 'sent', -- sent|failed|reconnected
        cost DECIMAL(8,4),
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reconnected_at TIMESTAMP
      );
      CREATE INDEX idx_sms_wakeup_device ON sms_wakeup_logs (device_id, sent_at DESC);

      -- Schema-only for now (no OBD/CAN decoder implemented) - see v2 architecture
      -- doc section on the ingestion gateway for where these would be populated.
      CREATE TABLE can_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
        can_id VARCHAR(20) NOT NULL,
        data_hex TEXT NOT NULL,
        decoded JSONB,
        timestamp TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_can_messages_device_time ON can_messages (device_id, timestamp DESC);

      CREATE TABLE obd_fault_codes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
        device_id UUID REFERENCES devices(id),
        code VARCHAR(10) NOT NULL, -- e.g. P0301
        description TEXT,
        severity VARCHAR(20),
        is_active BOOLEAN DEFAULT true,
        first_seen_at TIMESTAMP NOT NULL,
        last_seen_at TIMESTAMP NOT NULL,
        cleared_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_obd_fault_codes_vehicle ON obd_fault_codes (vehicle_id, is_active);

      -- Map-matched positions (schema-only - see v2 architecture doc for the
      -- OSRM/Valhalla integration design).
      CREATE TABLE map_matched_positions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
        original_position_id UUID,
        snapped_latitude DECIMAL(10,8) NOT NULL,
        snapped_longitude DECIMAL(11,8) NOT NULL,
        road_name VARCHAR(255),
        confidence DECIMAL(4,3),
        timestamp TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_map_matched_trip ON map_matched_positions (trip_id, timestamp);

      -- AI/ML pipeline (schema-only - see v2 architecture doc section 13).
      CREATE TABLE anomaly_models (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        use_case VARCHAR(50) NOT NULL, -- fuel_theft|ev_battery|predictive_maintenance|driver_risk
        version VARCHAR(20) NOT NULL,
        artifact_url TEXT,
        metrics JSONB,
        is_active BOOLEAN DEFAULT false,
        trained_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE anomaly_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        vehicle_id UUID REFERENCES vehicles(id),
        model_id UUID REFERENCES anomaly_models(id),
        use_case VARCHAR(50) NOT NULL,
        score DECIMAL(5,4) NOT NULL,
        explanation JSONB,
        reviewed BOOLEAN DEFAULT false,
        is_false_positive BOOLEAN,
        reviewer_id UUID REFERENCES users(id),
        reviewed_at TIMESTAMP,
        detected_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_anomaly_events_vehicle ON anomaly_events (vehicle_id, detected_at DESC);

      CREATE TABLE ml_features (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
        feature_set VARCHAR(50) NOT NULL,
        features JSONB NOT NULL,
        computed_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_ml_features_vehicle_set ON ml_features (vehicle_id, feature_set, computed_at DESC);

      -- User-defined alert rules (the extension point referenced in v1's rule-engine.ts).
      CREATE TABLE alert_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        conditions JSONB NOT NULL,
        severity VARCHAR(20) NOT NULL DEFAULT 'medium',
        channels JSONB,
        is_active BOOLEAN DEFAULT true,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_alert_rules_org ON alert_rules (organization_id, is_active);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS alert_rules`);
    await queryRunner.query(`DROP TABLE IF EXISTS ml_features`);
    await queryRunner.query(`DROP TABLE IF EXISTS anomaly_events`);
    await queryRunner.query(`DROP TABLE IF EXISTS anomaly_models`);
    await queryRunner.query(`DROP TABLE IF EXISTS map_matched_positions`);
    await queryRunner.query(`DROP TABLE IF EXISTS obd_fault_codes`);
    await queryRunner.query(`DROP TABLE IF EXISTS can_messages`);
    await queryRunner.query(`DROP TABLE IF EXISTS sms_wakeup_logs`);
    await queryRunner.query(`DROP TABLE IF EXISTS device_command_logs`);
  }
}
