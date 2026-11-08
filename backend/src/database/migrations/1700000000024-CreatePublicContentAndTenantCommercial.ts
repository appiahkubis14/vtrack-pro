import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePublicContentAndTenantCommercial1700000000024 implements MigrationInterface {
  name = 'CreatePublicContentAndTenantCommercial1700000000024';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      -- Module 7: public marketing content, driven by API rather than
      -- hardcoded into the frontend so non-engineers can update copy.
      CREATE TABLE testimonials (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_name VARCHAR(255) NOT NULL,
        company_name VARCHAR(255),
        quote TEXT NOT NULL,
        rating INTEGER CHECK (rating BETWEEN 1 AND 5),
        photo_url TEXT,
        product_id UUID REFERENCES product_catalog(id), -- optional: testimonial specific to one product
        is_published BOOLEAN DEFAULT false,
        display_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_testimonials_published ON testimonials (is_published, display_order);

      CREATE TABLE faqs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        question VARCHAR(500) NOT NULL,
        answer TEXT NOT NULL,
        category VARCHAR(100), -- e.g. 'pricing'|'installation'|'general'|'technical'
        product_id UUID REFERENCES product_catalog(id), -- optional: product-specific FAQ
        is_published BOOLEAN DEFAULT false,
        display_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_faqs_published ON faqs (is_published, category, display_order);

      CREATE TABLE marketing_assets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        asset_type VARCHAR(30) NOT NULL, -- 'hero_image'|'datasheet'|'brochure'|'video'|'logo'
        title VARCHAR(255),
        url TEXT NOT NULL,
        product_id UUID REFERENCES product_catalog(id),
        alt_text VARCHAR(255),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Simple CMS pages (About, Privacy Policy, Terms of Service) - stored
      -- as markdown/HTML blobs rather than a full page-builder, since the
      -- spec asks for "SEO pages" and static legal pages, not a visual editor.
      CREATE TABLE public_pages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        slug VARCHAR(255) UNIQUE NOT NULL, -- e.g. 'privacy-policy', 'terms-of-service', 'about'
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL, -- markdown
        seo_title VARCHAR(255),
        seo_description VARCHAR(500),
        language VARCHAR(10) DEFAULT 'en',
        is_published BOOLEAN DEFAULT false,
        published_at TIMESTAMP,
        updated_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_public_pages_slug_lang ON public_pages (slug, language);

      -- Module 8: tenant commercial settings, extending organizations rather
      -- than a fully separate table - these are 1:1 with an organization.
      ALTER TABLE organizations
        ADD COLUMN primary_color VARCHAR(7),
        ADD COLUMN language_default VARCHAR(10) DEFAULT 'en',
        ADD COLUMN catalog_visibility VARCHAR(20) DEFAULT 'full', -- 'full'|'restricted'|'hidden' - which products this org can see/order
        ADD COLUMN device_limit INTEGER,
        ADD COLUMN user_limit INTEGER,
        ADD COLUMN billing_status VARCHAR(20) DEFAULT 'trial', -- 'trial'|'active'|'past_due'|'suspended'|'cancelled'
        ADD COLUMN payment_method_type VARCHAR(30), -- 'mobile_money'|'card'|'bank_transfer'|'invoice' - metadata only, no real gateway integration
        ADD COLUMN payment_method_reference VARCHAR(100),
        ADD COLUMN tax_id VARCHAR(50),
        ADD COLUMN data_retention_tier VARCHAR(20) DEFAULT 'standard'; -- 'standard'|'extended'|'minimal'

      -- Which product categories/modules an org is explicitly restricted
      -- from seeing, when catalog_visibility = 'restricted'. Empty = sees
      -- everything except what's listed here.
      CREATE TABLE tenant_catalog_restrictions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        product_id UUID REFERENCES product_catalog(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, product_id)
      );

      -- Per-tenant notification template overrides (e.g. a white-labeled
      -- reseller wanting their own branding in alert emails).
      CREATE TABLE tenant_notification_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        template_key VARCHAR(100) NOT NULL, -- matches NOTIFICATION_TEMPLATES keys in the app layer
        subject_override VARCHAR(255),
        body_override TEXT,
        language VARCHAR(10) DEFAULT 'en',
        UNIQUE (organization_id, template_key, language)
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tenant_notification_templates`);
    await queryRunner.query(`DROP TABLE IF EXISTS tenant_catalog_restrictions`);
    await queryRunner.query(`
      ALTER TABLE organizations
        DROP COLUMN IF EXISTS data_retention_tier,
        DROP COLUMN IF EXISTS tax_id,
        DROP COLUMN IF EXISTS payment_method_reference,
        DROP COLUMN IF EXISTS payment_method_type,
        DROP COLUMN IF EXISTS billing_status,
        DROP COLUMN IF EXISTS user_limit,
        DROP COLUMN IF EXISTS device_limit,
        DROP COLUMN IF EXISTS catalog_visibility,
        DROP COLUMN IF EXISTS language_default,
        DROP COLUMN IF EXISTS primary_color
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS public_pages`);
    await queryRunner.query(`DROP TABLE IF EXISTS marketing_assets`);
    await queryRunner.query(`DROP TABLE IF EXISTS faqs`);
    await queryRunner.query(`DROP TABLE IF EXISTS testimonials`);
  }
}
