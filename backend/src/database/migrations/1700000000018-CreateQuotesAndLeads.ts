import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateQuotesAndLeads1700000000018 implements MigrationInterface {
  name = 'CreateQuotesAndLeads1700000000018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE campaign_sources (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL, -- 'google_ads'|'facebook'|'referral'|'organic'|'whatsapp'|'trade_show'
        utm_source VARCHAR(100),
        utm_medium VARCHAR(100),
        utm_campaign VARCHAR(100),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE leads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_name VARCHAR(255) NOT NULL,
        company_name VARCHAR(255),
        phone VARCHAR(30),
        email VARCHAR(255),
        whatsapp_number VARCHAR(30),
        country VARCHAR(2), -- ISO 3166-1 alpha-2
        city VARCHAR(100),
        fleet_size INTEGER,
        product_interest_id UUID REFERENCES product_catalog(id),
        message TEXT,
        source_channel VARCHAR(50), -- 'website'|'phone'|'whatsapp'|'referral'|'walk_in'
        campaign_source_id UUID REFERENCES campaign_sources(id),
        preferred_language VARCHAR(10) DEFAULT 'en', -- 'en'|'fr'|'pt'|'tw'|'ee'|'ha'
        consent_to_contact BOOLEAN DEFAULT false,
        status VARCHAR(20) DEFAULT 'new', -- new|contacted|qualified|quote_sent|negotiating|won|lost|archived
        assigned_to UUID REFERENCES users(id),
        converted_organization_id UUID REFERENCES organizations(id), -- set when lead converts to a real tenant
        lost_reason VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_leads_status ON leads (status, created_at DESC);
      CREATE INDEX idx_leads_assigned ON leads (assigned_to);

      -- Every status transition + touchpoint, for sales pipeline reporting.
      CREATE TABLE lead_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
        event_type VARCHAR(50) NOT NULL, -- 'status_change'|'note_added'|'quote_sent'|'call_logged'|'email_sent'
        from_status VARCHAR(20),
        to_status VARCHAR(20),
        note TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_lead_events_lead ON lead_events (lead_id, created_at);

      -- A "customer" is a lead (or direct signup) once they're a real
      -- commercial contact, before/alongside having an actual organizations
      -- row (a customer might have multiple orgs, e.g. a logistics group
      -- with several subsidiary fleets).
      CREATE TABLE customers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_id UUID REFERENCES leads(id),
        organization_id UUID REFERENCES organizations(id),
        billing_name VARCHAR(255) NOT NULL,
        billing_email VARCHAR(255),
        billing_phone VARCHAR(30),
        billing_address TEXT,
        tax_id VARCHAR(50), -- e.g. Ghana TIN
        country VARCHAR(2),
        preferred_currency VARCHAR(3) REFERENCES currencies(code) DEFAULT 'GHS',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE quotes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        quote_number VARCHAR(30) UNIQUE NOT NULL, -- e.g. 'QT-2026-00042'
        lead_id UUID REFERENCES leads(id),
        customer_id UUID REFERENCES customers(id),
        organization_id UUID REFERENCES organizations(id), -- sales org (V-Track Pro's own tenant), not the customer's
        created_by UUID REFERENCES users(id),
        currency VARCHAR(3) REFERENCES currencies(code) NOT NULL,
        subtotal DECIMAL(12,2) DEFAULT 0,
        discount_total DECIMAL(12,2) DEFAULT 0,
        tax_total DECIMAL(12,2) DEFAULT 0,
        grand_total DECIMAL(12,2) DEFAULT 0,
        validity_days INTEGER DEFAULT 30,
        expires_at TIMESTAMP,
        terms_and_conditions TEXT,
        payment_schedule TEXT, -- free text, e.g. "50% upfront, 50% on installation"
        notes TEXT,
        status VARCHAR(20) DEFAULT 'draft', -- draft|pending_approval|sent|accepted|rejected|expired|converted_to_order
        approved_by UUID REFERENCES users(id),
        approved_at TIMESTAMP,
        sent_at TIMESTAMP,
        accepted_at TIMESTAMP,
        rejected_at TIMESTAMP,
        rejection_reason TEXT,
        pdf_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_quotes_lead ON quotes (lead_id);
      CREATE INDEX idx_quotes_status ON quotes (status, created_at DESC);

      CREATE TABLE quote_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        quote_id UUID REFERENCES quotes(id) ON DELETE CASCADE,
        product_id UUID REFERENCES product_catalog(id),
        variant_id UUID REFERENCES product_variants(id),
        bundle_id UUID REFERENCES bundles(id),
        description VARCHAR(500), -- snapshot of product name at quote time (product may change later)
        quantity INTEGER DEFAULT 1,
        unit_hardware_price DECIMAL(10,2) DEFAULT 0,
        unit_installation_price DECIMAL(10,2) DEFAULT 0,
        unit_subscription_price DECIMAL(10,2) DEFAULT 0,
        unit_sim_price DECIMAL(10,2) DEFAULT 0,
        discount_id UUID REFERENCES discounts(id),
        line_discount_amount DECIMAL(10,2) DEFAULT 0,
        line_tax_amount DECIMAL(10,2) DEFAULT 0,
        line_total DECIMAL(12,2) DEFAULT 0,
        display_order INTEGER DEFAULT 0
      );
      CREATE INDEX idx_quote_items_quote ON quote_items (quote_id);

      -- Minimal order/invoice tracking for "quote accepted -> becomes billable" -
      -- deliberately shallow (no payment gateway integration per the
      -- assumptions in this response) but enough to track what was sold.
      CREATE TABLE orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        quote_id UUID REFERENCES quotes(id),
        customer_id UUID REFERENCES customers(id),
        organization_id UUID REFERENCES organizations(id),
        order_number VARCHAR(30) UNIQUE NOT NULL,
        status VARCHAR(20) DEFAULT 'pending', -- pending|provisioning|fulfilled|cancelled
        total_amount DECIMAL(12,2),
        currency VARCHAR(3) REFERENCES currencies(code),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        fulfilled_at TIMESTAMP
      );

      CREATE TABLE invoices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID REFERENCES orders(id),
        invoice_number VARCHAR(30) UNIQUE NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        currency VARCHAR(3) REFERENCES currencies(code),
        status VARCHAR(20) DEFAULT 'unpaid', -- unpaid|paid|overdue|void
        due_date DATE,
        paid_at TIMESTAMP,
        payment_method_note VARCHAR(255), -- free text until a real gateway is integrated
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS invoices`);
    await queryRunner.query(`DROP TABLE IF EXISTS orders`);
    await queryRunner.query(`DROP TABLE IF EXISTS quote_items`);
    await queryRunner.query(`DROP TABLE IF EXISTS quotes`);
    await queryRunner.query(`DROP TABLE IF EXISTS customers`);
    await queryRunner.query(`DROP TABLE IF EXISTS lead_events`);
    await queryRunner.query(`DROP TABLE IF EXISTS leads`);
    await queryRunner.query(`DROP TABLE IF EXISTS campaign_sources`);
  }
}
