import { calculateSettlement } from './settlement.engine';
import { assertBalanced, buildSettlementPostings, reverse, UnbalancedTransactionError } from './ledger.engine';
import { collectionRate, outstandingBalance, paybackWeeks } from './payback.engine';

describe('calculateSettlement', () => {
  const base = { grossCollected: 30000, chargeFeeDue: 2500, remittanceDue: 8000, remittancePaidDirect: 0, serviceFeeDue: 1000 };

  it('matches the worked example: 300 - 25 - 80 - 10 = 185 chop', () => {
    const r = calculateSettlement(base);
    expect(r.chargeFeePaid).toBe(2500);
    expect(r.remittanceFromFares).toBe(8000);
    expect(r.serviceFeePaid).toBe(1000);
    expect(r.chop).toBe(18500);
    expect(r.shortfallTotal).toBe(0);
    expect(r.status).toBe('settled');
    expect(r.netToOwner).toBe(8000);
  });

  it('takes deductions in order and reports a remittance shortfall when fares run out', () => {
    const r = calculateSettlement({ ...base, grossCollected: 5000 });
    expect(r.chargeFeePaid).toBe(2500); // charging first
    expect(r.remittanceFromFares).toBe(2500); // then what is left goes to remittance
    expect(r.serviceFeePaid).toBe(0);
    expect(r.chop).toBe(0);
    expect(r.shortfallRemittance).toBe(5500);
    expect(r.shortfallService).toBe(1000);
    expect(r.status).toBe('shortfall');
  });

  it('counts a direct 6 PM payment toward the remittance so nothing is collected twice', () => {
    const r = calculateSettlement({ ...base, remittancePaidDirect: 8000 });
    expect(r.remittanceDirect).toBe(8000);
    expect(r.remittanceFromFares).toBe(0);
    expect(r.chop).toBe(26500); // 300 - 25 - 10
    expect(r.status).toBe('settled');
    expect(r.netToOwner).toBe(8000);
  });

  it('caps a direct payment at the amount due', () => {
    const r = calculateSettlement({ ...base, remittancePaidDirect: 12000 });
    expect(r.remittanceDirect).toBe(8000);
  });

  it('a charge-fee or service-fee shortfall alone does not trigger the lock status', () => {
    const r = calculateSettlement({ grossCollected: 8000, chargeFeeDue: 2500, remittanceDue: 0, remittancePaidDirect: 0, serviceFeeDue: 1000 });
    expect(r.status).toBe('settled');
    expect(r.shortfallCharge).toBe(0);
    expect(r.shortfallService).toBe(0);
  });

  it('rejects negative or fractional pesewas', () => {
    expect(() => calculateSettlement({ ...base, grossCollected: -1 })).toThrow();
    expect(() => calculateSettlement({ ...base, grossCollected: 10.5 })).toThrow();
  });

  it('conserves money for 2000 random days: every pesewa collected is assigned somewhere', () => {
    let seed = 42;
    const rnd = (max: number) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return Math.floor((seed / 4294967296) * (max + 1));
    };
    for (let i = 0; i < 2000; i++) {
      const input = {
        grossCollected: rnd(60000),
        chargeFeeDue: rnd(5000),
        remittanceDue: rnd(15000),
        remittancePaidDirect: rnd(15000),
        serviceFeeDue: rnd(3000),
      };
      const r = calculateSettlement(input);
      expect(r.chargeFeePaid + r.remittanceFromFares + r.serviceFeePaid + r.chop).toBe(input.grossCollected);
      expect(r.chop).toBeGreaterThanOrEqual(0);
      expect(r.chargeFeePaid + r.shortfallCharge).toBe(input.chargeFeeDue);
      expect(r.serviceFeePaid + r.shortfallService).toBe(input.serviceFeeDue);
      expect(r.remittanceTotalPaid + r.shortfallRemittance).toBe(input.remittanceDue);
    }
  });
});

