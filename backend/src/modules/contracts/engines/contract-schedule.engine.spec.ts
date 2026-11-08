import { allocatePayment, generateSchedule, ScheduleError, summariseArrears } from './contract-schedule.engine';
import { assertTransition, CONTRACT_TRANSITIONS, ContractStatus, CONSIGNMENT_TRANSITIONS, ConsignmentStatus, VEHICLE_TRANSITIONS, VehicleLifecycle } from '../../../common/lifecycle/transitions';
import { cedisToPesewas, pesewasToCedis } from '../../../common/money/money';
import { decryptField, encryptField, maskField } from '../../../common/crypto/field-crypto';

const sum = (xs: { amount: number }[]) => xs.reduce((a, x) => a + x.amount, 0);

describe('generateSchedule', () => {
  it('outright: one installment for the balance on the start date', () => {
    const s = generateSchedule({ mode: 'outright', price: 2_000_000, deposit: 500_000, startDate: '2026-12-01' });
    expect(s).toEqual([{ dueDate: '2026-12-01', amount: 1_500_000 }]);
  });

  it('outright fully paid by the deposit has no installments', () => {
    expect(generateSchedule({ mode: 'outright', price: 100, deposit: 100, startDate: '2026-12-01' })).toEqual([]);
  });

  it('lease: weekly installments add up exactly, remainder on the last', () => {
    const s = generateSchedule({ mode: 'lease', price: 1_000_003, deposit: 100_000, termWeeks: 7, startDate: '2026-12-01' });
    expect(s).toHaveLength(7);
    expect(sum(s)).toBe(900_003);
    expect(s[0].dueDate).toBe('2026-12-08');
    expect(s[6].dueDate).toBe('2027-01-19');
    expect(s[0].amount).toBe(128_571);
    expect(s[6].amount).toBe(128_571 + 6); // 900003 - 7*128571
  });

  it('work-and-pay: daily installments, last one is the remainder', () => {
    const s = generateSchedule({ mode: 'work_and_pay', price: 100_000, deposit: 10_000, termWeeks: 20, dailyAmount: 8_000, startDate: '2026-12-01' });
    expect(s).toHaveLength(12); // ceil(90000 / 8000)
    expect(sum(s)).toBe(90_000);
    expect(s[0].dueDate).toBe('2026-12-02');
    expect(s[11].amount).toBe(2_000);
  });

  it('work-and-pay: refuses a daily amount too small to repay within the term', () => {
    expect(() => generateSchedule({ mode: 'work_and_pay', price: 1_000_000, deposit: 0, termWeeks: 4, dailyAmount: 1_000, startDate: '2026-12-01' })).toThrow(ScheduleError);
  });

  it('rejects a deposit above the price and bad dates', () => {
    expect(() => generateSchedule({ mode: 'outright', price: 100, deposit: 200, startDate: '2026-12-01' })).toThrow(ScheduleError);
    expect(() => generateSchedule({ mode: 'outright', price: 100, deposit: 0, startDate: '01/12/2026' })).toThrow(ScheduleError);
  });
});

describe('payments and arrears', () => {
  const insts = [
    { id: 'a', dueDate: '2026-12-02', amount: 8000, paid: 0 },
    { id: 'b', dueDate: '2026-12-03', amount: 8000, paid: 0 },
    { id: 'c', dueDate: '2026-12-04', amount: 8000, paid: 0 },
  ];

  it('allocates oldest first and reports partial payment', () => {
    const r = allocatePayment(insts, 10000);
    expect(r.updates).toEqual([
      { id: 'a', newPaid: 8000, fullyPaid: true },
      { id: 'b', newPaid: 2000, fullyPaid: false },
    ]);
    expect(r.unallocated).toBe(0);
  });

  it('returns overpayment as unallocated instead of losing it', () => {
    expect(allocatePayment(insts, 30000).unallocated).toBe(6000);
  });

  it('skips already-paid installments', () => {
    const r = allocatePayment([{ ...insts[0], paid: 8000 }, insts[1]], 3000);
    expect(r.updates).toEqual([{ id: 'b', newPaid: 3000, fullyPaid: false }]);
  });

  it('summarises arrears by the oldest unpaid due date', () => {
    const r = summariseArrears(insts, '2026-12-10');
    expect(r.overdueCount).toBe(3);
    expect(r.overdueAmount).toBe(24000);
    expect(r.arrearsDays).toBe(8);
    expect(summariseArrears(insts, '2026-12-02').overdueCount).toBe(0); // due today is not yet overdue
  });
});

describe('lifecycles', () => {
  it('vehicles follow the supply chain and cannot skip steps', () => {
    expect(() => assertTransition('Vehicle', VEHICLE_TRANSITIONS, VehicleLifecycle.ORDERED, VehicleLifecycle.SOLD)).toThrow();
    expect(() => assertTransition('Vehicle', VEHICLE_TRANSITIONS, VehicleLifecycle.IN_STOCK, VehicleLifecycle.SOLD)).not.toThrow();
    expect(() => assertTransition('Vehicle', VEHICLE_TRANSITIONS, VehicleLifecycle.ACTIVE, VehicleLifecycle.LOCKED)).not.toThrow();
    expect(() => assertTransition('Vehicle', VEHICLE_TRANSITIONS, VehicleLifecycle.RETIRED, VehicleLifecycle.ACTIVE)).toThrow();
  });
  it('contracts never repossess straight from active (an admin must default them first)', () => {
    expect(() => assertTransition('Contract', CONTRACT_TRANSITIONS, ContractStatus.ACTIVE, ContractStatus.REPOSSESSED)).toThrow();
    expect(() => assertTransition('Contract', CONTRACT_TRANSITIONS, ContractStatus.DEFAULTED, ContractStatus.REPOSSESSED)).not.toThrow();
    expect(() => assertTransition('Contract', CONTRACT_TRANSITIONS, ContractStatus.DEFAULTED, ContractStatus.ACTIVE)).not.toThrow();
  });
  it('consignments move strictly forward', () => {
    expect(() => assertTransition('Consignment', CONSIGNMENT_TRANSITIONS, ConsignmentStatus.CLEARED, ConsignmentStatus.SHIPPED)).toThrow();
    expect(() => assertTransition('Consignment', CONSIGNMENT_TRANSITIONS, ConsignmentStatus.RECEIVED, ConsignmentStatus.CLOSED)).not.toThrow();
  });
});

describe('money and field encryption', () => {
  it('parses and prints cedis without floating point drift', () => {
    expect(cedisToPesewas('0.10')).toBe(10);
    expect(cedisToPesewas(0.29)).toBe(29); // 0.29 * 100 = 28.999999... in floats
    expect(cedisToPesewas('1234.5')).toBe(123450);
    expect(pesewasToCedis(123450)).toBe('1234.50');
    expect(pesewasToCedis(-5)).toBe('-0.05');
    expect(() => cedisToPesewas('1.234')).toThrow();
    expect(() => cedisToPesewas('abc')).toThrow();
  });
  it('encrypts and decrypts, rejects tampering, and masks', () => {
    const enc = encryptField('GHA-123456789-0');
    expect(enc).not.toContain('123456789');
    expect(decryptField(enc)).toBe('GHA-123456789-0');
    expect(encryptField('same')).not.toBe(encryptField('same')); // fresh IV each time
    const parts = enc.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decryptField(parts.join(':'))).toThrow();
    expect(maskField('GHA-123456789-0')).toBe('***********89-0'.replace('89-0', '89-0'));
  });
});
