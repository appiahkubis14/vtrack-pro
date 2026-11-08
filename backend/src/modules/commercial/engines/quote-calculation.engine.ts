import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PricingEngine } from '../../catalog/pricing.engine';
import { ProductCatalogItem } from '../../catalog/entities/product-catalog.entity';
import { Discount, DiscountType } from '../entities/discount.entity';
import { Tax } from '../entities/tax.entity';

export interface QuoteLineInput {
  productId: string;
  variantId?: string;
  quantity: number;
  includeInstallation: boolean;
  billingCycle: 'monthly' | 'annual';
  discountCode?: string;
}

export interface QuoteLineResult {
  productId: string;
  variantId?: string;
  productName: string;
  quantity: number;
  unitHardwarePrice: number;
  unitInstallationPrice: number;
  unitSubscriptionPrice: number;
  unitSimPrice: number;
  lineSubtotal: number;
  lineDiscountAmount: number;
  lineTaxAmount: number;
  lineTotal: number;
}

export interface QuoteCalculationResult {
  currency: string;
  lines: QuoteLineResult[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  grandTotal: number;
}

@Injectable()
export class QuoteCalculationEngine {
  constructor(
    private readonly pricingEngine: PricingEngine,
    @InjectRepository(ProductCatalogItem) private readonly products: Repository<ProductCatalogItem>,
    @InjectRepository(Discount) private readonly discounts: Repository<Discount>,
    @InjectRepository(Tax) private readonly taxes: Repository<Tax>,
  ) {}

  async calculate(
    lines: QuoteLineInput[],
    currency: string,
    organizationId: string | undefined,
    country: string | undefined,
  ): Promise<QuoteCalculationResult> {
    const results: QuoteLineResult[] = [];
    const applicableTaxes = await this.resolveTaxes(country, organizationId);
    const taxRate = applicableTaxes.reduce((sum, t) => sum + Number(t.ratePercent), 0) / 100;

    for (const line of lines) {
      const product = await this.products.findOneOrFail({ where: { id: line.productId } });
      const price = await this.pricingEngine.resolvePrice(line.productId, line.variantId ?? null, currency, organizationId);
      const costs = this.pricingEngine.computeLineCost(price, line.quantity, line.billingCycle, line.includeInstallation);

      let discountAmount = 0;
      if (line.discountCode) {
        discountAmount = await this.applyDiscount(line.discountCode, line.productId, line.quantity, costs.lineTotal);
      }

      const afterDiscount = Math.max(0, costs.lineTotal - discountAmount);
      const lineTax = round2(afterDiscount * taxRate);

      results.push({
        productId: line.productId,
        variantId: line.variantId,
        productName: product.name,
        quantity: line.quantity,
        unitHardwarePrice: Number(price.hardwarePrice),
        unitInstallationPrice: line.includeInstallation ? Number(price.installationFee) : 0,
        unitSubscriptionPrice:
          line.billingCycle === 'annual' ? Number(price.annualSubscriptionPrice) : Number(price.monthlySubscriptionPrice),
        unitSimPrice: Number(price.simDataFee),
        lineSubtotal: costs.lineTotal,
        lineDiscountAmount: discountAmount,
        lineTaxAmount: lineTax,
        lineTotal: round2(afterDiscount + lineTax),
      });
    }

    const subtotal = round2(results.reduce((s, r) => s + r.lineSubtotal, 0));
    const discountTotal = round2(results.reduce((s, r) => s + r.lineDiscountAmount, 0));
    const taxTotal = round2(results.reduce((s, r) => s + r.lineTaxAmount, 0));
    const grandTotal = round2(results.reduce((s, r) => s + r.lineTotal, 0));

    return { currency, lines: results, subtotal, discountTotal, taxTotal, grandTotal };
  }

  private async resolveTaxes(country: string | undefined, organizationId: string | undefined): Promise<Tax[]> {
    const qb = this.taxes.createQueryBuilder('t').where('t.is_active = true');
    if (organizationId) {
      qb.andWhere('(t.organization_id = :organizationId OR t.organization_id IS NULL)', { organizationId });
    } else {
      qb.andWhere('t.organization_id IS NULL');
    }
    if (country) qb.andWhere('(t.country = :country OR t.country IS NULL)', { country });
    return qb.getMany();
  }

  private async applyDiscount(code: string, productId: string, quantity: number, lineTotal: number): Promise<number> {
    const discount = await this.discounts.findOne({ where: { code, isActive: true } });
    if (!discount) return 0;

    const now = new Date();
    if (discount.startsAt && discount.startsAt > now) return 0;
    if (discount.endsAt && discount.endsAt < now) return 0;
    if (discount.maxRedemptions && discount.redemptionCount >= discount.maxRedemptions) return 0;
    if (discount.appliesToProductId && discount.appliesToProductId !== productId) return 0;
    if (discount.discountType === DiscountType.VOLUME_TIER && discount.minQuantity && quantity < discount.minQuantity) {
      return 0;
    }

    if (discount.discountType === DiscountType.FIXED_AMOUNT) {
      return Math.min(Number(discount.discountValue), lineTotal);
    }
    // PERCENTAGE and VOLUME_TIER both apply as a percentage-off in this model.
    return round2(lineTotal * (Number(discount.discountValue) / 100));
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
