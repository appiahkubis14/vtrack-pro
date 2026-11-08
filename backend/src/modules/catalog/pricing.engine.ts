import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PricingRule } from './entities/pricing-rule.entity';

@Injectable()
export class PricingEngine {
  constructor(@InjectRepository(PricingRule) private readonly pricingRules: Repository<PricingRule>) {}

  /**
   * Resolves the active price for a product/variant in a given currency.
   * Preference order: tenant-specific negotiated price (organizationId set)
   * > public default price (organizationId NULL). Both are filtered to
   * currently-valid rows (valid_from/valid_until window, is_active).
   */
  async resolvePrice(
    productId: string,
    variantId: string | null,
    currency: string,
    organizationId?: string,
  ): Promise<PricingRule> {
    const now = new Date();
    const baseQuery = this.pricingRules
      .createQueryBuilder('p')
      .where('p.product_id = :productId', { productId })
      .andWhere('p.currency = :currency', { currency })
      .andWhere('p.is_active = true')
      .andWhere('p.valid_from <= :now', { now })
      .andWhere('(p.valid_until IS NULL OR p.valid_until >= :now)', { now });

    if (variantId) {
      baseQuery.andWhere('(p.variant_id = :variantId OR p.variant_id IS NULL)', { variantId });
    } else {
      baseQuery.andWhere('p.variant_id IS NULL');
    }

    if (organizationId) {
      const tenantPrice = await baseQuery
        .clone()
        .andWhere('p.organization_id = :organizationId', { organizationId })
        .orderBy('p.variant_id', 'DESC', 'NULLS LAST') // prefer variant-specific over product-wide
        .getOne();
      if (tenantPrice) return tenantPrice;
    }

    const publicPrice = await baseQuery
      .clone()
      .andWhere('p.organization_id IS NULL')
      .orderBy('p.variant_id', 'DESC', 'NULLS LAST')
      .getOne();

    if (!publicPrice) {
      throw new NotFoundException(
        `No active pricing found for product ${productId}${variantId ? `/variant ${variantId}` : ''} in ${currency}`,
      );
    }
    return publicPrice;
  }

  /**
   * Full line-item cost for N units: hardware (one-time, per unit) +
   * installation (one-time, per unit) + subscription (recurring, billing
   * cycle determines monthly vs annual) + SIM/data fee (recurring).
   */
  computeLineCost(
    price: PricingRule,
    quantity: number,
    billingCycle: 'monthly' | 'annual',
    includeInstallation: boolean,
  ) {
    const subscriptionPrice =
      billingCycle === 'annual' ? Number(price.annualSubscriptionPrice) : Number(price.monthlySubscriptionPrice);

    const hardwareTotal = Number(price.hardwarePrice) * quantity;
    const installationTotal = includeInstallation ? Number(price.installationFee) * quantity : 0;
    const subscriptionTotal = subscriptionPrice * quantity;
    const simTotal = Number(price.simDataFee) * quantity;

    return {
      hardwareTotal: round2(hardwareTotal),
      installationTotal: round2(installationTotal),
      subscriptionTotal: round2(subscriptionTotal),
      simTotal: round2(simTotal),
      lineTotal: round2(hardwareTotal + installationTotal + subscriptionTotal + simTotal),
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
