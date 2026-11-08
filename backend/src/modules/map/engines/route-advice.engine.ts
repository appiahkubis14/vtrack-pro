/** Multi-objective route choice with the reasoning in words. Deterministic scoring, not machine learning. */

export interface Profile { electric: boolean; kwhPerKm: number; litresPerKm: number; fuel: 'petrol' | 'diesel' | null }
export interface Candidate { index: number; distanceM: number; durationS: number; geometry?: [number, number][] }
export interface Scored extends Candidate {
  minutes: number; km: number; energyKwh: number | null; fuelLitres: number | null; co2Kg: number; feasible: boolean | null; score: number; label: string;
}

const GRID_KG_PER_KWH = Number(process.env.GRID_CO2_KG_PER_KWH ?? 0.4);
const CO2_PER_LITRE = { petrol: 2.31, diesel: 2.68 };

/** Typical consumption by vehicle type; electric unless the vehicle's fuel type says petrol or diesel. */
export function profileFor(vehicleType?: string | null, icon?: string | null, fuelType?: string | null): Profile {
  const t = `${vehicleType ?? ''} ${icon ?? ''}`.toLowerCase();
  const fuel: Profile['fuel'] = /diesel/i.test(fuelType ?? '') ? 'diesel' : /petrol|gasoline|gas\b/i.test(fuelType ?? '') ? 'petrol' : null;
  const heavy = /truck|van|bus/.test(t), tri = /tri|cargo/.test(t);
  const kwh = heavy ? 0.35 : tri ? 0.07 : 0.025;
  const l = heavy ? (fuel === 'diesel' ? 0.25 : 0.3) : tri ? 0.06 : 0.03;
  return { electric: !fuel, kwhPerKm: kwh, litresPerKm: l, fuel };
}

export type Priority = 'time' | 'energy' | 'balanced';

/**
 * Scores each route (lower is better) on time, energy and CO2, relative to the best of each. `congestion` stretches the
 * times when the vehicle's recent pace is below free-flow. If a deadline is given, routes that miss it are marked infeasible
 * and only chosen if none can make it.
 */
export function scoreRoutes(cands: Candidate[], profile: Profile, priority: Priority = 'balanced', opts: { congestion?: number; dueInSeconds?: number | null } = {}): { options: Scored[]; best: Scored; reasoning: string[] } {
  const cong = Math.min(2.5, Math.max(1, opts.congestion ?? 1));
  const rows: Scored[] = cands.map((c) => {
    const km = c.distanceM / 1000, durationS = c.durationS * cong;
    const energyKwh = profile.electric ? +(km * profile.kwhPerKm).toFixed(2) : null;
    const fuelLitres = !profile.electric ? +(km * profile.litresPerKm).toFixed(2) : null;
    const co2Kg = +(profile.electric ? km * profile.kwhPerKm * GRID_KG_PER_KWH : km * profile.litresPerKm * CO2_PER_LITRE[profile.fuel ?? 'petrol']).toFixed(3);
    const feasible = opts.dueInSeconds === undefined || opts.dueInSeconds === null ? null : durationS <= opts.dueInSeconds;
    return { ...c, minutes: Math.round(durationS / 60), km: +km.toFixed(1), energyKwh, fuelLitres, co2Kg, feasible, score: 0, label: '' };
  });
  const minT = Math.min(...rows.map((r) => r.minutes)) || 1, minC = Math.min(...rows.map((r) => r.co2Kg)) || 1e-9, minE = Math.min(...rows.map((r) => (r.energyKwh ?? r.fuelLitres ?? 0))) || 1e-9;
  const w = priority === 'time' ? { t: 0.8, e: 0.1, c: 0.1 } : priority === 'energy' ? { t: 0.15, e: 0.45, c: 0.4 } : { t: 0.5, e: 0.3, c: 0.2 };
  for (const r of rows) {
    r.score = +(w.t * (r.minutes / minT) + w.e * ((r.energyKwh ?? r.fuelLitres ?? 0) / minE) + w.c * (r.co2Kg / minC)).toFixed(3);
    if (r.feasible === false) r.score += 100;
  }
  const sorted = [...rows].sort((a, b) => a.score - b.score);
  const best = sorted[0], fastest = [...rows].sort((a, b) => a.minutes - b.minutes)[0];
  rows.forEach((r) => { r.label = r === best ? 'Recommended' : r === fastest ? 'Fastest' : `Option ${r.index + 1}`; });
  const reasoning: string[] = [];
  if (cong > 1.15) reasoning.push(`Times include a ${Math.round((cong - 1) * 100)}% slow-down: this vehicle has recently been moving slower than free-flow.`);
  if (rows.length === 1) reasoning.push('Only one road route was found.');
  else {
    const others = rows.filter((r) => r !== best);
    for (const o of others) {
      const dMin = o.minutes - best.minutes, dKm = +(o.km - best.km).toFixed(1), dCo2 = best.co2Kg > 0 ? Math.round(((o.co2Kg - best.co2Kg) / o.co2Kg) * 100) : 0;
      const parts: string[] = [];
      parts.push(dMin === 0 ? 'same time' : dMin > 0 ? `${dMin} min faster` : `${-dMin} min slower`);
      parts.push(dKm === 0 ? 'same distance' : dKm > 0 ? `${dKm} km shorter` : `${-dKm} km longer`);
      if (dCo2 > 0) parts.push(`${dCo2}% less CO2`); else if (dCo2 < 0) parts.push(`${-dCo2}% more CO2`);
      reasoning.push(`Recommended route vs ${o.label.toLowerCase()}: ${parts.join(', ')}.`);
    }
  }
  if (opts.dueInSeconds !== undefined && opts.dueInSeconds !== null) {
    if (best.feasible === false) reasoning.push(`No route reaches the destination before the deadline (the best needs ${best.minutes} min, ${Math.max(0, Math.round(opts.dueInSeconds / 60))} min left).`);
    else reasoning.push(`Arrives with about ${Math.max(0, Math.round(opts.dueInSeconds / 60) - best.minutes)} min to spare.`);
  }
  reasoning.push(profile.electric ? `Energy estimate uses ${profile.kwhPerKm} kWh/km; CO2 uses ${GRID_KG_PER_KWH} kg per kWh of grid power.` : `Fuel estimate uses ${profile.litresPerKm} L/km (${profile.fuel ?? 'petrol'}).`);
  return { options: rows, best, reasoning };
}
