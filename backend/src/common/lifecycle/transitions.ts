import { BadRequestException } from '@nestjs/common';

/** A lifecycle is a map: state -> states it may move to. Anything else is rejected. */
export type TransitionTable<S extends string> = Record<S, readonly S[]>;

export function canTransition<S extends string>(table: TransitionTable<S>, from: S, to: S): boolean {
  return (table[from] ?? []).includes(to);
}

export function assertTransition<S extends string>(label: string, table: TransitionTable<S>, from: S, to: S): void {
  if (from === to) return; // same-state writes are a no-op, never an error
  if (!canTransition(table, from, to)) {
    throw new BadRequestException(
      `${label}: cannot move from "${from}" to "${to}". Allowed from "${from}": ${(table[from] ?? []).join(', ') || 'none'}`,
    );
  }
}

export enum VehicleLifecycle {
  ORDERED = 'ordered',
  IN_TRANSIT = 'in_transit',
  AT_PORT = 'at_port',
  CLEARED = 'cleared',
  IN_STOCK = 'in_stock',
  SOLD = 'sold',
  ASSIGNED = 'assigned',
  ACTIVE = 'active',
  LOCKED = 'locked',
  MAINTENANCE = 'maintenance',
  RETURNED = 'returned',
  STOLEN = 'stolen',
  RETIRED = 'retired',
}
export const VEHICLE_TRANSITIONS: TransitionTable<VehicleLifecycle> = {
  [VehicleLifecycle.ORDERED]: [VehicleLifecycle.IN_TRANSIT],
  [VehicleLifecycle.IN_TRANSIT]: [VehicleLifecycle.AT_PORT],
  [VehicleLifecycle.AT_PORT]: [VehicleLifecycle.CLEARED],
  [VehicleLifecycle.CLEARED]: [VehicleLifecycle.IN_STOCK],
  [VehicleLifecycle.IN_STOCK]: [VehicleLifecycle.SOLD, VehicleLifecycle.RETIRED],
  [VehicleLifecycle.SOLD]: [VehicleLifecycle.ASSIGNED, VehicleLifecycle.RETURNED],
  [VehicleLifecycle.ASSIGNED]: [VehicleLifecycle.ACTIVE, VehicleLifecycle.SOLD, VehicleLifecycle.RETURNED],
  [VehicleLifecycle.ACTIVE]: [VehicleLifecycle.LOCKED, VehicleLifecycle.MAINTENANCE, VehicleLifecycle.RETURNED, VehicleLifecycle.STOLEN, VehicleLifecycle.ASSIGNED],
  [VehicleLifecycle.LOCKED]: [VehicleLifecycle.ACTIVE, VehicleLifecycle.STOLEN, VehicleLifecycle.RETURNED],
  [VehicleLifecycle.MAINTENANCE]: [VehicleLifecycle.ACTIVE, VehicleLifecycle.RETIRED],
  [VehicleLifecycle.RETURNED]: [VehicleLifecycle.IN_STOCK, VehicleLifecycle.RETIRED],
  [VehicleLifecycle.STOLEN]: [VehicleLifecycle.ACTIVE, VehicleLifecycle.RETURNED, VehicleLifecycle.RETIRED],
  [VehicleLifecycle.RETIRED]: [],
};

export enum ContractStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  DEFAULTED = 'defaulted',
  REPOSSESSED = 'repossessed',
  CANCELLED = 'cancelled',
}
export const CONTRACT_TRANSITIONS: TransitionTable<ContractStatus> = {
  [ContractStatus.DRAFT]: [ContractStatus.ACTIVE, ContractStatus.CANCELLED],
  [ContractStatus.ACTIVE]: [ContractStatus.COMPLETED, ContractStatus.DEFAULTED, ContractStatus.CANCELLED],
  [ContractStatus.DEFAULTED]: [ContractStatus.ACTIVE, ContractStatus.REPOSSESSED],
  [ContractStatus.COMPLETED]: [],
  [ContractStatus.REPOSSESSED]: [],
  [ContractStatus.CANCELLED]: [],
};

export enum ConsignmentStatus {
  ORDERED = 'ordered',
  SHIPPED = 'shipped',
  AT_PORT = 'at_port',
  CLEARED = 'cleared',
  RECEIVED = 'received',
  CLOSED = 'closed',
}
export const CONSIGNMENT_TRANSITIONS: TransitionTable<ConsignmentStatus> = {
  [ConsignmentStatus.ORDERED]: [ConsignmentStatus.SHIPPED],
  [ConsignmentStatus.SHIPPED]: [ConsignmentStatus.AT_PORT],
  [ConsignmentStatus.AT_PORT]: [ConsignmentStatus.CLEARED],
  [ConsignmentStatus.CLEARED]: [ConsignmentStatus.RECEIVED],
  [ConsignmentStatus.RECEIVED]: [ConsignmentStatus.CLOSED],
  [ConsignmentStatus.CLOSED]: [],
};
