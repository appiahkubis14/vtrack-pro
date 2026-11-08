/**
 * Money is stored and calculated as whole pesewas (GHS 1.00 = 100 pesewas) - design decision D4.
 * No floating point ever touches a balance.
 */
export type Pesewas = number;

const DECIMAL_RE = /^-?\d+(\.\d{1,2})?$/;

/** Parse "12", "12.5", "12.50" or the number 12.5 into integer pesewas. Rejects more than 2 decimals. */
export function cedisToPesewas(input: number | string): Pesewas {
  const text = typeof input === 'number' ? String(input) : input.trim();
  if (!DECIMAL_RE.test(text)) {
    throw new Error(`Invalid cedi amount "${text}" (up to 2 decimal places allowed)`);
  }
  const negative = text.startsWith('-');
  const [whole, frac = ''] = text.replace('-', '').split('.');
  const value = parseInt(whole, 10) * 100 + parseInt(frac.padEnd(2, '0') || '0', 10);
  if (!Number.isSafeInteger(value)) throw new Error('Amount too large');
  return negative ? -value : value;
}

/** Integer pesewas -> "1234.50" (no currency symbol). */
export function pesewasToCedis(p: Pesewas): string {
  if (!Number.isInteger(p)) throw new Error('Pesewas must be an integer');
  const negative = p < 0;
  const abs = Math.abs(p);
  const out = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return negative ? `-${out}` : out;
}

export function formatGhs(p: Pesewas): string {
  return `GHS ${pesewasToCedis(p)}`;
}

export function assertPesewas(value: unknown, label: string, opts: { min?: number } = {}): Pesewas {
  const min = opts.min ?? 0;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw new Error(`${label} must be an integer number of pesewas >= ${min}`);
  }
  return value;
}

/** TypeORM transformer: Postgres returns bigint as string; we keep them as JS integers (safe to 9e15 pesewas). */
export const pesewasTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | number | null) => (v === null || v === undefined ? v : Number(v)),
};
