import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRoamingAndBorderCrossing1700000000021 implements MigrationInterface {
  name = 'CreateRoamingAndBorderCrossing1700000000021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      -- Real country-boundary polygons are not seeded here - this table is
      -- designed against Natural Earth's admin-0 country boundaries dataset
      -- (https://www.naturalearthdata.com, public domain). Import via:
      --   ogr2ogr -f PostgreSQL "PG:dbname=vtrack" ne_10m_admin_0_countries.shp \\
      --     -nln country_boundaries -append -lco GEOMETRY_NAME=geom
      -- then backfill country_code/country_name from the shapefile's ISO_A2/NAME fields.
      CREATE TABLE country_boundaries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        country_code VARCHAR(2) UNIQUE NOT NULL, -- ISO 3166-1 alpha-2
        country_name VARCHAR(100) NOT NULL,
        geom GEOGRAPHY(MULTIPOLYGON, 4326),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_country_boundaries_geom ON country_boundaries USING GIST (geom);

      CREATE TABLE country_policies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        country_code VARCHAR(2) NOT NULL,
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE, -- NULL = platform-wide default
        data_residency_preference VARCHAR(20) DEFAULT 'no_preference', -- 'in_country'|'regional'|'no_preference'
        data_retention_days INTEGER,
        cross_border_transfer_allowed BOOLEAN DEFAULT true,
        audio_recording_allowed VARCHAR(30) DEFAULT 'consent_required', -- matches audio_policies.status values, see Module 5
        requires_consent_notice BOOLEAN DEFAULT false,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_country_policies_country ON country_policies (country_code, organization_id);

      CREATE TABLE sim_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        device_id UUID REFERENCES devices(id),
        iccid VARCHAR(22) UNIQUE, -- SIM serial number
        imsi VARCHAR(15), -- subscriber identity (sensitive - encrypt at rest in application layer)
        msisdn VARCHAR(20), -- phone number
        provider VARCHAR(100),
        sim_type VARCHAR(20) NOT NULL DEFAULT 'local', -- local|multi_network|regional|global|esim|iot_sim|prepaid|postpaid
        roaming_enabled BOOLEAN DEFAULT false,
        allowed_countries TEXT[], -- ISO 3166-1 alpha-2; NULL/empty = home country only
        blocked_countries TEXT[],
        data_cap_mb INTEGER,
        data_used_mb DECIMAL(10,2) DEFAULT 0,
        sms_enabled BOOLEAN DEFAULT true,
        voice_enabled BOOLEAN DEFAULT false,
        apn_settings JSONB,
        status VARCHAR(20) DEFAULT 'active', -- active|suspended|deactivated|swapped
        activated_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_sim_profiles_org ON sim_profiles (organization_id);
      CREATE INDEX idx_sim_profiles_device ON sim_profiles (device_id);

      -- History of which SIM was in which device, when - what detects "SIM
      -- swap" (device now reporting an ICCID that doesn't match its last
      -- known assignment).
      CREATE TABLE sim_assignment_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sim_profile_id UUID REFERENCES sim_profiles(id) ON DELETE CASCADE,
        device_id UUID REFERENCES devices(id),
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        unassigned_at TIMESTAMP,
        unassignment_reason VARCHAR(30) -- 'sim_swap'|'device_decommission'|'manual_reassignment'
      );
      CREATE INDEX idx_sim_assignment_device ON sim_assignment_history (device_id, assigned_at DESC);

      CREATE TABLE roaming_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sim_profile_id UUID REFERENCES sim_profiles(id) ON DELETE CASCADE,
        device_id UUID REFERENCES devices(id),
        event_type VARCHAR(30) NOT NULL, -- 'roaming_started'|'roaming_ended'|'data_cap_warning'|'data_cap_exceeded'|'unexpected_country'
        detected_country VARCHAR(2),
        network_provider VARCHAR(100),
        data_used_mb DECIMAL(10,2),
        timestamp TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_roaming_events_sim_time ON roaming_events (sim_profile_id, timestamp DESC);

      CREATE TABLE network_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
        network_provider VARCHAR(100),
        signal_strength INTEGER,
        network_type VARCHAR(10), -- '2G'|'3G'|'4G'|'5G'
        timestamp TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_network_events_device_time ON network_events (device_id, timestamp DESC);

      CREATE TABLE travel_corridors (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL, -- e.g. "Accra-Lagos Trade Corridor"
        origin_country VARCHAR(2) NOT NULL,
        destination_country VARCHAR(2) NOT NULL,
        expected_countries TEXT[] NOT NULL, -- the full expected route, in order
        max_border_dwell_minutes INTEGER DEFAULT 240, -- flag as a "long border stop" past this
        max_transit_hours INTEGER,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE border_crossings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
        vehicle_id UUID REFERENCES vehicles(id),
        corridor_id UUID REFERENCES travel_corridors(id),
        crossing_type VARCHAR(10) NOT NULL, -- 'entry'|'exit'
        from_country VARCHAR(2),
        to_country VARCHAR(2) NOT NULL,
        latitude DECIMAL(10,8),
        longitude DECIMAL(11,8),
        crossed_at TIMESTAMP NOT NULL,
        dwell_time_minutes INTEGER, -- time spent within N km of the border before/after crossing
        is_authorized BOOLEAN DEFAULT true, -- false if to_country isn't in the SIM's/corridor's allowed list
        is_customs_stop BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_border_crossings_device_time ON border_crossings (device_id, crossed_at DESC);
      CREATE INDEX idx_border_crossings_corridor ON border_crossings (corridor_id, crossed_at DESC);

      CREATE TABLE corridor_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        corridor_id UUID REFERENCES travel_corridors(id) ON DELETE CASCADE,
        device_id UUID REFERENCES devices(id),
        event_type VARCHAR(30) NOT NULL, -- 'deviation'|'long_stop'|'unauthorized_country'|'corridor_completed'
        country VARCHAR(2),
        latitude DECIMAL(10,8),
        longitude DECIMAL(11,8),
        details JSONB,
        timestamp TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_corridor_events_corridor_time ON corridor_events (corridor_id, timestamp DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS corridor_events`);
    await queryRunner.query(`DROP TABLE IF EXISTS border_crossings`);
    await queryRunner.query(`DROP TABLE IF EXISTS travel_corridors`);
    await queryRunner.query(`DROP TABLE IF EXISTS network_events`);
    await queryRunner.query(`DROP TABLE IF EXISTS roaming_events`);
    await queryRunner.query(`DROP TABLE IF EXISTS sim_assignment_history`);
    await queryRunner.query(`DROP TABLE IF EXISTS sim_profiles`);
    await queryRunner.query(`DROP TABLE IF EXISTS country_policies`);
    await queryRunner.query(`DROP TABLE IF EXISTS country_boundaries`);
  }
}
