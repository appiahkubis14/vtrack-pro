import { assetAlarms, normalizeTelemetry, riskScore } from './telemetry.engine';
import { angleDiff, bearingDeg, distanceToLine, isWorkTime, thin } from './geo.engine';
import { profileFor, scoreRoutes } from './route-advice.engine';
import { parseCsv, parseGeoJson } from './geofence-import.engine';

describe('telemetry', () => {
  it('reads common key spellings and ignores junk', () => {
    const t = normalizeTelemetry({ coolant_temp: '98', SOC: 12, dtc: 'P0217, P0300', junk: 5 }, { Temperature: 4.5, door: 1 }, 55);
    expect(t).toEqual({ coolantTemp: 98, soc: 12, dtc: ['P0217', 'P0300'], temperatureC: 4.5, doorOpen: true, fuelLevel: 55 });
  });
  it('scores risk with reasons', () => {
    expect(riskScore({}).level).toBe('low');
    const r = riskScore({ coolantTemp: 110, dtc: ['P0217'] });
    expect(r.level).toBe('high'); expect(r.reasons.length).toBe(2);
    expect(riskScore({ soc: 15 }).level).toBe('low'); // 22 points is below the medium line of 25
    expect(riskScore({ soc: 15 }, { overdueMaintenance: 1 }).level).toBe('medium');
    expect(riskScore({ fuelLevel: 5 }, { electric: true }).score).toBe(0);
  });
  it('raises asset alarms', () => {
    expect(assetAlarms({ temperatureC: 9, doorOpen: true, batteryPct: 10 }, { tempMax: 5, batteryMin: 20 })).toHaveLength(3);
    expect(assetAlarms({ temperatureC: 3 }, { tempMax: 5 })).toEqual([]);
  });
});

describe('geometry', () => {
  it('measures distance to a route', () => {
    const line: [number, number][] = [[0, 0], [0.01, 0]];
    expect(distanceToLine({ lat: 0, lng: 0.005 }, line)).toBeLessThan(1);
    expect(Math.round(distanceToLine({ lat: 0.001, lng: 0.005 }, line))).toBeGreaterThan(100);
  });
  it('bearing and angle difference', () => {
    expect(Math.round(bearingDeg({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }))).toBe(90);
    expect(angleDiff(350, 10)).toBe(20);
  });
  it('thins and keeps the ends', () => { const p = Array.from({ length: 100 }, (_, i) => i); const t = thin(p, 10); expect(t).toHaveLength(10); expect(t[0]).toBe(0); expect(t[9]).toBe(99); });
  it('works out working hours in the vehicle time zone, including overnight', () => {
    const cfg = { timezone: 'Africa/Accra', work_days: [1, 2, 3, 4, 5], start_time: '07:00', end_time: '19:00' };
    expect(isWorkTime(cfg, new Date('2026-11-09T10:00:00Z'))).toBe(true);   // Monday 10:00
    expect(isWorkTime(cfg, new Date('2026-11-09T20:00:00Z'))).toBe(false);  // Monday 20:00
    expect(isWorkTime(cfg, new Date('2026-11-08T10:00:00Z'))).toBe(false);  // Sunday
    expect(isWorkTime({ ...cfg, start_time: '22:00', end_time: '06:00' }, new Date('2026-11-09T23:00:00Z'))).toBe(true);
  });
});

describe('route advice', () => {
  const ev = profileFor('ebike', null, null);
  it('explains the choice', () => {
    const r = scoreRoutes([{ index: 0, distanceM: 10000, durationS: 1200 }, { index: 1, distanceM: 8000, durationS: 1320 }], ev, 'balanced');
    expect(r.best.index).toBe(1); expect(r.reasoning.join(' ')).toMatch(/km shorter/);
  });
  it('prefers a feasible route when there is a deadline', () => {
    const r = scoreRoutes([{ index: 0, distanceM: 10000, durationS: 1200 }, { index: 1, distanceM: 5000, durationS: 2400 }], ev, 'energy', { dueInSeconds: 1500 });
    expect(r.best.index).toBe(0); expect(r.options[1].feasible).toBe(false);
  });
  it('uses fuel for petrol vehicles', () => { const p = profileFor('motorbike', null, 'petrol'); expect(p.electric).toBe(false); expect(scoreRoutes([{ index: 0, distanceM: 10000, durationS: 600 }], p).best.fuelLitres).toBeGreaterThan(0); });
});

describe('geofence import', () => {
  it('parses CSV circles and polygons and reports bad rows', () => {
    const rows = parseCsv('name,lat,lng,radius,color\nShop A,5.6,-0.2,150,#ff0000\n"Shop, B",x,1,2\n');
    expect(rows[0].body).toMatchObject({ name: 'Shop A', type: 'circle', radius: 150, color: '#ff0000' });
    expect(rows[1].error).toBeDefined();
    const p = parseCsv('name,polygon\nYard,"5.6 -0.2; 5.6 -0.19; 5.61 -0.19"');
    expect(p[0].body.coordinates.coordinates[0]).toHaveLength(4);
  });
  it('parses GeoJSON', () => {
    const rows = parseGeoJson(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'A', radius: 50 }, geometry: { type: 'Point', coordinates: [-0.2, 5.6] } }, { type: 'Feature', properties: { name: 'B' }, geometry: { type: 'LineString', coordinates: [] } }] }));
    expect(rows[0].body).toMatchObject({ type: 'circle', centerLatitude: 5.6, radius: 50 }); expect(rows[1].error).toMatch(/not supported/);
  });
});
