import { SetMetadata } from '@nestjs/common';

export const REQUIRES_ENTITLEMENT_KEY = 'requires_entitlement';

/**
 * Gate a route behind a product entitlement, e.g.:
 *   @RequiresEntitlement('module:portable_assets')
 *   @Post('portable-assets')
 *   create(...) { ... }
 *
 * Pair with EntitlementsGuard (applied globally or per-controller).
 */
export const RequiresEntitlement = (entitlementKey: string) => SetMetadata(REQUIRES_ENTITLEMENT_KEY, entitlementKey);
