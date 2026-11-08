import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVehiclesAndDevices1700000000003 implements MigrationInterface {
  name = 'CreateVehiclesAndDevices1700000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE vehicles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        plate_number VARCHAR(50) UNIQUE NOT NULL,
        vin VARCHAR(17) UNIQUE,
        make VARCHAR(100),
        model VARCHAR(100),
        year INTEGER,
        color VARCHAR(50),
        fuel_type VARCHAR(50),
        transmission VARCHAR(50),
        engine_capacity DECIMAL(6,2),
        odometer DECIMAL(12,2) DEFAULT 0,
        registration_number VARCHAR(50),
        registration_expiry DATE,
        insurance_policy VARCHAR(100),
        insurance_expiry DATE,
        inspection_due_date DATE,
        tank_capacity DECIMAL(8,2),
        image_urls TEXT[],
        metadata JSONB,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      );

      CREATE TABLE devices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
        imei VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255),
        protocol VARCHAR(50) NOT NULL,
        model VARCHAR(100),
        firmware_version VARCHAR(50),
        sim_number VARCHAR(50),
        sim_provider VARCHAR(100),
        status VARCHAR(20) DEFAULT 'offline',
        battery_level INTEGER DEFAULT 0,
        signal_strength INTEGER DEFAULT 0,
        last_position_id UUID,
        last_communication_at TIMESTAMP,
        config JSONB DEFAULT '{}',
        metadata JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      );

      CREATE TABLE raw_device_data (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
        protocol VARCHAR(50) NOT NULL,
        raw_hex TEXT,
        parsed_json JSONB,
        ip_address INET,
        port INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_vehicles_organization ON vehicles (organization_id);
      CREATE INDEX idx_devices_organization ON devices (organization_id);
      CREATE INDEX idx_devices_vehicle ON devices (vehicle_id);
      CREATE INDEX idx_raw_device_data_device_time ON raw_device_data (device_id, created_at DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS raw_device_data`);
    await queryRunner.query(`DROP TABLE IF EXISTS devices`);
    await queryRunner.query(`DROP TABLE IF EXISTS vehicles`);
  }
}
