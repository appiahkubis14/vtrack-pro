import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGeofenceHysteresisConfig1700000000016 implements MigrationInterface {
  name = 'AddGeofenceHysteresisConfig1700000000016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE geofences ADD COLUMN hysteresis JSONB DEFAULT '{
        "entryDwellSeconds": 10,
        "exitDwellSeconds": 15,
        "accuracyThresholdMeters": 30,
        "bufferMeters": 10,
        "cooldownSeconds": 300
      }'::jsonb;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE geofences DROP COLUMN IF EXISTS hysteresis`);
  }
}
