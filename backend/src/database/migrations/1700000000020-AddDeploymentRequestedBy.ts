import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeploymentRequestedBy1700000000020 implements MigrationInterface {
  name = 'AddDeploymentRequestedBy1700000000020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE asset_deployments ADD COLUMN requested_by UUID REFERENCES users(id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE asset_deployments DROP COLUMN IF EXISTS requested_by`);
  }
}
