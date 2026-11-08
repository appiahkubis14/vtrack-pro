import { analyseTrack, downsample, estimateEta, TrackPoint } from './track.engine';

const T0 = Date.parse('2026-11-07T08:00:00Z');
const pt = (min: number, lat: number, lng: number, speed: number, ignition = true): TrackPoint => ({ t: new Date(T0 + min * 60000).toISOString(), lat, lng, speed, heading: 0, ignition });

describe('analyseTrack', () => {
  it('finds a stop only when the standstill is long enough', () => {
    const pts = [pt(0, 5.6, -0.19, 30), pt(1, 5.601, -0.19, 30), pt(2, 5.602, -0.19, 0), pt(3, 5.602, -0.19, 0), pt(4, 5.602, -0.19, 0), pt(5, 5.602, -0.19, 0), pt(6, 5.603, -0.19, 25)];
    const { stops, stats } = analyseTrack(pts);
    expect(stops).toHaveLength(1);
    expect(stops[0].durationSeconds).toBe(180);
    expect(stops[0].idle).toBe(true); // engine was on
    expect(stats.stops).toBe(1);
  });

  it('marks a stop as parked when the engine is off', () => {
    const pts = [pt(0, 5.6, -0.19, 0, false), pt(10, 5.6, -0.19, 0, false), pt(11, 5.61, -0.19, 20, true)];
    const { stops } = analyseTrack(pts);
    expect(stops[0].idle).toBe(false);
    expect(stops[0].durationSeconds).toBe(600);
  });

  it('ignores a short pause', () => {
    const pts = [pt(0, 5.6, -0.19, 30), pt(1, 5.601, -0.19, 0), pt(2, 5.602, -0.19, 30)];
    expect(analyseTrack(pts).stops).toHaveLength(0);
  });

  it('does not count GPS jitter while standing as distance', () => {
    const pts = [pt(0, 5.6, -0.19, 0), pt(1, 5.60005, -0.19, 0), pt(2, 5.6, -0.19004, 0), pt(3, 5.60003, -0.19, 0)];
    expect(analyseTrack(pts).stats.distanceKm).toBe(0);
  });

  it('does not count a long silent gap as driving', () => {
    const pts = [pt(0, 5.6, -0.19, 30), pt(120, 6.5, -0.19, 30)];
    expect(analyseTrack(pts).stats.distanceKm).toBe(0);
  });

  it('adds up distance, top speed and idle time', () => {
    const pts = [pt(0, 5.6, -0.19, 30), pt(1, 5.61, -0.19, 40), pt(2, 5.62, -0.19, 0), pt(7, 5.62, -0.19, 0)];
    const { stats } = analyseTrack(pts);
    expect(stats.distanceKm).toBeGreaterThan(2.1);
    expect(stats.distanceKm).toBeLessThan(2.3);
    expect(stats.maxSpeedKmh).toBe(40);
    expect(stats.idleSeconds).toBe(300);
  });
});

describe('downsample', () => {
  it('keeps first and last and respects the limit', () => {
    const a = Array.from({ length: 1000 }, (_, i) => i);
    const d = downsample(a, 100);
    expect(d).toHaveLength(100);
    expect(d[0]).toBe(0);
    expect(d[99]).toBe(999);
  });
  it('leaves short lists alone', () => expect(downsample([1, 2, 3], 10)).toEqual([1, 2, 3]));
});

describe('estimateEta', () => {
  it('uses 1.3x road factor and never assumes a pace under 5 km/h', () => {
    expect(estimateEta(10000, 26)).toEqual({ roadKm: 13, minutes: 30 });
    expect(estimateEta(10000, 0).minutes).toBe(156);
  });
});
