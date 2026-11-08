import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMaintenance1700000000009 implements MigrationInterface {
  name = 'CreateMaintenance1700000000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE maintenance (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
        service_type VARCHAR(100) NOT NULL,
        description TEXT,
        priority VARCHAR(20) DEFAULT 'medium',
        status VARCHAR(20) DEFAULT 'scheduled',
        scheduled_date DATE,
        completed_date DATE,
        odometer_at_service DECIMAL(12,2),
        engine_hours_at_service DECIMAL(10,2),
        cost DECIMAL(12,2),
        parts_cost DECIMAL(12,2),
        labor_cost DECIMAL(12,2),
        vendor_name VARCHAR(255),
        vendor_phone VARCHAR(20),
        notes TEXT,
        attachments TEXT[],
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_maintenance_vehicle ON maintenance (vehicle_id, scheduled_date DESC);
      CREATE INDEX idx_maintenance_status ON maintenance (status, scheduled_date);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS maintenance`);
  }
}
