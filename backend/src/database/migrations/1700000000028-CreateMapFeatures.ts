import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Live map features: points of interest, per-vehicle icon and destination, and mobile geofences
 * (a circular zone that follows a vehicle).
 */
export class CreateMapFeatures1700000000028 implements MigrationInterface {
  name = 'CreateMapFeatures1700000000028';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE geofences ADD COLUMN anchor_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL;
      CREATE INDEX idx_geofences_anchor ON geofences (anchor_vehicle_id) WHERE anchor_vehicle_id IS NOT NULL;

      CREATE TABLE pois (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name VARCHAR(120) NOT NULL CHECK (length(btrim(name)) >= 2),
        category VARCHAR(12) NOT NULL DEFAULT 'other' CHECK (category IN ('depot','hub','customer','fuel','charging','parking','service','other')),
        latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
        longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
        address VARCHAR(255),
        notes TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_by UUID,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_pois_org ON pois (organization_id, is_active);

      ALTER TABLE vehicles ADD COLUMN map_icon VARCHAR(12)
        CHECK (map_icon IS NULL OR map_icon IN ('ebike','trike','truck','van','car','bus','motorbike','excavator','arrow'));

      CREATE TABLE vehicle_destinations (
        vehicle_id UUID PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        label VARCHAR(160),
        latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
        longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
        set_by UUID,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP TABLE IF EXISTS vehicle_destinations, pois;
      ALTER TABLE vehicles DROP COLUMN IF EXISTS map_icon;
      DROP INDEX IF EXISTS idx_geofences_anchor;
      ALTER TABLE geofences DROP COLUMN IF EXISTS anchor_vehicle_id;
    `);
  }
}
