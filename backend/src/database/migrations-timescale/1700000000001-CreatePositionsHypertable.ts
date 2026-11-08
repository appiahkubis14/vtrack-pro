import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Runs against the TIMESCALE connection (vtrack_ts database), not the main
 * app database - see package.json's migration:run:timescale script and
 * src/config/timescale-typeorm.config.ts.
 */
export class CreatePositionsHypertable1700000000001 implements MigrationInterface {
  name = 'CreatePositionsHypertable1700000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS timescaledb`);
    const hasPostgis = (await queryRunner.query(`SELECT 1 FROM pg_available_extensions WHERE name = 'postgis'`)).length > 0;
    if (hasPostgis) await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS postgis`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE positions (
        id UUID DEFAULT gen_random_uuid(),
        device_id UUID NOT NULL,
        latitude DECIMAL(10,8) NOT NULL,
        longitude DECIMAL(11,8) NOT NULL,
        altitude DECIMAL(8,2),
        speed DECIMAL(6,2),
        heading INTEGER,
        accuracy INTEGER,
        fuel_level DECIMAL(6,2),
        fuel_consumption DECIMAL(10,3),
        engine_hours DECIMAL(10,2),
        ignition BOOLEAN DEFAULT false,
        odometer DECIMAL(12,2),
        obd_data JSONB,
        sensors JSONB,
        satellites INTEGER,
        hdop DECIMAL(4,2),
        event_type VARCHAR(50),
        raw_data TEXT,
        "timestamp" TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id, "timestamp")
      );
    `);

    // Hypertable partitioned by time - 1 day chunks per the spec.
    await queryRunner.query(
      `SELECT create_hypertable('positions', 'timestamp', chunk_time_interval => INTERVAL '1 day')`,
    );

    await queryRunner.query(`CREATE INDEX idx_positions_device_timestamp ON positions (device_id, "timestamp" DESC)`);
    await queryRunner.query(`CREATE INDEX idx_positions_timestamp ON positions ("timestamp" DESC)`);
    await queryRunner.query(`CREATE INDEX idx_positions_device ON positions (device_id)`);
    if (hasPostgis) {
      await queryRunner.query(`
        CREATE INDEX idx_positions_location ON positions
        USING GIST (ST_SetSRID(ST_MakePoint(longitude::float, latitude::float), 4326))
      `);
    }

    // Optional but recommended for a high-write hypertable at fleet scale -
    // compress chunks older than 7 days, drop raw data older than the org's
    // retention policy via a matching retention policy call.
    await queryRunner.query(`ALTER TABLE positions SET (timescaledb.compress, timescaledb.compress_segmentby = 'device_id')`);
    await queryRunner.query(`SELECT add_compression_policy('positions', INTERVAL '7 days')`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS positions`);
  }
}
