import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAlertsAndNotifications1700000000006 implements MigrationInterface {
  name = 'CreateAlertsAndNotifications1700000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE alerts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        device_id UUID REFERENCES devices(id),
        vehicle_id UUID REFERENCES vehicles(id),
        driver_id UUID,
        geofence_id UUID REFERENCES geofences(id),
        type VARCHAR(50) NOT NULL,
        severity VARCHAR(20) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        position JSONB,
        metadata JSONB,
        is_acknowledged BOOLEAN DEFAULT false,
        acknowledged_by UUID REFERENCES users(id),
        acknowledged_at TIMESTAMP,
        is_resolved BOOLEAN DEFAULT false,
        resolved_by UUID REFERENCES users(id),
        resolved_at TIMESTAMP,
        resolution_note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_alerts_device_time ON alerts (device_id, created_at DESC);
      CREATE INDEX idx_alerts_org_time ON alerts (organization_id, created_at DESC);
      CREATE INDEX idx_alerts_severity ON alerts (severity, created_at DESC);
      CREATE INDEX idx_alerts_acknowledged ON alerts (is_acknowledged, created_at DESC);

      CREATE TABLE notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        alert_id UUID REFERENCES alerts(id),
        channel VARCHAR(20) NOT NULL,
        title VARCHAR(255),
        body TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        error TEXT,
        sent_at TIMESTAMP,
        delivered_at TIMESTAMP,
        read_at TIMESTAMP,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_notifications_user ON notifications (user_id, created_at DESC);
      CREATE INDEX idx_notifications_status ON notifications (status, created_at DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS notifications`);
    await queryRunner.query(`DROP TABLE IF EXISTS alerts`);
  }
}
