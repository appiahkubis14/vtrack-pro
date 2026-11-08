import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductCatalogItem } from './entities/product-catalog.entity';
import { ProductCategory } from './entities/product-category.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { ProductFeature } from './entities/product-feature.entity';
import { ProductEntitlement } from './entities/product-entitlement.entity';
import { PricingRule } from './entities/pricing-rule.entity';

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(ProductCatalogItem) private readonly products: Repository<ProductCatalogItem>,
    @InjectRepository(ProductCategory) private readonly categories: Repository<ProductCategory>,
    @InjectRepository(ProductVariant) private readonly variants: Repository<ProductVariant>,
    @InjectRepository(ProductFeature) private readonly features: Repository<ProductFeature>,
    @InjectRepository(ProductEntitlement) private readonly entitlements: Repository<ProductEntitlement>,
    @InjectRepository(PricingRule) private readonly pricingRules: Repository<PricingRule>,
  ) {}

  // ---- Products ----------------------------------------------------

  findAll(query: { categoryId?: string; isActive?: boolean; country?: string } = {}) {
    const qb = this.products.createQueryBuilder('p').where('p.deleted_at IS NULL');
    if (query.categoryId) qb.andWhere('p.category_id = :categoryId', { categoryId: query.categoryId });
    if (query.isActive !== undefined) qb.andWhere('p.is_active = :isActive', { isActive: query.isActive });
    if (query.country) {
      qb.andWhere('(p.available_countries IS NULL OR :country = ANY(p.available_countries))', {
        country: query.country,
      });
    }
    return qb.orderBy('p.display_order', 'ASC').getMany();
  }

  async findOne(id: string) {
    const product = await this.products.findOne({ where: { id }, relations: ['category'] });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return product;
  }

  async findBySlug(slug: string) {
    const product = await this.products.findOne({ where: { slug }, relations: ['category'] });
    if (!product) throw new NotFoundException(`Product "${slug}" not found`);
    return product;
  }

  create(body: Partial<ProductCatalogItem>) {
    return this.products.save(this.products.create(body));
  }

  async update(id: string, body: Partial<ProductCatalogItem>) {
    await this.findOne(id);
    const ok = ['categoryId','name','slug','shortDescription','longDescription','hardwareType','installationRequirements','subscriptionRequired','baseCurrency','isActive','isFeatured','datasheetUrl','displayOrder'];
    const patch: Record<string, unknown> = {};
    for (const k of ok) if ((body as any)[k] !== undefined) patch[k] = (body as any)[k] === '' ? null : (body as any)[k];
    if (Object.keys(patch).length) await this.products.update(id, patch as any);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.products.softDelete(id);
    return { success: true };
  }

  // ---- Categories ----------------------------------------------------

  listCategories() {
    return this.categories.find({ where: { isActive: true }, order: { displayOrder: 'ASC' } });
  }

  createCategory(body: Partial<ProductCategory>) {
    return this.categories.save(this.categories.create(body));
  }

  // ---- Variants & Features ----------------------------------------------------

  listVariants(productId: string) {
    return this.variants.find({ where: { productId, isActive: true }, order: { displayOrder: 'ASC' } });
  }

  createVariant(productId: string, body: Partial<ProductVariant>) {
    return this.variants.save(this.variants.create({ ...body, productId }));
  }

  listFeatures(productId: string) {
    return this.features.find({ where: { productId }, order: { displayOrder: 'ASC' } });
  }

  addFeature(productId: string, body: Partial<ProductFeature>) {
    return this.features.save(this.features.create({ ...body, productId }));
  }

  // ---- Entitlements ----------------------------------------------------

  async getEntitlements(productId: string) {
    await this.findOne(productId);
    return this.entitlements.find({ where: { productId } });
  }

  async setEntitlements(productId: string, entitlements: Array<{ variantId?: string; entitlementKey: string; entitlementValue: unknown }>) {
    await this.findOne(productId);
    // Replace-all semantics for the given (productId, variantId) pairs in the
    // payload - simpler and safer for an admin form than partial patching.
    const saved: ProductEntitlement[] = [];
    for (const e of entitlements) {
      const existing = await this.entitlements.findOne({
        where: { productId, variantId: e.variantId, entitlementKey: e.entitlementKey },
      });
      if (existing) {
        await this.entitlements.update(existing.id, { entitlementValue: e.entitlementValue as any });
        saved.push({ ...existing, entitlementValue: e.entitlementValue as any });
      } else {
        saved.push(
          await this.entitlements.save(
            this.entitlements.create({
              productId,
              variantId: e.variantId,
              entitlementKey: e.entitlementKey,
              entitlementValue: e.entitlementValue as any,
            }),
          ),
        );
      }
    }
    return saved;
  }

  // ---- Pricing ----------------------------------------------------

  listPricing(productId: string) {
    return this.pricingRules.find({ where: { productId }, order: { createdAt: 'DESC' } });
  }

  async setPricing(productId: string, body: Partial<PricingRule>) {
    await this.findOne(productId);
    return this.pricingRules.save(this.pricingRules.create({ ...body, productId }));
  }
}
