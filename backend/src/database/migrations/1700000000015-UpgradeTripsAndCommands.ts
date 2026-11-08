import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpgradeTripsAndCommands1700000000015 implements MigrationInterface {
  name = 'UpgradeTripsAndCommands1700000000015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE trip_stops (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP,
        duration_seconds INTEGER,
        latitude DECIMAL(10,8),
        longitude DECIMAL(11,8),
        classification VARCHAR(20) DEFAULT 'unknown', -- delivery|traffic|rest|refueling|charging|unauthorized|maintenance|unknown
        confidence DECIMAL(4,3),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_trip_stops_trip ON trip_stops (trip_id, start_time);

      CREATE TABLE trip_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
        event_type VARCHAR(30) NOT NULL, -- harsh_braking|harsh_acceleration|sharp_cornering|speeding
        latitude DECIMAL(10,8),
        longitude DECIMAL(11,8),
        magnitude DECIMAL(8,3),
        timestamp TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_trip_events_trip ON trip_events (trip_id, timestamp);

      -- Command approval workflow + offline handling additions.
      ALTER TABLE remote_commands
        ADD COLUMN approved_by UUID REFERENCES users(id),
        ADD COLUMN approved_at TIMESTAMP,
        ADD COLUMN requires_approval BOOLEAN DEFAULT false,
        ADD COLUMN expires_at TIMESTAMP,
        ADD COLUMN cancelled_at TIMESTAMP,
        ADD COLUMN cancelled_by UUID REFERENCES users(id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE remote_commands
        DROP COLUMN IF EXISTS cancelled_by,
        DROP COLUMN IF EXISTS cancelled_at,
        DROP COLUMN IF EXISTS expires_at,
        DROP COLUMN IF EXISTS requires_approval,
        DROP COLUMN IF EXISTS approved_at,
        DROP COLUMN IF EXISTS approved_by
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS trip_events`);
    await queryRunner.query(`DROP TABLE IF EXISTS trip_stops`);
  }
}