describe('ledger postings', () => {
  const ids = { hubId: 'h1', riderId: 'r1', ownerId: 'o1' };

  it('builds balanced lines for a full settlement', () => {
    const s = calculateSettlement({ grossCollected: 30000, chargeFeeDue: 2500, remittanceDue: 8000, remittancePaidDirect: 3000, serviceFeeDue: 1000 });
    const lines = buildSettlementPostings({ ...ids, ...s });
    expect(() => assertBalanced(lines)).not.toThrow();
    // the owner is credited with the full remittance, from fares and from the direct payment
    const ownerCredit = lines.filter((l) => l.account.ownerType === 'owner' && l.direction === 'credit').reduce((a, l) => a + l.amount, 0);
    expect(ownerCredit).toBe(8000);
  });

  it('routes the remittance to the company holding account when no owner is linked', () => {
    const s = calculateSettlement({ grossCollected: 10000, chargeFeeDue: 0, remittanceDue: 4000, remittancePaidDirect: 0, serviceFeeDue: 0 });
    const lines = buildSettlementPostings({ ...ids, ownerId: null, ...s });
    expect(lines.some((l) => l.account.ownerType === 'company' && l.account.code === 'owner_account')).toBe(true);
    expect(() => assertBalanced(lines)).not.toThrow();
  });

  it('every random settlement posts a balanced transaction', () => {
    for (let g = 0; g <= 40000; g += 2750) {
      const s = calculateSettlement({ grossCollected: g, chargeFeeDue: 2500, remittanceDue: 8000, remittancePaidDirect: g % 3 === 0 ? 8000 : 0, serviceFeeDue: 1000 });
      const lines = buildSettlementPostings({ ...ids, ...s });
      if (lines.length >= 2) expect(() => assertBalanced(lines)).not.toThrow();
    }
  });

  it('rejects an unbalanced transaction and single-line or non-positive postings', () => {
    const acct = { code: 'x', ownerType: 'company' as const, ownerId: null };
    expect(() => assertBalanced([{ account: acct, direction: 'debit', amount: 100 }, { account: acct, direction: 'credit', amount: 90 }])).toThrow(UnbalancedTransactionError);
    expect(() => assertBalanced([{ account: acct, direction: 'debit', amount: 100 }])).toThrow();
    expect(() => assertBalanced([{ account: acct, direction: 'debit', amount: 0 }, { account: acct, direction: 'credit', amount: 0 }])).toThrow();
  });

  it('a reversal cancels the original exactly', () => {
    const s = calculateSettlement({ grossCollected: 30000, chargeFeeDue: 2500, remittanceDue: 8000, remittancePaidDirect: 0, serviceFeeDue: 1000 });
    const lines = buildSettlementPostings({ ...ids, ...s });
    const net = (ls: typeof lines) => {
      const m = new Map<string, number>();
      for (const l of ls) {
        const k = `${l.account.code}|${l.account.ownerType}|${l.account.ownerId}`;
        m.set(k, (m.get(k) ?? 0) + (l.direction === 'debit' ? l.amount : -l.amount));
      }
      return m;
    };
    const combined = net([...lines, ...reverse(lines)]);
    for (const v of combined.values()) expect(v).toBe(0);
  });
});

describe('payback metrics', () => {
  it('outstanding balance never goes negative', () => {
    expect(outstandingBalance(1_000_000, 200_000, 300_000)).toBe(500_000);
    expect(outstandingBalance(1_000_000, 200_000, 900_000)).toBe(0);
  });
  it('payback weeks', () => {
    expect(paybackWeeks(1_200_000, 40_000)).toBe(30);
    expect(paybackWeeks(1_200_000, 0)).toBeNull();
  });
  it('collection rate', () => {
    expect(collectionRate(8000, 10000)).toBe(80);
    expect(collectionRate(12000, 10000)).toBe(100);
    expect(collectionRate(0, 0)).toBe(100);
  });
});
