import { BadRequestException } from '@nestjs/common';

/** Ghana is on GMT all year (no daylight saving), so "today" in Accra is today in UTC. */
export function todayAccra(): string {
  return new Date().toISOString().slice(0, 10);
}

export function assertIsoDate(value: unknown, label = 'date'): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new BadRequestException(`${label} must be a valid date in YYYY-MM-DD format`);
  }
  return value;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Monday..Sunday week containing the date. */
export function weekRange(anchor: string): { from: string; to: string } {
  const dow = (new Date(`${anchor}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const from = addDays(anchor, -dow);
  return { from, to: addDays(from, 6) };
}

export function monthRange(anchor: string): { from: string; to: string } {
  const [y, m] = anchor.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from, to };
}
