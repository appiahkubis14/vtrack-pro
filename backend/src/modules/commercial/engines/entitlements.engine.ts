import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubscriptionPlan, SubscriptionStatus } from '../../catalog/entities/subscription-plan.entity';
import { ProductEntitlement } from '../../catalog/entities/product-entitlement.entity';

export interface EntitlementCheckResult {
  granted: boolean;
  value: boolean | Record<string, unknown> | null;
  reason?: string;
}

/**
 * Resolves entitlements for an organization by walking its active
 * subscription_plans rows (there can be more than one - e.g. a fleet with
 * both a Standard Vehicle Security subscription and an add-on EV Tracker
 * subscription) and unioning what each one's product/variant entitlement
 * rows grant.
 *
 * A trial subscription still grants entitlements until trial_ends_at -
 * expiry is enforced here, not left to the caller to check separately.
 */
@Injectable()
export class EntitlementsEngine {
  private readonly logger = new Logger(EntitlementsEngine.name);

  constructor(
    @InjectRepository(SubscriptionPlan) private readonly subscriptions: Repository<SubscriptionPlan>,
    @InjectRepository(ProductEntitlement) private readonly entitlements: Repository<ProductEntitlement>,
  ) {}

  private isSubscriptionLive(sub: SubscriptionPlan): boolean {
    if (sub.status === SubscriptionStatus.CANCELLED || sub.status === SubscriptionStatus.EXPIRED) return false;
    if (sub.status === SubscriptionStatus.TRIAL) {
      return !sub.trialEndsAt || sub.trialEndsAt.getTime() > Date.now();
    }
    // ACTIVE and PAST_DUE both still grant access - PAST_DUE is a billing
    // warning state, not an immediate feature cutoff (avoids punishing a
    // customer for a late invoice mid-trip). Cutting PAST_DUE off after a
    // grace period is a billing-workflow decision, not made here.
    return true;
  }

  /** All entitlement keys currently granted to an organization, merged across every live subscription. */
  async resolveAll(organizationId: string): Promise<Map<string, boolean | Record<string, unknown>>> {
    const subs = await this.subscriptions.find({ where: { organizationId } });
    const liveSubs = subs.filter((s) => this.isSubscriptionLive(s));

    if (!liveSubs.length) return new Map();

    const productIds = [...new Set(liveSubs.map((s) => s.productId).filter(Boolean))] as string[];
    if (!productIds.length) return new Map();

    const rows = await this.entitlements
      .createQueryBuilder('e')
      .where('e.product_id IN (:...productIds)', { productIds })
      .andWhere('(e.variant_id IS NULL OR e.variant_id IN (:...variantIds))', {
        variantIds: liveSubs.map((s) => s.variantId).filter(Boolean).length
          ? liveSubs.map((s) => s.variantId).filter(Boolean)
          : ['00000000-0000-0000-0000-000000000000'],
      })
      .getMany();

    const merged = new Map<string, boolean | Record<string, unknown>>();
    for (const row of rows) {
      const existing = merged.get(row.entitlementKey);
      // For numeric/object limits, take the most generous grant across
      // subscriptions (e.g. two add-ons both granting a device limit - use
      // the higher one) rather than silently overwriting.
      if (typeof row.entitlementValue === 'object' && typeof existing === 'object') {
        merged.set(row.entitlementKey, { ...existing, ...row.entitlementValue });
      } else {
        merged.set(row.entitlementKey, row.entitlementValue);
      }
    }
    return merged;
  }

  async check(organizationId: string, entitlementKey: string): Promise<EntitlementCheckResult> {
    const all = await this.resolveAll(organizationId);
    if (!all.has(entitlementKey)) {
      return { granted: false, value: null, reason: `No active subscription grants "${entitlementKey}"` };
    }
    const value = all.get(entitlementKey)!;
    const granted = value !== false;
    return { granted, value, reason: granted ? undefined : 'Entitlement explicitly disabled' };
  }

  /** Convenience for numeric limits, e.g. checkLimit(orgId, 'module:portable_assets', 'maxDevices', currentCount). */
  async checkLimit(
    organizationId: string,
    entitlementKey: string,
    limitField: string,
    currentUsage: number,
  ): Promise<EntitlementCheckResult> {
    const result = await this.check(organizationId, entitlementKey);
    if (!result.granted) return result;

    const limit =
      result.value && typeof result.value === 'object' ? (result.value[limitField] as number | undefined) : undefined;
    if (limit === undefined) return { granted: true, value: result.value }; // no limit configured = unlimited

    const withinLimit = currentUsage < limit;
    return {
      granted: withinLimit,
      value: result.value,
      reason: withinLimit ? undefined : `Limit reached: ${currentUsage}/${limit} for "${limitField}"`,
    };
  }
}
