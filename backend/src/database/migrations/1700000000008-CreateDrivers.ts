import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDrivers1700000000008 implements MigrationInterface {
  name = 'CreateDrivers1700000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE drivers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(20),
        license_number VARCHAR(50),
        license_expiry DATE,
        license_class VARCHAR(20),
        date_of_birth DATE,
        address TEXT,
        city VARCHAR(100),
        state VARCHAR(100),
        postal_code VARCHAR(20),
        country VARCHAR(100),
        emergency_contact_name VARCHAR(255),
        emergency_contact_phone VARCHAR(20),
        medical_conditions TEXT,
        profile_image_url TEXT,
        status VARCHAR(20) DEFAULT 'available',
        is_active BOOLEAN DEFAULT true,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      );

      CREATE TABLE driver_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        driver_id UUID REFERENCES drivers(id) ON DELETE CASCADE,
        vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
        assigned_by UUID REFERENCES users(id),
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        unassigned_at TIMESTAMP,
        notes TEXT
      );

      CREATE INDEX idx_driver_assignments_driver ON driver_assignments (driver_id, assigned_at DESC);
      CREATE INDEX idx_driver_assignments_vehicle ON driver_assignments (vehicle_id, assigned_at DESC);

      CREATE TABLE driver_scores (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        driver_id UUID REFERENCES drivers(id) ON DELETE CASCADE,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        overall_score INTEGER NOT NULL,
        speeding_score INTEGER,
        braking_score INTEGER,
        acceleration_score INTEGER,
        cornering_score INTEGER,
        idling_score INTEGER,
        fuel_efficiency_score INTEGER,
        safety_score INTEGER,
        events JSONB,
        recommendations JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_driver_scores_driver ON driver_scores (driver_id, period_start DESC);

      -- Backfill the forward references from earlier migrations now that drivers exists.
      ALTER TABLE trips ADD CONSTRAINT fk_trips_driver FOREIGN KEY (driver_id) REFERENCES drivers(id);
      ALTER TABLE alerts ADD CONSTRAINT fk_alerts_driver FOREIGN KEY (driver_id) REFERENCES drivers(id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE alerts DROP CONSTRAINT IF EXISTS fk_alerts_driver`);
    await queryRunner.query(`ALTER TABLE trips DROP CONSTRAINT IF EXISTS fk_trips_driver`);
    await queryRunner.query(`DROP TABLE IF EXISTS driver_scores`);
    await queryRunner.query(`DROP TABLE IF EXISTS driver_assignments`);
    await queryRunner.query(`DROP TABLE IF EXISTS drivers`);
  }
}
