import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProductCatalog1700000000017 implements MigrationInterface {
  name = 'CreateProductCatalog1700000000017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE currencies (
        code VARCHAR(3) PRIMARY KEY, -- ISO 4217, e.g. GHS, USD, XOF, EUR
        name VARCHAR(100) NOT NULL,
        symbol VARCHAR(5) NOT NULL,
        decimal_places INTEGER DEFAULT 2,
        is_active BOOLEAN DEFAULT true
      );
      INSERT INTO currencies (code, name, symbol) VALUES
        ('GHS', 'Ghanaian Cedi', 'GH₵'),
        ('USD', 'US Dollar', '$'),
        ('XOF', 'West African CFA Franc', 'CFA'),
        ('EUR', 'Euro', '€'),
        ('NGN', 'Nigerian Naira', '₦');

      CREATE TABLE taxes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL, -- e.g. 'Ghana VAT', 'NHIL', 'GETFund'
        rate_percent DECIMAL(5,2) NOT NULL,
        country VARCHAR(2), -- ISO 3166-1 alpha-2
        is_compound BOOLEAN DEFAULT false, -- applied on top of other taxes (e.g. GETFund on VAT-inclusive price)
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE product_categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        description TEXT,
        icon VARCHAR(50),
        display_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE product_catalog (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        category_id UUID REFERENCES product_categories(id),
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        short_description VARCHAR(500),
        long_description TEXT,
        hardware_type VARCHAR(50), -- 'gt06'|'portable'|'roaming_sim'|'audio_capable'|'ev_capable'|'bundle'
        technical_specs JSONB DEFAULT '{}',
        installation_requirements TEXT,
        subscription_required BOOLEAN DEFAULT true,
        base_currency VARCHAR(3) REFERENCES currencies(code) DEFAULT 'GHS',
        available_countries TEXT[], -- ISO 3166-1 alpha-2 codes; NULL/empty = all countries
        is_active BOOLEAN DEFAULT true,
        is_featured BOOLEAN DEFAULT false,
        seo_title VARCHAR(255),
        seo_description VARCHAR(500),
        seo_keywords TEXT[],
        image_urls TEXT[],
        datasheet_url TEXT,
        display_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      );
      CREATE INDEX idx_product_catalog_category ON product_catalog (category_id);
      CREATE INDEX idx_product_catalog_active ON product_catalog (is_active) WHERE deleted_at IS NULL;

      CREATE TABLE product_variants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES product_catalog(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL, -- 'Basic'|'Professional'|'Enterprise'|'Prepaid'|'Postpaid'|'Rental'|'Lease-to-Own'
        sku VARCHAR(50) UNIQUE NOT NULL,
        variant_type VARCHAR(30) NOT NULL, -- 'tier'|'billing_model'|'sim_option'|'install_option'
        includes_sim BOOLEAN DEFAULT true,
        includes_installation BOOLEAN DEFAULT false,
        is_default BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        display_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_product_variants_product ON product_variants (product_id);

      CREATE TABLE product_features (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES product_catalog(id) ON DELETE CASCADE,
        feature_key VARCHAR(100) NOT NULL, -- matches an entitlement key, e.g. 'fuel_telemetry', 'geofencing', 'audio_sos_only'
        feature_label VARCHAR(255) NOT NULL, -- display label, e.g. "Fuel Theft Alerts"
        description TEXT,
        display_order INTEGER DEFAULT 0,
        UNIQUE (product_id, feature_key)
      );

      -- The actual entitlement grant - what a product/variant unlocks in the
      -- platform. Enforced by EntitlementsGuard (see application code) against
      -- the tenant's active subscription_plans row for each org.
      CREATE TABLE product_entitlements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES product_catalog(id) ON DELETE CASCADE,
        variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
        entitlement_key VARCHAR(100) NOT NULL, -- e.g. 'module:portable_assets', 'module:audio', 'feature:fuel_theft_alerts'
        entitlement_value JSONB DEFAULT 'true', -- boolean flag OR a limit, e.g. {"maxDevices": 50}
        UNIQUE (product_id, variant_id, entitlement_key)
      );
      CREATE INDEX idx_product_entitlements_product ON product_entitlements (product_id);

      CREATE TABLE hardware_skus (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES product_catalog(id) ON DELETE CASCADE,
        sku VARCHAR(50) UNIQUE NOT NULL,
        manufacturer VARCHAR(100),
        model VARCHAR(100),
        ip_rating VARCHAR(10), -- e.g. 'IP67'
        battery_capacity_mah INTEGER,
        is_covert_capable BOOLEAN DEFAULT false,
        cost_price DECIMAL(10,2), -- internal cost, not shown publicly
        stock_quantity INTEGER DEFAULT 0,
        low_stock_threshold INTEGER DEFAULT 10,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE service_skus (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES product_catalog(id) ON DELETE CASCADE,
        sku VARCHAR(50) UNIQUE NOT NULL,
        service_type VARCHAR(50) NOT NULL, -- 'subscription'|'sim_data'|'maintenance'|'support'
        billing_cycle VARCHAR(20), -- 'monthly'|'annual'|'one_time'
        is_active BOOLEAN DEFAULT true
      );

      CREATE TABLE installation_skus (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES product_catalog(id) ON DELETE CASCADE,
        sku VARCHAR(50) UNIQUE NOT NULL,
        installation_type VARCHAR(50), -- 'professional'|'self_install'|'no_wiring_required'
        estimated_duration_minutes INTEGER,
        is_active BOOLEAN DEFAULT true
      );

      CREATE TABLE bundles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        description TEXT,
        bundle_discount_percent DECIMAL(5,2) DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE bundle_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bundle_id UUID REFERENCES bundles(id) ON DELETE CASCADE,
        product_id UUID REFERENCES product_catalog(id),
        variant_id UUID REFERENCES product_variants(id),
        quantity INTEGER DEFAULT 1
      );

      CREATE TABLE discounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(50) UNIQUE,
        name VARCHAR(255) NOT NULL,
        discount_type VARCHAR(20) NOT NULL, -- 'percentage'|'fixed_amount'|'volume_tier'
        discount_value DECIMAL(10,2) NOT NULL,
        min_quantity INTEGER, -- for volume_tier
        applies_to_product_id UUID REFERENCES product_catalog(id), -- NULL = storewide
        starts_at TIMESTAMP,
        ends_at TIMESTAMP,
        max_redemptions INTEGER,
        redemption_count INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- One row per (product, variant, currency, tenant-or-null) - tenant_id
      -- NULL means the public/default price list; a row with tenant_id set
      -- overrides it for that org only (negotiated/enterprise pricing).
      CREATE TABLE pricing_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES product_catalog(id) ON DELETE CASCADE,
        variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE, -- NULL = public default pricing
        currency VARCHAR(3) REFERENCES currencies(code) NOT NULL,
        hardware_price DECIMAL(10,2) DEFAULT 0,
        monthly_subscription_price DECIMAL(10,2) DEFAULT 0,
        annual_subscription_price DECIMAL(10,2) DEFAULT 0,
        installation_fee DECIMAL(10,2) DEFAULT 0,
        maintenance_fee DECIMAL(10,2) DEFAULT 0,
        sim_data_fee DECIMAL(10,2) DEFAULT 0,
        roaming_fee DECIMAL(10,2) DEFAULT 0,
        is_trial_pricing BOOLEAN DEFAULT false,
        trial_days INTEGER,
        valid_from TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        valid_until TIMESTAMP,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_pricing_rules_lookup ON pricing_rules (product_id, variant_id, organization_id, currency) WHERE is_active;

      CREATE TABLE subscription_plans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        product_id UUID REFERENCES product_catalog(id),
        variant_id UUID REFERENCES product_variants(id),
        status VARCHAR(20) DEFAULT 'trial', -- trial|active|past_due|cancelled|expired
        billing_cycle VARCHAR(20) DEFAULT 'monthly',
        trial_ends_at TIMESTAMP,
        current_period_start TIMESTAMP,
        current_period_end TIMESTAMP,
        device_limit INTEGER,
        user_limit INTEGER,
        cancelled_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_subscription_plans_org ON subscription_plans (organization_id, status);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS subscription_plans`);
    await queryRunner.query(`DROP TABLE IF EXISTS pricing_rules`);
    await queryRunner.query(`DROP TABLE IF EXISTS discounts`);
    await queryRunner.query(`DROP TABLE IF EXISTS bundle_items`);
    await queryRunner.query(`DROP TABLE IF EXISTS bundles`);
    await queryRunner.query(`DROP TABLE IF EXISTS installation_skus`);
    await queryRunner.query(`DROP TABLE IF EXISTS service_skus`);
    await queryRunner.query(`DROP TABLE IF EXISTS hardware_skus`);
    await queryRunner.query(`DROP TABLE IF EXISTS product_entitlements`);
    await queryRunner.query(`DROP TABLE IF EXISTS product_features`);
    await queryRunner.query(`DROP TABLE IF EXISTS product_variants`);
    await queryRunner.query(`DROP TABLE IF EXISTS product_catalog`);
    await queryRunner.query(`DROP TABLE IF EXISTS product_categories`);
    await queryRunner.query(`DROP TABLE IF EXISTS taxes`);
    await queryRunner.query(`DROP TABLE IF EXISTS currencies`);
  }
}
