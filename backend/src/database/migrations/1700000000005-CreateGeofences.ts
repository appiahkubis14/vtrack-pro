import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGeofences1700000000005 implements MigrationInterface {
  name = 'CreateGeofences1700000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE geofences (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        type VARCHAR(50) NOT NULL,
        coordinates GEOGRAPHY(POLYGON, 4326),
        radius DECIMAL(10,2),
        center_latitude DECIMAL(10,8),
        center_longitude DECIMAL(11,8),
        speed_limit INTEGER,
        schedule JSONB,
        alerts JSONB,
        actions JSONB,
        color VARCHAR(7) DEFAULT '#FF0000',
        is_active BOOLEAN DEFAULT true,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      );

      CREATE INDEX idx_geofences_coordinates ON geofences USING GIST (coordinates);
      CREATE INDEX idx_geofences_org ON geofences (organization_id);

      CREATE TABLE geofence_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        geofence_id UUID REFERENCES geofences(id) ON DELETE CASCADE,
        device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
        vehicle_id UUID REFERENCES vehicles(id),
        event_type VARCHAR(20) NOT NULL,
        latitude DECIMAL(10,8),
        longitude DECIMAL(11,8),
        speed DECIMAL(6,2),
        dwell_time INTEGER,
        timestamp TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_geofence_events_geofence ON geofence_events (geofence_id, timestamp DESC);
      CREATE INDEX idx_geofence_events_device ON geofence_events (device_id, timestamp DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS geofence_events`);
    await queryRunner.query(`DROP TABLE IF EXISTS geofences`);
  }
}
