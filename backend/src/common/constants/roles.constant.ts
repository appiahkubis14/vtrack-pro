export enum Role {
  SUPER_ADMIN = 'super_admin',
  ORG_ADMIN = 'org_admin',
  FLEET_MANAGER = 'fleet_manager',
  DISPATCHER = 'dispatcher',
  DRIVER = 'driver',
  VIEWER = 'viewer',
  // business layer
  HUB_MANAGER = 'hub_manager',
  FINANCE = 'finance',
  INVESTOR = 'investor',
  RIDER = 'rider',
  AUDITOR = 'auditor',
  /** Internal accounts that attribute automatic actions (e.g. an automatic safe lock). Cannot log in. */
  SYSTEM = 'system',
}

export const ROLES_KEY = 'roles';
