import { Pesewas } from '../../../common/money/money';

/**
 * Daily settlement: how one rider's day of takings is divided.
 * Deduction order (assumption A2, awaiting client confirmation - kept in ONE place so changing it is a one-line edit):
 *   1. charging fee   2. daily remittance (installment / owner share)   3. company service fee   4. remainder = rider's chop money
 * Anything the rider already paid directly (e.g. the 6 PM mobile money debit) counts toward the remittance first,
 * so the same cedi is never collected twice.
 */
export interface SettlementInput {
  grossCollected: Pesewas;
  chargeFeeDue: Pesewas;
  remittanceDue: Pesewas;
  remittancePaidDirect: Pesewas;
  serviceFeeDue: Pesewas;
}

export interface SettlementResult {
  grossCollected: Pesewas;
  chargeFeePaid: Pesewas;
  remittanceFromFares: Pesewas;
  remittanceDirect: Pesewas;
  remittanceTotalPaid: Pesewas;
  serviceFeePaid: Pesewas;
  chop: Pesewas;
  shortfallCharge: Pesewas;
  shortfallRemittance: Pesewas;
  shortfallService: Pesewas;
  shortfallTotal: Pesewas;
  netToOwner: Pesewas;
  /** 'shortfall' only when the remittance is not fully met - that is what starts the grace period. */
  status: 'settled' | 'shortfall';
}

function assertNonNegativeInt(n: number, label: string) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`${label} must be a non-negative integer of pesewas`);
}

export function calculateSettlement(input: SettlementInput): SettlementResult {
  const { grossCollected, chargeFeeDue, remittanceDue, remittancePaidDirect, serviceFeeDue } = input;
  [
    ['grossCollected', grossCollected],
    ['chargeFeeDue', chargeFeeDue],
    ['remittanceDue', remittanceDue],
    ['remittancePaidDirect', remittancePaidDirect],
    ['serviceFeeDue', serviceFeeDue],
  ].forEach(([label, value]) => assertNonNegativeInt(value as number, label as string));

  // Direct payments are capped at what is due: overpayment is not silently absorbed into the remittance.
  const remittanceDirect = Math.min(remittancePaidDirect, remittanceDue);
  const remittanceStillDue = remittanceDue - remittanceDirect;

  let available = grossCollected;

  const chargeFeePaid = Math.min(available, chargeFeeDue);
  available -= chargeFeePaid;

  const remittanceFromFares = Math.min(available, remittanceStillDue);
  available -= remittanceFromFares;

  const serviceFeePaid = Math.min(available, serviceFeeDue);
  available -= serviceFeePaid;

  const chop = available;

  const shortfallCharge = chargeFeeDue - chargeFeePaid;
  const shortfallRemittance = remittanceStillDue - remittanceFromFares;
  const shortfallService = serviceFeeDue - serviceFeePaid;
  const remittanceTotalPaid = remittanceDirect + remittanceFromFares;

  return {
    grossCollected,
    chargeFeePaid,
    remittanceFromFares,
    remittanceDirect,
    remittanceTotalPaid,
    serviceFeePaid,
    chop,
    shortfallCharge,
    shortfallRemittance,
    shortfallService,
    shortfallTotal: shortfallCharge + shortfallRemittance + shortfallService,
    netToOwner: remittanceTotalPaid,
    status: shortfallRemittance > 0 ? 'shortfall' : 'settled',
  };
}
