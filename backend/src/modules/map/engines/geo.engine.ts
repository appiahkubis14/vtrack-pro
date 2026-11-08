import { haversineDistanceMeters } from '../../../helpers/geo.helper';

export const bearingDeg = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = Math.PI / 180, y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r), x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
};
export const angleDiff = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Shortest distance in metres from a point to a polyline of [lng, lat] pairs (small-area flat-earth projection, fine for routes). */
export function distanceToLine(p: { lat: number; lng: number }, line: [number, number][]): number {
  if (!line.length) return Infinity;
  if (line.length === 1) return haversineDistanceMeters(p.lat, p.lng, line[0][1], line[0][0]);
  const kx = 111320 * Math.cos((p.lat * Math.PI) / 180), ky = 110540;
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const ax = (line[i][0] - p.lng) * kx, ay = (line[i][1] - p.lat) * ky, bx = (line[i + 1][0] - p.lng) * kx, by = (line[i + 1][1] - p.lat) * ky;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const d = Math.hypot(ax + t * dx, ay + t * dy); if (d < best) best = d;
  }
  return best;
}

/** Keeps at most `max` evenly spaced points (always the first and last). */
export function thin<T>(pts: T[], max: number): T[] {
  if (pts.length <= max) return pts;
  const out: T[] = []; const step = (pts.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(pts[Math.round(i * step)]);
  return out;
}

/** True when `at` falls inside the vehicle's working hours (days, start and end are in its own time zone). */
export function isWorkTime(cfg: { timezone: string; work_days: number[]; start_time: string; end_time: string }, at: Date): boolean {
  let parts: Record<string, string>;
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: cfg.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at).map((p) => [p.type, p.value]));
  } catch { return true; } // an unknown time zone must not hide a vehicle forever; the API validates it on save
  const dayNo = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[parts.weekday as string] ?? 1;
  if (!cfg.work_days.includes(dayNo)) return false;
  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  const toMin = (t: string) => { const [h, m] = t.split(':'); return Number(h) * 60 + Number(m); };
  const s = toMin(cfg.start_time), e = toMin(cfg.end_time);
  return s <= e ? mins >= s && mins < e : mins >= s || mins < e; // overnight shifts
}
