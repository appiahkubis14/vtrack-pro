import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Business layer for the Ghana e-mobility programme (see docs/VTrack-Pro-Project-Model.pdf):
 * hubs, vehicle models, consignments, owners, contracts, assignments, batteries, charging,
 * daily collections and settlements, and an append-only double-entry ledger.
 * All money columns are BIGINT pesewas (GHS 1.00 = 100 pesewas).
 */
export class CreateBusinessLayer1700000000026 implements MigrationInterface {
  name = 'CreateBusinessLayer1700000000026';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      -- ---------- Hubs ----------
      CREATE TABLE hubs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name VARCHAR(150) NOT NULL,
        region VARCHAR(60) NOT NULL,
        town VARCHAR(100),
        assembly VARCHAR(150),
        latitude DECIMAL(10,8),
        longitude DECIMAL(11,8),
        manager_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pilot' CHECK (status IN ('pilot','active','closed')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, name)
      );
      CREATE INDEX idx_hubs_manager ON hubs (manager_user_id);

      CREATE TABLE charge_points (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        hub_id UUID NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        power_source VARCHAR(10) NOT NULL DEFAULT 'grid' CHECK (power_source IN ('grid','solar')),
        status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','faulty','offline')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (hub_id, name)
      );

      -- ---------- Vehicle models, consignments ----------
      CREATE TABLE vehicle_models (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        brand VARCHAR(80) NOT NULL,
        name VARCHAR(120) NOT NULL,
        vehicle_type VARCHAR(20) NOT NULL CHECK (vehicle_type IN ('ebike','trike_passenger','trike_goods','trike_waste')),
        battery_spec VARCHAR(80),
        list_price_pesewas BIGINT NOT NULL DEFAULT 0 CHECK (list_price_pesewas >= 0),
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, brand, name)
      );

      CREATE TABLE consignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        reference VARCHAR(60) NOT NULL,
        supplier_name VARCHAR(150),
        supplier_country VARCHAR(60),
        container_no VARCHAR(30),
        bl_number VARCHAR(50),
        status VARCHAR(12) NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered','shipped','at_port','cleared','received','closed')),
        shipped_at DATE, arrived_at DATE, cleared_at DATE, received_at DATE, closed_at DATE,
        landed_cost_pesewas BIGINT NOT NULL DEFAULT 0 CHECK (landed_cost_pesewas >= 0),
        notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, reference)
      );

      CREATE TABLE consignment_lines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        consignment_id UUID NOT NULL REFERENCES consignments(id) ON DELETE CASCADE,
        vehicle_model_id UUID NOT NULL REFERENCES vehicle_models(id),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_cost_pesewas BIGINT NOT NULL DEFAULT 0 CHECK (unit_cost_pesewas >= 0),
        units_registered INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_consignment_lines_consignment ON consignment_lines (consignment_id);

      -- ---------- Owners ----------
      CREATE TABLE owners (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        owner_type VARCHAR(12) NOT NULL DEFAULT 'individual' CHECK (owner_type IN ('individual','sme')),
        name VARCHAR(200) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        email VARCHAR(255),
        momo_number_enc TEXT,
        id_document_enc TEXT,
        id_document_last4 VARCHAR(4),
        kyc_status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (kyc_status IN ('pending','verified','rejected')),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- login for the investor portal
        rider_id UUID, -- set when an owner is also an owner-operator (FK added below)
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, phone)
      );
      CREATE INDEX idx_owners_user ON owners (user_id);

      -- ---------- Extend vehicles and riders ----------
      ALTER TABLE vehicles
        ADD COLUMN vehicle_model_id UUID REFERENCES vehicle_models(id),
        ADD COLUMN consignment_line_id UUID REFERENCES consignment_lines(id),
        ADD COLUMN chassis_no VARCHAR(60),
        ADD COLUMN motor_no VARCHAR(60),
        ADD COLUMN owner_id UUID REFERENCES owners(id),
        ADD COLUMN hub_id UUID REFERENCES hubs(id),
        ADD COLUMN lifecycle_status VARCHAR(15) NOT NULL DEFAULT 'in_stock';
      -- vehicles that already existed before this migration are already in service
      UPDATE vehicles SET lifecycle_status = 'active';
      CREATE UNIQUE INDEX uq_vehicles_chassis ON vehicles (organization_id, chassis_no) WHERE chassis_no IS NOT NULL;
      CREATE INDEX idx_vehicles_hub ON vehicles (hub_id);
      CREATE INDEX idx_vehicles_owner ON vehicles (owner_id);
      CREATE INDEX idx_vehicles_lifecycle ON vehicles (organization_id, lifecycle_status);

      ALTER TABLE riders
        ADD COLUMN hub_id UUID REFERENCES hubs(id),
        ADD COLUMN momo_number_enc TEXT,
        ADD COLUMN guarantor_name VARCHAR(200),
        ADD COLUMN guarantor_phone VARCHAR(20),
        ADD COLUMN status VARCHAR(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','exited'));
      CREATE INDEX idx_riders_hub ON riders (hub_id);
      ALTER TABLE owners ADD CONSTRAINT fk_owners_rider FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE SET NULL;

      -- ---------- Contracts ----------
      CREATE TABLE sale_contracts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        contract_no VARCHAR(40) NOT NULL,
        owner_id UUID NOT NULL REFERENCES owners(id),
        vehicle_id UUID NOT NULL REFERENCES vehicles(id),
        mode VARCHAR(14) NOT NULL CHECK (mode IN ('outright','lease','work_and_pay')),
        price_pesewas BIGINT NOT NULL CHECK (price_pesewas > 0),
        deposit_pesewas BIGINT NOT NULL DEFAULT 0 CHECK (deposit_pesewas >= 0),
        term_weeks INTEGER,
        daily_amount_pesewas BIGINT,
        start_date DATE NOT NULL,
        status VARCHAR(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','completed','defaulted','repossessed','cancelled')),
        default_after_arrears_days INTEGER NOT NULL DEFAULT 14,
        approved_by UUID REFERENCES users(id),
        created_by UUID REFERENCES users(id),
        activated_at TIMESTAMP, closed_at TIMESTAMP,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CHECK (deposit_pesewas <= price_pesewas),
        UNIQUE (organization_id, contract_no)
      );
      -- rule BR1: a vehicle has at most one live contract
      CREATE UNIQUE INDEX uq_contract_vehicle_live ON sale_contracts (vehicle_id) WHERE status IN ('active','defaulted');
      CREATE INDEX idx_contracts_owner ON sale_contracts (owner_id);

      CREATE TABLE installments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contract_id UUID NOT NULL REFERENCES sale_contracts(id) ON DELETE CASCADE,
        due_date DATE NOT NULL,
        amount_pesewas BIGINT NOT NULL CHECK (amount_pesewas > 0),
        paid_pesewas BIGINT NOT NULL DEFAULT 0 CHECK (paid_pesewas >= 0 AND paid_pesewas <= amount_pesewas),
        paid_at TIMESTAMP
      );
      CREATE INDEX idx_installments_contract_due ON installments (contract_id, due_date);

      -- ---------- Assignments, batteries, charging ----------
      CREATE TABLE rider_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        rider_id UUID NOT NULL REFERENCES riders(id),
        vehicle_id UUID NOT NULL REFERENCES vehicles(id),
        hub_id UUID NOT NULL REFERENCES hubs(id),
        start_date DATE NOT NULL,
        end_date DATE,
        daily_target_pesewas BIGINT NOT NULL DEFAULT 0 CHECK (daily_target_pesewas >= 0),
        daily_remittance_pesewas BIGINT NOT NULL DEFAULT 0 CHECK (daily_remittance_pesewas >= 0),
        service_fee_pesewas BIGINT NOT NULL DEFAULT 0 CHECK (service_fee_pesewas >= 0),
        status VARCHAR(8) NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
        ended_reason VARCHAR(100),
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      -- rules BR1/BR2
      CREATE UNIQUE INDEX uq_assignment_rider_active ON rider_assignments (rider_id) WHERE status = 'active';
      CREATE UNIQUE INDEX uq_assignment_vehicle_active ON rider_assignments (vehicle_id) WHERE status = 'active';
      CREATE INDEX idx_assignments_hub ON rider_assignments (hub_id, status);

      CREATE TABLE batteries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        serial_no VARCHAR(80) NOT NULL,
        voltage INTEGER NOT NULL DEFAULT 72,
        capacity_ah INTEGER NOT NULL DEFAULT 100,
        gps_module_id VARCHAR(80),
        status VARCHAR(10) NOT NULL DEFAULT 'available' CHECK (status IN ('available','fitted','charging','faulty','missing')),
        current_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
        hub_id UUID REFERENCES hubs(id),
        health_pct DECIMAL(5,2),
        cycle_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, serial_no)
      );
      -- rule BR3: a vehicle holds at most one battery
      CREATE UNIQUE INDEX uq_battery_vehicle ON batteries (current_vehicle_id) WHERE current_vehicle_id IS NOT NULL;

      CREATE TABLE battery_swaps (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        hub_id UUID NOT NULL REFERENCES hubs(id),
        vehicle_id UUID NOT NULL REFERENCES vehicles(id),
        rider_id UUID REFERENCES riders(id),
        battery_out_id UUID REFERENCES batteries(id),
        battery_in_id UUID REFERENCES batteries(id),
        swapped_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        recorded_by UUID REFERENCES users(id)
      );
      CREATE INDEX idx_swaps_vehicle ON battery_swaps (vehicle_id, swapped_at DESC);

      CREATE TABLE daily_settlements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id),
        hub_id UUID NOT NULL REFERENCES hubs(id),
        rider_id UUID NOT NULL REFERENCES riders(id),
        vehicle_id UUID NOT NULL REFERENCES vehicles(id),
        owner_id UUID REFERENCES owners(id),
        settlement_date DATE NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        is_current BOOLEAN NOT NULL DEFAULT true,
        gross_collected_pesewas BIGINT NOT NULL DEFAULT 0,
        charge_fee_pesewas BIGINT NOT NULL DEFAULT 0,
        remittance_due_pesewas BIGINT NOT NULL DEFAULT 0,
        remittance_paid_pesewas BIGINT NOT NULL DEFAULT 0,
        service_fee_pesewas BIGINT NOT NULL DEFAULT 0,
        chop_pesewas BIGINT NOT NULL DEFAULT 0,
        shortfall_pesewas BIGINT NOT NULL DEFAULT 0,
        net_to_owner_pesewas BIGINT NOT NULL DEFAULT 0,
        status VARCHAR(10) NOT NULL DEFAULT 'calculated' CHECK (status IN ('open','calculated','settled','shortfall','closed')),
        ledger_transaction_id UUID,
        calculated_by UUID REFERENCES users(id),
        closed_by UUID REFERENCES users(id),
        closed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (rider_id, vehicle_id, settlement_date, version)
      );
      -- rule BR7: one current settlement per rider, vehicle and day; recalculation adds a new version
      CREATE UNIQUE INDEX uq_settlement_current ON daily_settlements (rider_id, vehicle_id, settlement_date) WHERE is_current;
      CREATE INDEX idx_settlements_hub_date ON daily_settlements (hub_id, settlement_date);

      CREATE TABLE daily_collections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        hub_id UUID NOT NULL REFERENCES hubs(id),
        rider_id UUID NOT NULL REFERENCES riders(id),
        vehicle_id UUID NOT NULL REFERENCES vehicles(id),
        collection_date DATE NOT NULL,
        amount_pesewas BIGINT NOT NULL CHECK (amount_pesewas > 0),
        source VARCHAR(10) NOT NULL DEFAULT 'cash' CHECK (source IN ('cash','momo','other')),
        reference VARCHAR(100),
        recorded_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX uq_collection_reference ON daily_collections (organization_id, reference) WHERE reference IS NOT NULL;
      CREATE INDEX idx_collections_rider_date ON daily_collections (rider_id, collection_date);

      CREATE TABLE charge_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        hub_id UUID NOT NULL REFERENCES hubs(id),
        charge_point_id UUID REFERENCES charge_points(id),
        battery_id UUID NOT NULL REFERENCES batteries(id),
        rider_id UUID REFERENCES riders(id),
        kwh DECIMAL(8,3),
        fee_pesewas BIGINT NOT NULL DEFAULT 0 CHECK (fee_pesewas >= 0),
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ended_at TIMESTAMP,
        charge_date DATE NOT NULL DEFAULT CURRENT_DATE,
        status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','billed')),
        settlement_id UUID REFERENCES daily_settlements(id),
        recorded_by UUID REFERENCES users(id)
      );
      CREATE INDEX idx_charge_events_rider_date ON charge_events (rider_id, charge_date);
      CREATE INDEX idx_charge_events_battery ON charge_events (battery_id, started_at DESC);

      -- ---------- Ledger (append-only, double entry) ----------
      CREATE TABLE ledger_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id),
        code VARCHAR(40) NOT NULL,
        owner_type VARCHAR(10) NOT NULL CHECK (owner_type IN ('company','rider','owner','hub')),
        owner_id UUID,
        name VARCHAR(150) NOT NULL,
        normal_side VARCHAR(6) NOT NULL CHECK (normal_side IN ('debit','credit')),
        currency VARCHAR(3) NOT NULL DEFAULT 'GHS',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX uq_ledger_account ON ledger_accounts (organization_id, code, owner_type, COALESCE(owner_id, '00000000-0000-0000-0000-000000000000'::uuid));

      CREATE TABLE ledger_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id),
        reference VARCHAR(150) NOT NULL,
        kind VARCHAR(30) NOT NULL,
        description TEXT,
        occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reverses_transaction_id UUID REFERENCES ledger_transactions(id),
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, reference) -- rule BR6: the same external event can only post once
      );

      CREATE TABLE ledger_entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id UUID NOT NULL REFERENCES ledger_transactions(id),
        account_id UUID NOT NULL REFERENCES ledger_accounts(id),
        direction VARCHAR(6) NOT NULL CHECK (direction IN ('debit','credit')),
        amount_pesewas BIGINT NOT NULL CHECK (amount_pesewas > 0),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_ledger_entries_account ON ledger_entries (account_id, created_at);
      CREATE INDEX idx_ledger_entries_tx ON ledger_entries (transaction_id);

      ALTER TABLE daily_settlements
        ADD CONSTRAINT fk_settlement_ledger_tx FOREIGN KEY (ledger_transaction_id) REFERENCES ledger_transactions(id);

      -- rule BR5: nothing in the ledger is ever edited or deleted; corrections are reversing entries.
      CREATE FUNCTION forbid_ledger_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'The ledger is append-only: % on % is not allowed (post a reversing transaction instead)', TG_OP, TG_TABLE_NAME;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER trg_ledger_entries_immutable BEFORE UPDATE OR DELETE ON ledger_entries
        FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
      CREATE TRIGGER trg_ledger_transactions_immutable BEFORE UPDATE OR DELETE ON ledger_transactions
        FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

      -- every transaction must balance, checked when the database transaction commits
      CREATE FUNCTION check_ledger_balanced() RETURNS trigger AS $$
      DECLARE d BIGINT; c BIGINT;
      BEGIN
        SELECT COALESCE(SUM(amount_pesewas) FILTER (WHERE direction = 'debit'), 0),
               COALESCE(SUM(amount_pesewas) FILTER (WHERE direction = 'credit'), 0)
          INTO d, c FROM ledger_entries WHERE transaction_id = NEW.transaction_id;
        IF d <> c THEN
          RAISE EXCEPTION 'Ledger transaction % is not balanced: debits % vs credits %', NEW.transaction_id, d, c;
        END IF;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
      CREATE CONSTRAINT TRIGGER trg_ledger_balanced AFTER INSERT ON ledger_entries
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_ledger_balanced();
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP TRIGGER IF EXISTS trg_ledger_balanced ON ledger_entries;
      DROP TRIGGER IF EXISTS trg_ledger_entries_immutable ON ledger_entries;
      DROP TRIGGER IF EXISTS trg_ledger_transactions_immutable ON ledger_transactions;
      ALTER TABLE daily_settlements DROP CONSTRAINT IF EXISTS fk_settlement_ledger_tx;
      DROP TABLE IF EXISTS ledger_entries, ledger_transactions, ledger_accounts, charge_events, daily_collections,
        daily_settlements, battery_swaps, batteries, rider_assignments, installments, sale_contracts CASCADE;
      DROP FUNCTION IF EXISTS check_ledger_balanced();
      DROP FUNCTION IF EXISTS forbid_ledger_mutation();
      ALTER TABLE owners DROP CONSTRAINT IF EXISTS fk_owners_rider;
      ALTER TABLE riders DROP COLUMN IF EXISTS hub_id, DROP COLUMN IF EXISTS momo_number_enc,
        DROP COLUMN IF EXISTS guarantor_name, DROP COLUMN IF EXISTS guarantor_phone, DROP COLUMN IF EXISTS status;
      ALTER TABLE vehicles DROP COLUMN IF EXISTS vehicle_model_id, DROP COLUMN IF EXISTS consignment_line_id,
        DROP COLUMN IF EXISTS chassis_no, DROP COLUMN IF EXISTS motor_no, DROP COLUMN IF EXISTS owner_id,
        DROP COLUMN IF EXISTS hub_id, DROP COLUMN IF EXISTS lifecycle_status;
      DROP TABLE IF EXISTS owners, consignment_lines, consignments, vehicle_models, charge_points, hubs CASCADE;
    `);
  }
}
