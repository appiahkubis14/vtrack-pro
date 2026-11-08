import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTrips1700000000004 implements MigrationInterface {
  name = 'CreateTrips1700000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE trips (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
        driver_id UUID,
        vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
        start_position_id UUID,
        end_position_id UUID,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP,
        start_location JSONB,
        end_location JSONB,
        distance DECIMAL(12,2),
        duration DECIMAL(12,2),
        moving_duration DECIMAL(12,2),
        stopped_duration DECIMAL(12,2),
        average_speed DECIMAL(8,2),
        max_speed DECIMAL(8,2),
        fuel_consumed DECIMAL(10,3),
        fuel_efficiency DECIMAL(8,3),
        stop_count INTEGER DEFAULT 0,
        events JSONB,
        score INTEGER DEFAULT 0,
        route_geometry TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_trips_device_time ON trips (device_id, start_time DESC);
      CREATE INDEX idx_trips_driver_time ON trips (driver_id, start_time DESC);
      CREATE INDEX idx_trips_vehicle_time ON trips (vehicle_id, start_time DESC);
      CREATE INDEX idx_trips_time ON trips (start_time DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS trips`);
  }
}
