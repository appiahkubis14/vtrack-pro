import { Pesewas } from '../../../common/money/money';

export type ContractMode = 'outright' | 'lease' | 'work_and_pay';

export interface ScheduleInput {
  mode: ContractMode;
  price: Pesewas;
  deposit: Pesewas;
  /** Lease: number of weekly installments. Work-and-Pay: the longest the rider may take (weeks). */
  termWeeks?: number;
  /** Work-and-Pay: the fixed daily amount. */
  dailyAmount?: Pesewas;
  startDate: string; // YYYY-MM-DD
}

export interface ScheduledInstallment {
  dueDate: string; // YYYY-MM-DD
  amount: Pesewas;
}

export class ScheduleError extends Error {}

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Builds the installment schedule for a contract. The balance is always (price - deposit); the final
 * installment absorbs any rounding remainder so the schedule adds up to the balance exactly.
 */
export function generateSchedule(input: ScheduleInput): ScheduledInstallment[] {
  const { mode, price, deposit, termWeeks, dailyAmount, startDate } = input;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new ScheduleError('startDate must be YYYY-MM-DD');
  if (!Number.isInteger(price) || price <= 0) throw new ScheduleError('Price must be a positive integer of pesewas');
  if (!Number.isInteger(deposit) || deposit < 0) throw new ScheduleError('Deposit must be a non-negative integer of pesewas');
  if (deposit > price) throw new ScheduleError('Deposit cannot exceed the price');

  const balance = price - deposit;
  if (balance === 0) return [];

  if (mode === 'outright') {
    return [{ dueDate: startDate, amount: balance }];
  }

  if (mode === 'lease') {
    if (!termWeeks || !Number.isInteger(termWeeks) || termWeeks < 1) throw new ScheduleError('A lease needs termWeeks >= 1');
    const base = Math.floor(balance / termWeeks);
    const out: ScheduledInstallment[] = [];
    for (let i = 1; i <= termWeeks; i++) {
      out.push({ dueDate: addDays(startDate, 7 * i), amount: base });
    }
    out[out.length - 1].amount += balance - base * termWeeks;
    return out;
  }

  // work_and_pay
  if (!dailyAmount || !Number.isInteger(dailyAmount) || dailyAmount <= 0) {
    throw new ScheduleError('Work-and-Pay needs a positive daily amount');
  }
  if (!termWeeks || !Number.isInteger(termWeeks) || termWeeks < 1) throw new ScheduleError('Work-and-Pay needs termWeeks >= 1');
  const days = Math.ceil(balance / dailyAmount);
  if (days > termWeeks * 7) {
    throw new ScheduleError(
      `A daily amount of ${dailyAmount} pesewas needs ${days} days, which is longer than the ${termWeeks * 7}-day term`,
    );
  }
  const out: ScheduledInstallment[] = [];
  let remaining = balance;
  for (let i = 1; i <= days; i++) {
    const amount = Math.min(dailyAmount, remaining);
    out.push({ dueDate: addDays(startDate, i), amount });
    remaining -= amount;
  }
  return out;
}

export interface InstallmentState {
  id: string;
  dueDate: string;
  amount: Pesewas;
  paid: Pesewas;
}

export interface AllocationResult {
  /** installments touched, with their new paid total */
  updates: { id: string; newPaid: Pesewas; fullyPaid: boolean }[];
  /** money left over after every installment is paid */
  unallocated: Pesewas;
}

/** Applies a payment to the oldest unpaid installments first. */
export function allocatePayment(installments: InstallmentState[], amount: Pesewas): AllocationResult {
  if (!Number.isInteger(amount) || amount <= 0) throw new ScheduleError('Payment must be a positive integer of pesewas');
  const ordered = [...installments].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  let remaining = amount;
  const updates: AllocationResult['updates'] = [];
  for (const inst of ordered) {
    if (remaining === 0) break;
    const owed = inst.amount - inst.paid;
    if (owed <= 0) continue;
    const apply = Math.min(owed, remaining);
    updates.push({ id: inst.id, newPaid: inst.paid + apply, fullyPaid: apply === owed });
    remaining -= apply;
  }
  return { updates, unallocated: remaining };
}

export interface ArrearsSummary {
  overdueAmount: Pesewas;
  overdueCount: number;
  /** days since the oldest unpaid installment fell due (0 when nothing is overdue) */
  arrearsDays: number;
}

export function summariseArrears(installments: InstallmentState[], asOf: string): ArrearsSummary {
  const overdue = installments.filter((i) => i.dueDate < asOf && i.amount - i.paid > 0);
  if (overdue.length === 0) return { overdueAmount: 0, overdueCount: 0, arrearsDays: 0 };
  const oldest = overdue.map((i) => i.dueDate).sort()[0];
  const ms = Date.parse(asOf) - Date.parse(oldest);
  return {
    overdueAmount: overdue.reduce((sum, i) => sum + (i.amount - i.paid), 0),
    overdueCount: overdue.length,
    arrearsDays: Math.max(0, Math.round(ms / 86_400_000)),
  };
}
