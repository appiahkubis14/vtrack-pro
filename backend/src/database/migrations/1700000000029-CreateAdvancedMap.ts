import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Advanced map: vehicle groups and geofence rules, zone checklists, dispatch (destinations with customer, route and ETA
 * history, notifications), charging availability, driver privacy hours, per-user map scope, cameras and sensor assets.
 */
export class CreateAdvancedMap1700000000029 implements MigrationInterface {
  name = 'CreateAdvancedMap1700000000029';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE geofences ADD COLUMN rule VARCHAR(12) NOT NULL DEFAULT 'notify' CHECK (rule IN ('notify','restricted','allowed','lez'));

      CREATE TABLE vehicle_groups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name VARCHAR(80) NOT NULL CHECK (length(btrim(name)) >= 2),
        color VARCHAR(7) NOT NULL DEFAULT '#64748b',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, name)
      );
      CREATE TABLE vehicle_group_members (
        group_id UUID NOT NULL REFERENCES vehicle_groups(id) ON DELETE CASCADE,
        vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        PRIMARY KEY (group_id, vehicle_id)
      );
      CREATE INDEX idx_vgm_vehicle ON vehicle_group_members (vehicle_id);
      CREATE TABLE geofence_groups (
        geofence_id UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
        group_id UUID NOT NULL REFERENCES vehicle_groups(id) ON DELETE CASCADE,
        PRIMARY KEY (geofence_id, group_id)
      );

      CREATE TABLE geofence_tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        geofence_id UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
        trigger VARCHAR(5) NOT NULL DEFAULT 'entry' CHECK (trigger IN ('entry','exit')),
        title VARCHAR(160) NOT NULL,
        items JSONB NOT NULL DEFAULT '[]',
        expires_minutes INT NOT NULL DEFAULT 120 CHECK (expires_minutes BETWEEN 5 AND 1440),
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_by UUID,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_gtasks_geofence ON geofence_tasks (geofence_id) WHERE is_active;
      CREATE TABLE task_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        task_id UUID REFERENCES geofence_tasks(id) ON DELETE SET NULL,
        geofence_id UUID REFERENCES geofences(id) ON DELETE SET NULL,
        geofence_name VARCHAR(120),
        vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        title VARCHAR(160) NOT NULL,
        trigger VARCHAR(5) NOT NULL,
        items JSONB NOT NULL DEFAULT '[]',
        status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','expired')),
        triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        completed_by UUID,
        answers JSONB,
        note VARCHAR(1000),
        photo_data TEXT,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION
      );
      CREATE INDEX idx_task_runs_org ON task_runs (organization_id, status, triggered_at DESC);
      CREATE INDEX idx_task_runs_vehicle ON task_runs (vehicle_id, status);

      ALTER TABLE vehicle_destinations
        ADD COLUMN customer_name VARCHAR(120), ADD COLUMN customer_phone VARCHAR(40), ADD COLUMN customer_email VARCHAR(160),
        ADD COLUMN notify_customer BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN due_at TIMESTAMPTZ,
        ADD COLUMN status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','arrived')),
        ADD COLUMN arrived_at TIMESTAMPTZ,
        ADD COLUMN route JSONB, ADD COLUMN route_distance_m DOUBLE PRECISION, ADD COLUMN route_duration_s DOUBLE PRECISION,
        ADD COLUMN last_eta_minutes DOUBLE PRECISION, ADD COLUMN last_eta_at TIMESTAMPTZ,
        ADD COLUMN notified_eta_minutes DOUBLE PRECISION, ADD COLUMN notified_at TIMESTAMPTZ,
        ADD COLUMN off_route_count INT NOT NULL DEFAULT 0;
      CREATE TABLE dispatch_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        kind VARCHAR(20) NOT NULL CHECK (kind IN ('eta_changed','off_route','rerouted','arrived','delay_risk')),
        detail JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_dispatch_events ON dispatch_events (organization_id, created_at DESC);
      CREATE TABLE customer_notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
        channel VARCHAR(10) NOT NULL,
        recipient VARCHAR(160),
        message VARCHAR(500) NOT NULL,
        status VARCHAR(15) NOT NULL CHECK (status IN ('sent','failed','not_configured')),
        error VARCHAR(300),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_cust_notif ON customer_notifications (organization_id, created_at DESC);

      ALTER TABLE pois ADD COLUMN capacity INT CHECK (capacity IS NULL OR capacity >= 0),
        ADD COLUMN available INT CHECK (available IS NULL OR available >= 0),
        ADD COLUMN availability_updated_at TIMESTAMPTZ;

      CREATE TABLE vehicle_privacy (
        vehicle_id UUID PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        enabled BOOLEAN NOT NULL DEFAULT true,
        timezone VARCHAR(60) NOT NULL DEFAULT 'Africa/Accra',
        work_days INT[] NOT NULL DEFAULT '{1,2,3,4,5}',
        start_time TIME NOT NULL DEFAULT '07:00',
        end_time TIME NOT NULL DEFAULT '19:00'
      );
      CREATE TABLE user_map_scope (
        user_id UUID NOT NULL,
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        hub_id UUID NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, hub_id)
      );
      CREATE TABLE vehicle_cameras (
        vehicle_id UUID PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        provider VARCHAR(60),
        kind VARCHAR(6) NOT NULL CHECK (kind IN ('hls','mp4','iframe')),
        live_url VARCHAR(500),
        clip_url_template VARCHAR(500),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE map_assets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name VARCHAR(120) NOT NULL,
        kind VARCHAR(12) NOT NULL DEFAULT 'other' CHECK (kind IN ('trailer','generator','container','cooler','other')),
        latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
        last_report_at TIMESTAMPTZ,
        status JSONB NOT NULL DEFAULT '{}',
        limits JSONB NOT NULL DEFAULT '{}',
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_map_assets_org ON map_assets (organization_id, is_active);
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP TABLE IF EXISTS map_assets, vehicle_cameras, user_map_scope, vehicle_privacy, customer_notifications, dispatch_events, task_runs, geofence_tasks, geofence_groups, vehicle_group_members, vehicle_groups;
      ALTER TABLE pois DROP COLUMN IF EXISTS capacity, DROP COLUMN IF EXISTS available, DROP COLUMN IF EXISTS availability_updated_at;
      ALTER TABLE vehicle_destinations
        DROP COLUMN IF EXISTS customer_name, DROP COLUMN IF EXISTS customer_phone, DROP COLUMN IF EXISTS customer_email, DROP COLUMN IF EXISTS notify_customer,
        DROP COLUMN IF EXISTS due_at, DROP COLUMN IF EXISTS status, DROP COLUMN IF EXISTS arrived_at, DROP COLUMN IF EXISTS route,
        DROP COLUMN IF EXISTS route_distance_m, DROP COLUMN IF EXISTS route_duration_s, DROP COLUMN IF EXISTS last_eta_minutes,
        DROP COLUMN IF EXISTS last_eta_at, DROP COLUMN IF EXISTS notified_eta_minutes, DROP COLUMN IF EXISTS notified_at, DROP COLUMN IF EXISTS off_route_count;
      ALTER TABLE geofences DROP COLUMN IF EXISTS rule;
    `);
  }
}
