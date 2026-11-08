import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductCatalogItem } from './entities/product-catalog.entity';
import { ProductCategory } from './entities/product-category.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { ProductFeature } from './entities/product-feature.entity';
import { ProductEntitlement } from './entities/product-entitlement.entity';
import { HardwareSku } from './entities/hardware-sku.entity';
import { PricingRule } from './entities/pricing-rule.entity';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { PricingEngine } from './pricing.engine';
import { EntitlementsEngine } from '../commercial/engines/entitlements.engine';
import { EntitlementsGuard } from '../commercial/guards/entitlements.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProductCatalogItem,
      ProductCategory,
      ProductVariant,
      ProductFeature,
      ProductEntitlement,
      HardwareSku,
      PricingRule,
      SubscriptionPlan,
    ]),
  ],
  controllers: [CatalogController],
  providers: [CatalogService, PricingEngine, EntitlementsEngine, EntitlementsGuard],
  exports: [CatalogService, PricingEngine, EntitlementsEngine, EntitlementsGuard],
})
export class CatalogModule {}
