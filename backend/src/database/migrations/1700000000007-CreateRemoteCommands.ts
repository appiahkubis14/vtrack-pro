import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRemoteCommands1700000000007 implements MigrationInterface {
  name = 'CreateRemoteCommands1700000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE remote_commands (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id),
        command VARCHAR(50) NOT NULL,
        parameters JSONB,
        priority VARCHAR(20) DEFAULT 'medium',
        status VARCHAR(20) DEFAULT 'pending',
        response JSONB,
        error TEXT,
        scheduled_for TIMESTAMP,
        sent_at TIMESTAMP,
        delivered_at TIMESTAMP,
        executed_at TIMESTAMP,
        response_time INTEGER,
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_commands_device_status ON remote_commands (device_id, status);
      CREATE INDEX idx_commands_user ON remote_commands (user_id, created_at DESC);
      CREATE INDEX idx_commands_scheduled ON remote_commands (scheduled_for) WHERE scheduled_for IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS remote_commands`);
  }
}
