import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnableExtensions1700000000001 implements MigrationInterface {
  name = 'EnableExtensions1700000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`); // gen_random_uuid()
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS postgis`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Extensions are left in place on down-migration - dropping them is
    // rarely what you want and can break other schemas on the same DB.
  }
}
