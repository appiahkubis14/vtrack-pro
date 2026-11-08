import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuditLogs1700000000010 implements MigrationInterface {
  name = 'CreateAuditLogs1700000000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id),
        user_id UUID REFERENCES users(id),
        action VARCHAR(100) NOT NULL,
        resource_type VARCHAR(50) NOT NULL,
        resource_id UUID,
        ip_address INET,
        user_agent TEXT,
        old_values JSONB,
        new_values JSONB,
        metadata JSONB,
        status VARCHAR(20) DEFAULT 'success',
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_audit_logs_user ON audit_logs (user_id, created_at DESC);
      CREATE INDEX idx_audit_logs_org ON audit_logs (organization_id, created_at DESC);
      CREATE INDEX idx_audit_logs_resource ON audit_logs (resource_type, resource_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS audit_logs`);
  }
}
