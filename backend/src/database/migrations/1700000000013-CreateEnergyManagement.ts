import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEnergyManagement1700000000013 implements MigrationInterface {
  name = 'CreateEnergyManagement1700000000013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      -- Latest known EV state per vehicle (mirrors into the Redis digital twin;
      -- this table is the durable/historical side).
      CREATE TABLE ev_states (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
        device_id UUID REFERENCES devices(id),
        soc DECIMAL(5,2),
        soh DECIMAL(5,2),
        charging BOOLEAN DEFAULT false,
        plugged_in BOOLEAN DEFAULT false,
        charge_type VARCHAR(10), -- 'AC' | 'DC'
        battery_temperature DECIMAL(5,2),
        estimated_range_km DECIMAL(8,2),
        charging_power_kw DECIMAL(6,2),
        charging_voltage DECIMAL(6,2),
        charging_current DECIMAL(6,2),
        cell_imbalance_mv DECIMAL(6,2),
        fault_codes TEXT[],
        -- V2G readiness (schema-only per spec - not implemented behaviorally yet)
        v2g_capable BOOLEAN DEFAULT false,
        discharge_power_kw DECIMAL(6,2),
        grid_export_enabled BOOLEAN DEFAULT false,
        grid_export_price DECIMAL(8,4),
        energy_exported_kwh DECIMAL(10,3),
        grid_services_enrollment JSONB,
        timestamp TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_ev_states_vehicle_time ON ev_states (vehicle_id, timestamp DESC);

      CREATE TABLE ev_battery_metrics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        avg_soh DECIMAL(5,2),
        degradation_trend_pct_per_month DECIMAL(6,4),
        regen_efficiency_pct DECIMAL(5,2),
        range_accuracy_pct DECIMAL(5,2), -- estimated vs actual range delivered
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_ev_battery_metrics_vehicle ON ev_battery_metrics (vehicle_id, period_start DESC);

      CREATE TABLE charging_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
        device_id UUID REFERENCES devices(id),
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP,
        start_soc DECIMAL(5,2),
        end_soc DECIMAL(5,2),
        start_odometer DECIMAL(12,2),
        end_odometer DECIMAL(12,2),
        energy_added_kwh DECIMAL(10,3),
        energy_consumed_kwh DECIMAL(10,3), -- includes charging losses
        charging_type VARCHAR(10), -- 'AC' | 'DC'
        charger_location VARCHAR(255),
        latitude DECIMAL(10,8),
        longitude DECIMAL(11,8),
        cost DECIMAL(10,2),
        currency VARCHAR(3) DEFAULT 'USD',
        grid_price DECIMAL(8,4),
        charging_curve_json JSONB,
        temperature_json JSONB,
        faults_json JSONB,
        status VARCHAR(20) DEFAULT 'scheduled', -- scheduled|charging|completed|interrupted|failed
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_charging_sessions_vehicle_time ON charging_sessions (vehicle_id, start_time DESC);
      CREATE INDEX idx_charging_sessions_status ON charging_sessions (status);

      CREATE TABLE charge_schedules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
        target_soc DECIMAL(5,2) NOT NULL,
        departure_time TIMESTAMP NOT NULL,
        recommended_start_time TIMESTAMP,
        recommended_end_time TIMESTAMP,
        estimated_cost DECIMAL(10,2),
        estimated_soh_impact DECIMAL(6,4),
        recommended_charge_limit_pct DECIMAL(5,2),
        electricity_price_schedule JSONB, -- [{hour, pricePerKwh}]
        status VARCHAR(20) DEFAULT 'planned', -- planned|active|completed|cancelled
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_charge_schedules_vehicle ON charge_schedules (vehicle_id, departure_time);

      CREATE TABLE energy_consumption_stats (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        kwh_per_100km DECIMAL(8,3),
        miles_per_kwh DECIMAL(8,3),
        energy_cost_total DECIMAL(10,2),
        idle_energy_kwh DECIMAL(8,3),
        hvac_energy_kwh DECIMAL(8,3),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_energy_stats_vehicle ON energy_consumption_stats (vehicle_id, period_start DESC);

      -- ICE/hybrid fuel events kept distinct from the EV tables above -
      -- Energy Management Module covers both, per spec section 6.
      CREATE TABLE fuel_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
        device_id UUID REFERENCES devices(id),
        event_type VARCHAR(20) NOT NULL, -- refuel|theft|rapid_drop
        delta_percent DECIMAL(6,2),
        latitude DECIMAL(10,8),
        longitude DECIMAL(11,8),
        timestamp TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_fuel_events_vehicle_time ON fuel_events (vehicle_id, timestamp DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS fuel_events`);
    await queryRunner.query(`DROP TABLE IF EXISTS energy_consumption_stats`);
    await queryRunner.query(`DROP TABLE IF EXISTS charge_schedules`);
    await queryRunner.query(`DROP TABLE IF EXISTS charging_sessions`);
    await queryRunner.query(`DROP TABLE IF EXISTS ev_battery_metrics`);
    await queryRunner.query(`DROP TABLE IF EXISTS ev_states`);
  }
}
