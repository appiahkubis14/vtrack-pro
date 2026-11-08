import { SetMetadata } from '@nestjs/common';

export const AUDIT_METADATA_KEY = 'audit_metadata';

export interface AuditOptions {
  action: string; // e.g. 'device.update', 'user.role_change'
  resourceType: string; // e.g. 'Device', 'User'
}

/**
 * Tag a controller method for automatic audit logging. Pair with
 * AuditInterceptor (not yet built - register it globally in main.ts once
 * added) which reads this metadata + the request/response to write an
 * AuditLog row with old/new values, IP, and user agent.
 *
 * @example
 *   @Audit({ action: 'device.update', resourceType: 'Device' })
 *   @Put(':id')
 *   update(...) { ... }
 */
export const Audit = (options: AuditOptions) => SetMetadata(AUDIT_METADATA_KEY, options);
