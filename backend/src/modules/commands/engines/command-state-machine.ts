import { CommandStatus } from '../../../common/constants/alerts.constant';

/**
 * Valid transitions per the v2 spec's command lifecycle. High-risk commands
 * (immobilizer, fuel cutoff, EV charge control) route through
 * created -> approved before ever reaching the queue; low-risk commands
 * (request location, change reporting interval) can skip straight from
 * created -> queued - see CommandsService.dispatch()'s `requiresApproval` check.
 */
const TRANSITIONS: Record<CommandStatus, CommandStatus[]> = {
  [CommandStatus.CREATED]: [CommandStatus.APPROVED, CommandStatus.QUEUED, CommandStatus.CANCELLED],
  [CommandStatus.APPROVED]: [CommandStatus.QUEUED, CommandStatus.CANCELLED],
  [CommandStatus.PENDING]: [CommandStatus.QUEUED, CommandStatus.CANCELLED], // v1 alias
  [CommandStatus.QUEUED]: [CommandStatus.WAITING_FOR_DEVICE, CommandStatus.SENT, CommandStatus.CANCELLED],
  [CommandStatus.WAITING_FOR_DEVICE]: [CommandStatus.SENT, CommandStatus.TIMEOUT, CommandStatus.CANCELLED],
  [CommandStatus.SENT]: [CommandStatus.DELIVERED, CommandStatus.TIMEOUT, CommandStatus.FAILED],
  [CommandStatus.DELIVERED]: [CommandStatus.ACKNOWLEDGED, CommandStatus.TIMEOUT, CommandStatus.FAILED],
  [CommandStatus.ACKNOWLEDGED]: [CommandStatus.EXECUTED, CommandStatus.FAILED],
  [CommandStatus.EXECUTED]: [],
  [CommandStatus.FAILED]: [CommandStatus.QUEUED], // retry re-enters the queue
  [CommandStatus.TIMEOUT]: [CommandStatus.WAITING_FOR_DEVICE, CommandStatus.QUEUED, CommandStatus.CANCELLED], // SMS wake-up retry path
  [CommandStatus.CANCELLED]: [],
};

export class InvalidCommandTransitionError extends Error {
  constructor(from: CommandStatus, to: CommandStatus) {
    super(`Invalid command state transition: ${from} -> ${to}`);
  }
}

export function canTransition(from: CommandStatus, to: CommandStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: CommandStatus, to: CommandStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidCommandTransitionError(from, to);
  }
}

export const TERMINAL_STATES: CommandStatus[] = [
  CommandStatus.EXECUTED,
  CommandStatus.CANCELLED,
];

export function isTerminal(status: CommandStatus): boolean {
  return TERMINAL_STATES.includes(status);
}
