import { Request } from 'express';
import { Role } from '../constants/roles.constant';

export interface AuthUser {
  sub: string;
  email: string;
  organizationId: string;
  role: Role;
}

export const ADMIN_ROLES: Role[] = [Role.SUPER_ADMIN, Role.ORG_ADMIN];
export const FINANCE_ROLES: Role[] = [...ADMIN_ROLES, Role.FINANCE];
/** People who run day-to-day operations. Hub managers are further limited to their own hub by DataScopeService. */
export const OPS_ROLES: Role[] = [...ADMIN_ROLES, Role.FLEET_MANAGER, Role.HUB_MANAGER];
/** Everyone who may read business data (investors see only their own via DataScopeService). */
export const READ_ROLES: Role[] = [...OPS_ROLES, Role.FINANCE, Role.AUDITOR, Role.DISPATCHER, Role.INVESTOR];

export function currentUser(req: Request): AuthUser {
  const u = req.user as AuthUser | undefined;
  if (!u?.organizationId) throw new Error('Authenticated user has no organization');
  return u;
}
