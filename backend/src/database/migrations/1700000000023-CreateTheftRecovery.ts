import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTheftRecovery1700000000023 implements MigrationInterface {
  name = 'CreateTheftRecovery1700000000023';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE recovery_teams (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        contact_phone VARCHAR(20),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE theft_cases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
        device_id UUID REFERENCES devices(id),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        status VARCHAR(20) NOT NULL DEFAULT 'suspected',
        -- suspected|active|tracking|immobilized|recovered|false_alarm|closed
        reported_by UUID REFERENCES users(id),
        reported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_known_latitude DECIMAL(10,8),
        last_known_longitude DECIMAL(11,8),
        last_known_at TIMESTAMP,
        assigned_team_id UUID REFERENCES recovery_teams(id),
        police_reference VARCHAR(100),
        high_frequency_mode_enabled BOOLEAN DEFAULT false,
        resolved_at TIMESTAMP,
        resolution_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_theft_cases_org_status ON theft_cases (organization_id, status);
      CREATE INDEX idx_theft_cases_vehicle ON theft_cases (vehicle_id, reported_at DESC);

      -- Links a theft case to evidence gathered elsewhere in the platform
      -- (audio sessions, remote commands, alerts) without duplicating that
      -- data - just an ordered reference list building the case file.
      CREATE TABLE recovery_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        theft_case_id UUID REFERENCES theft_cases(id) ON DELETE CASCADE,
        event_type VARCHAR(30) NOT NULL,
        -- 'status_change'|'position_update'|'command_issued'|'audio_session_linked'|'alert_linked'|'note_added'|'team_assigned'
        reference_id UUID, -- points at the relevant remote_commands/alerts/audio_sessions row, depending on event_type
        details JSONB,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_recovery_events_case ON recovery_events (theft_case_id, created_at);

      CREATE TABLE recovery_actions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        theft_case_id UUID REFERENCES theft_cases(id) ON DELETE CASCADE,
        action_type VARCHAR(30) NOT NULL, -- 'immobilize_request'|'immobilize_execute'|'high_freq_enable'|'covert_recovery_enable'
        requested_by UUID REFERENCES users(id),
        approved_by UUID REFERENCES users(id),
        status VARCHAR(20) DEFAULT 'pending', -- pending|approved|denied|executed|failed
        safety_check_result JSONB, -- {"speedKmh": 0, "safeToImmobilize": true, "reason": "..."}
        command_id UUID REFERENCES remote_commands(id),
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP
      );
      CREATE INDEX idx_recovery_actions_case ON recovery_actions (theft_case_id, requested_at DESC);

      CREATE TABLE recovery_notes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        theft_case_id UUID REFERENCES theft_cases(id) ON DELETE CASCADE,
        author_id UUID REFERENCES users(id),
        note TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_recovery_notes_case ON recovery_notes (theft_case_id, created_at);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS recovery_notes`);
    await queryRunner.query(`DROP TABLE IF EXISTS recovery_actions`);
    await queryRunner.query(`DROP TABLE IF EXISTS recovery_events`);
    await queryRunner.query(`DROP TABLE IF EXISTS theft_cases`);
    await queryRunner.query(`DROP TABLE IF EXISTS recovery_teams`);
  }
}
