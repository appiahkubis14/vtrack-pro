import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEvFleetGhana1700000000025 implements MigrationInterface {
  name = 'CreateEvFleetGhana1700000000025';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE riders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        full_name VARCHAR(255) NOT NULL,
        phone VARCHAR(20) UNIQUE NOT NULL,
        national_id_number VARCHAR(50),
        auth_method VARCHAR(20) NOT NULL DEFAULT 'bluetooth_app', -- nfc_rfid|bluetooth_app
        nfc_tag_uid VARCHAR(100) UNIQUE,
        assigned_vehicle_id UUID REFERENCES vehicles(id),
        daily_target_amount DECIMAL(10,2) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_riders_org ON riders (organization_id);
      CREATE INDEX idx_riders_vehicle ON riders (assigned_vehicle_id);

      CREATE TABLE rider_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        rider_id UUID REFERENCES riders(id) ON DELETE CASCADE,
        vehicle_id UUID REFERENCES vehicles(id),
        device_id UUID REFERENCES devices(id),
        auth_method VARCHAR(20) NOT NULL,
        session_token VARCHAR(255) UNIQUE NOT NULL,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        ended_at TIMESTAMP,
        end_reason VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_rider_sessions_active ON rider_sessions (vehicle_id) WHERE ended_at IS NULL;
      CREATE INDEX idx_rider_sessions_token ON rider_sessions (session_token);

      CREATE TABLE payment_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        rider_id UUID REFERENCES riders(id) ON DELETE CASCADE,
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        amount DECIMAL(10,2) NOT NULL,
        provider VARCHAR(20) NOT NULL, -- mtn_momo|telecel_cash|airteltigo_money
        status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|success|failed|timeout
        aggregator_reference VARCHAR(100) UNIQUE,
        failure_reason TEXT,
        attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP,
        work_and_pay_cycle_date DATE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_payment_logs_rider_cycle ON payment_logs (rider_id, work_and_pay_cycle_date);
      CREATE INDEX idx_payment_logs_status ON payment_logs (status) WHERE status IN ('pending', 'failed');

      CREATE TABLE immobilizer_state (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id UUID UNIQUE REFERENCES vehicles(id) ON DELETE CASCADE,
        rider_id UUID REFERENCES riders(id),
        state VARCHAR(20) NOT NULL DEFAULT 'none',
        -- none|payment_failed|warning_sent|immobilize_queued|immobilized
        payment_log_id UUID REFERENCES payment_logs(id),
        grace_period_started_at TIMESTAMP,
        grace_period_hours INTEGER DEFAULT 12,
        warning_sent_at TIMESTAMP,
        last_safety_check_speed_kmh DECIMAL(6,2),
        immobilized_at TIMESTAMP,
        command_id UUID REFERENCES remote_commands(id),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_immobilizer_state_active ON immobilizer_state (state) WHERE state != 'none';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS immobilizer_state`);
    await queryRunner.query(`DROP TABLE IF EXISTS payment_logs`);
    await queryRunner.query(`DROP TABLE IF EXISTS rider_sessions`);
    await queryRunner.query(`DROP TABLE IF EXISTS riders`);
  }
}
