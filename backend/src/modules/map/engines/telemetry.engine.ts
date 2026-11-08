/** Sensor, CAN bus and OBD readings: one set of names, and a transparent rule-based breakdown risk score. */

export interface Telemetry {
  coolantTemp?: number; rpm?: number; soc?: number; fuelLevel?: number; batteryVoltage?: number; motorTemp?: number; speedCan?: number;
  dtc?: string[]; temperatureC?: number; doorOpen?: boolean; humidity?: number;
}

const ALIASES: Record<string, keyof Telemetry> = {
  coolanttemp: 'coolantTemp', coolant_temp: 'coolantTemp', coolanttemperature: 'coolantTemp', ect: 'coolantTemp',
  rpm: 'rpm', enginerpm: 'rpm', engine_rpm: 'rpm',
  soc: 'soc', soc_percent: 'soc', batterysoc: 'soc', batterylevel: 'soc', battery_level: 'soc', stateofcharge: 'soc',
  fuellevel: 'fuelLevel', fuel_level: 'fuelLevel', fuel: 'fuelLevel',
  batteryvoltage: 'batteryVoltage', battery_voltage: 'batteryVoltage', voltage: 'batteryVoltage',
  motortemp: 'motorTemp', motor_temp: 'motorTemp',
  temperature: 'temperatureC', temperaturec: 'temperatureC', temp: 'temperatureC',
  dooropen: 'doorOpen', door: 'doorOpen', door_open: 'doorOpen',
  humidity: 'humidity',
};

/** Reads OBD and sensor objects (any of the common key spellings) and the position's fuel column into one tidy object. Unknown keys are ignored. */
export function normalizeTelemetry(obd?: Record<string, unknown> | null, sensors?: Record<string, unknown> | null, fuelColumn?: number | null): Telemetry {
  const out: any = {};
  for (const src of [obd, sensors]) {
    if (!src || typeof src !== 'object') continue;
    for (const [k, v] of Object.entries(src)) {
      const key = k.toLowerCase();
      if (key === 'dtc' || key === 'faultcodes' || key === 'fault_codes' || key === 'dtcs') {
        const list = Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(/[,\s]+/) : [];
        out.dtc = list.map((x) => String(x).slice(0, 12)).filter(Boolean).slice(0, 20);
        continue;
      }
      const to = ALIASES[key]; if (!to) continue;
      if (to === 'doorOpen') { out.doorOpen = v === true || v === 1 || v === '1' || v === 'open'; continue; }
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
      if (Number.isFinite(n)) out[to] = n;
    }
  }
  if (out.fuelLevel === undefined && fuelColumn !== null && fuelColumn !== undefined && Number.isFinite(Number(fuelColumn))) out.fuelLevel = Number(fuelColumn);
  return out;
}

export interface Risk { score: number; level: 'low' | 'medium' | 'high'; reasons: string[] }

/** Simple, explainable rules. This is not a trained model: every point of score comes with a reason a mechanic can check. */
export function riskScore(t: Telemetry, opts: { deviceBattery?: number | null; overdueMaintenance?: number; electric?: boolean } = {}): Risk {
  let score = 0; const reasons: string[] = [];
  const add = (n: number, why: string) => { score += n; reasons.push(why); };
  if (t.coolantTemp !== undefined) { if (t.coolantTemp >= 105) add(40, `Coolant ${Math.round(t.coolantTemp)} °C (overheating)`); else if (t.coolantTemp >= 95) add(20, `Coolant ${Math.round(t.coolantTemp)} °C (running hot)`); }
  if (t.motorTemp !== undefined) { if (t.motorTemp >= 100) add(35, `Motor ${Math.round(t.motorTemp)} °C (overheating)`); else if (t.motorTemp >= 85) add(15, `Motor ${Math.round(t.motorTemp)} °C (warm)`); }
  if (t.dtc && t.dtc.length) add(Math.min(45, 25 + (t.dtc.length - 1) * 10), `Fault code${t.dtc.length > 1 ? 's' : ''}: ${t.dtc.slice(0, 3).join(', ')}`);
  if (t.soc !== undefined) { if (t.soc <= 10) add(40, `Battery charge ${Math.round(t.soc)}% (about to stop)`); else if (t.soc <= 20) add(22, `Battery charge ${Math.round(t.soc)}% (low)`); }
  if (t.fuelLevel !== undefined && !opts.electric) { if (t.fuelLevel <= 10) add(20, `Fuel ${Math.round(t.fuelLevel)}% (nearly empty)`); }
  if (t.batteryVoltage !== undefined && t.batteryVoltage > 0 && t.batteryVoltage < 11.5) add(20, `Battery voltage ${t.batteryVoltage.toFixed(1)} V (low)`);
  if (opts.deviceBattery !== undefined && opts.deviceBattery !== null && opts.deviceBattery > 0 && opts.deviceBattery < 15) add(8, `Tracker battery ${Math.round(opts.deviceBattery)}% (may go silent)`);
  if (opts.overdueMaintenance && opts.overdueMaintenance > 0) add(15, `${opts.overdueMaintenance} overdue maintenance job${opts.overdueMaintenance > 1 ? 's' : ''}`);
  score = Math.min(100, score);
  return { score, level: score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low', reasons };
}

/** Sensor asset (trailer, generator, cooler) status from its latest report against its limits. */
export function assetAlarms(status: Record<string, any>, limits: Record<string, any>): string[] {
  const out: string[] = [];
  const t = Number(status.temperatureC), b = Number(status.batteryPct);
  if (status.doorOpen === true) out.push('Door open');
  if (Number.isFinite(t) && limits.tempMax !== undefined && t > Number(limits.tempMax)) out.push(`Temperature ${t} °C is above ${limits.tempMax} °C`);
  if (Number.isFinite(t) && limits.tempMin !== undefined && t < Number(limits.tempMin)) out.push(`Temperature ${t} °C is below ${limits.tempMin} °C`);
  if (Number.isFinite(b) && limits.batteryMin !== undefined && b < Number(limits.batteryMin)) out.push(`Battery ${b}% is below ${limits.batteryMin}%`);
  return out;
}
