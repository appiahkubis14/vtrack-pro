import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Completes Phase 1 of the Project Model: suppliers, write-offs, business payments (deposits, installments, charges,
 * payouts, hub deposits), lock requests and rider exceptions, per-hub and per-contract grace periods, rider and user
 * links, and an append-only audit trail.
 */
export class CompletePhaseOne1700000000027 implements MigrationInterface {
  name = 'CompletePhaseOne1700000000027';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      -- ---------- Grace periods (BR16): contract overrides hub overrides the default of 12 hours ----------
      ALTER TABLE hubs ADD COLUMN grace_period_hours INTEGER CHECK (grace_period_hours BETWEEN 1 AND 168);
      ALTER TABLE sale_contracts ADD COLUMN grace_period_hours INTEGER CHECK (grace_period_hours BETWEEN 1 AND 168);

      -- ---------- Logins for riders and a forced password change for accounts created by an administrator ----------
      ALTER TABLE riders ADD COLUMN user_id UUID REFERENCES users(id);
      CREATE UNIQUE INDEX uq_riders_user ON riders (user_id) WHERE user_id IS NOT NULL;
      ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;

      -- ---------- Suppliers ----------
      CREATE TABLE suppliers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name VARCHAR(150) NOT NULL,
        country VARCHAR(60),
        contact_name VARCHAR(120),
        phone VARCHAR(40),
        email VARCHAR(150),
        notes TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, name)
      );
      ALTER TABLE consignments ADD COLUMN supplier_id UUID REFERENCES suppliers(id);

      -- ---------- Write-offs (BR14): units lost, damaged or retired, always with a reason ----------
      ALTER TABLE consignment_lines ADD COLUMN units_written_off INTEGER NOT NULL DEFAULT 0 CHECK (units_written_off >= 0);
      ALTER TABLE consignment_lines ADD CONSTRAINT chk_line_units CHECK (units_registered + units_written_off <= quantity);
      CREATE TABLE write_offs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        consignment_line_id UUID REFERENCES consignment_lines(id),
        vehicle_id UUID REFERENCES vehicles(id),
        units INTEGER NOT NULL DEFAULT 1 CHECK (units > 0),
        reason TEXT NOT NULL CHECK (length(btrim(reason)) >= 3),
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CHECK (consignment_line_id IS NOT NULL OR vehicle_id IS NOT NULL)
      );

      -- ---------- Business payments: every cash movement with a purpose, a payer and a unique reference (BR6) ----------
      CREATE TABLE business_payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        purpose VARCHAR(12) NOT NULL CHECK (purpose IN ('deposit','installment','charge','payout','hub_deposit')),
        direction VARCHAR(3) NOT NULL CHECK (direction IN ('in','out')),
        amount_pesewas BIGINT NOT NULL CHECK (amount_pesewas > 0),
        method VARCHAR(6) NOT NULL CHECK (method IN ('cash','momo','bank')),
        party_type VARCHAR(8) CHECK (party_type IN ('owner','rider','hub','company')),
        party_id UUID,
        party_name VARCHAR(150),
        contract_id UUID REFERENCES sale_contracts(id),
        charge_event_id UUID REFERENCES charge_events(id),
        hub_id UUID REFERENCES hubs(id),
        reference VARCHAR(120) NOT NULL,
        ledger_transaction_id UUID REFERENCES ledger_transactions(id),
        note TEXT,
        recorded_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, reference)
      );
      CREATE INDEX idx_business_payments_contract ON business_payments (contract_id);
      CREATE INDEX idx_business_payments_party ON business_payments (party_type, party_id);
      ALTER TABLE charge_events DROP CONSTRAINT charge_events_status_check;
      ALTER TABLE charge_events ADD CONSTRAINT charge_events_status_check CHECK (status IN ('open','completed','billed','paid'));
      ALTER TABLE charge_events ADD COLUMN payment_id UUID REFERENCES business_payments(id);

      -- ---------- Safe lock: requests that need approval (BR8), and rider exceptions (BR17, proposed) ----------
      CREATE TABLE lock_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        hub_id UUID REFERENCES hubs(id),
        vehicle_id UUID NOT NULL REFERENCES vehicles(id),
        rider_id UUID REFERENCES riders(id),
        kind VARCHAR(6) NOT NULL DEFAULT 'lock' CHECK (kind IN ('lock','unlock')),
        reason TEXT NOT NULL CHECK (length(btrim(reason)) >= 3),
        status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','executed','failed')),
        requested_by UUID REFERENCES users(id),
        decided_by UUID REFERENCES users(id),
        decided_at TIMESTAMP,
        decision_note TEXT,
        command_id UUID,
        result_note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_lock_requests_status ON lock_requests (organization_id, status);
      CREATE UNIQUE INDEX uq_lock_request_pending ON lock_requests (vehicle_id, kind) WHERE status = 'pending';

      ALTER TABLE immobilizer_state ADD COLUMN unlocked_at TIMESTAMP, ADD COLUMN unlock_reason TEXT,
        ADD COLUMN unlocked_by UUID, ADD COLUMN trigger_source VARCHAR(20), ADD COLUMN settlement_id UUID;

      CREATE TABLE rider_exceptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        rider_id UUID NOT NULL REFERENCES riders(id),
        kind VARCHAR(10) NOT NULL CHECK (kind IN ('sickness','breakdown','leave','other')),
        starts_on DATE NOT NULL,
        ends_on DATE NOT NULL,
        reason TEXT NOT NULL CHECK (length(btrim(reason)) >= 3),
        status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
        approved_by UUID NOT NULL REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CHECK (ends_on >= starts_on)
      );
      CREATE INDEX idx_rider_exceptions_rider ON rider_exceptions (rider_id, starts_on, ends_on);

      -- ---------- The audit trail cannot be edited or deleted ----------
      CREATE FUNCTION forbid_audit_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'The audit trail is append-only: % on % is not allowed', TG_OP, TG_TABLE_NAME;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER trg_audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON audit_logs;
      DROP FUNCTION IF EXISTS forbid_audit_mutation();
      DROP TABLE IF EXISTS rider_exceptions, lock_requests CASCADE;
      ALTER TABLE immobilizer_state DROP COLUMN IF EXISTS unlocked_at, DROP COLUMN IF EXISTS unlock_reason,
        DROP COLUMN IF EXISTS unlocked_by, DROP COLUMN IF EXISTS trigger_source, DROP COLUMN IF EXISTS settlement_id;
      ALTER TABLE charge_events DROP COLUMN IF EXISTS payment_id;
      UPDATE charge_events SET status = 'billed' WHERE status = 'paid';
      ALTER TABLE charge_events DROP CONSTRAINT IF EXISTS charge_events_status_check;
      ALTER TABLE charge_events ADD CONSTRAINT charge_events_status_check CHECK (status IN ('open','completed','billed'));
      DROP TABLE IF EXISTS business_payments, write_offs CASCADE;
      ALTER TABLE consignment_lines DROP CONSTRAINT IF EXISTS chk_line_units;
      ALTER TABLE consignment_lines DROP COLUMN IF EXISTS units_written_off;
      ALTER TABLE consignments DROP COLUMN IF EXISTS supplier_id;
      DROP TABLE IF EXISTS suppliers CASCADE;
      ALTER TABLE users DROP COLUMN IF EXISTS must_change_password;
      DROP INDEX IF EXISTS uq_riders_user;
      ALTER TABLE riders DROP COLUMN IF EXISTS user_id;
      ALTER TABLE sale_contracts DROP COLUMN IF EXISTS grace_period_hours;
      ALTER TABLE hubs DROP COLUMN IF EXISTS grace_period_hours;
    `);
  }
}
