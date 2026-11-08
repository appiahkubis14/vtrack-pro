import { haversineDistanceMeters } from '../../../helpers/geo.helper';

export interface TrackPoint {
  t: string; // ISO timestamp
  lat: number;
  lng: number;
  speed: number; // km/h
  heading: number;
  ignition: boolean;
}

export interface Stop {
  start: string;
  end: string;
  durationSeconds: number;
  lat: number;
  lng: number;
  /** true when the engine was on while the vehicle stood still (idling), false when it was switched off (parked). */
  idle: boolean;
  pointCount: number;
}

export interface TrackStats {
  points: number;
  distanceKm: number;
  durationSeconds: number;
  movingSeconds: number;
  stoppedSeconds: number;
  idleSeconds: number;
  maxSpeedKmh: number;
  avgMovingSpeedKmh: number;
  stops: number;
}

export interface TrackOptions {
  /** At or below this speed (km/h) a vehicle counts as standing still. */
  stopSpeedKmh?: number;
  /** A standstill shorter than this is not reported as a stop. */
  minStopSeconds?: number;
  /** A gap in reports longer than this is not counted as driving distance (tracker was off or out of coverage). */
  maxGapSeconds?: number;
}

const DEFAULTS: Required<TrackOptions> = { stopSpeedKmh: 2, minStopSeconds: 180, maxGapSeconds: 1800 };

/**
 * Turns a list of position reports (oldest first) into distance, driving/stopped time and a list of stops.
 * Pure function: no database, easy to test.
 */
export function analyseTrack(points: TrackPoint[], options: TrackOptions = {}): { stops: Stop[]; stats: TrackStats } {
  const o = { ...DEFAULTS, ...options };
  const stops: Stop[] = [];
  let distanceM = 0, movingS = 0, stoppedS = 0, idleS = 0, maxSpeed = 0, movingSpeedSum = 0, movingSpeedN = 0;

  let run: TrackPoint[] = [];
  const closeRun = () => {
    if (run.length >= 1) {
      const start = new Date(run[0].t).getTime();
      const end = new Date(run[run.length - 1].t).getTime();
      const dur = Math.max(0, (end - start) / 1000);
      if (dur >= o.minStopSeconds) {
        const lat = run.reduce((a, p) => a + p.lat, 0) / run.length;
        const lng = run.reduce((a, p) => a + p.lng, 0) / run.length;
        const ignitionOn = run.filter((p) => p.ignition).length;
        stops.push({ start: run[0].t, end: run[run.length - 1].t, durationSeconds: Math.round(dur), lat, lng, idle: ignitionOn > run.length / 2, pointCount: run.length });
      }
    }
    run = [];
  };

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.speed > maxSpeed) maxSpeed = p.speed;
    const still = p.speed <= o.stopSpeedKmh;
    if (still) run.push(p); else closeRun();

    if (i > 0) {
      const prev = points[i - 1];
      const dt = (new Date(p.t).getTime() - new Date(prev.t).getTime()) / 1000;
      if (dt > 0 && dt <= o.maxGapSeconds) {
        const d = haversineDistanceMeters(prev.lat, prev.lng, p.lat, p.lng);
        // GPS jitter while standing still must not add up to "distance": only count movement of a moving report.
        if (!(prev.speed <= o.stopSpeedKmh && still)) distanceM += d;
        if (still && prev.speed <= o.stopSpeedKmh) { stoppedS += dt; if (prev.ignition) idleS += dt; }
        else { movingS += dt; movingSpeedSum += p.speed; movingSpeedN++; }
      }
    }
  }
  closeRun();

  const durationSeconds = points.length > 1 ? Math.round((new Date(points[points.length - 1].t).getTime() - new Date(points[0].t).getTime()) / 1000) : 0;
  return {
    stops,
    stats: {
      points: points.length,
      distanceKm: Math.round(distanceM / 10) / 100,
      durationSeconds,
      movingSeconds: Math.round(movingS),
      stoppedSeconds: Math.round(stoppedS),
      idleSeconds: Math.round(idleS),
      maxSpeedKmh: Math.round(maxSpeed),
      avgMovingSpeedKmh: movingSpeedN ? Math.round((movingSpeedSum / movingSpeedN) * 10) / 10 : 0,
      stops: stops.length,
    },
  };
}

/** Keeps at most `max` points, always keeping the first and last, evenly spaced in between. */
export function downsample<T>(items: T[], max: number): T[] {
  if (items.length <= max || max < 3) return items;
  const out: T[] = [items[0]];
  const step = (items.length - 1) / (max - 1);
  for (let i = 1; i < max - 1; i++) out.push(items[Math.round(i * step)]);
  out.push(items[items.length - 1]);
  return out;
}

/** Straight-line ETA used when no routing service answers. Road distance is taken as 1.3 times the straight line. */
export function estimateEta(distanceMeters: number, paceKmh: number): { roadKm: number; minutes: number } {
  const roadKm = (distanceMeters * 1.3) / 1000;
  const pace = Math.max(5, paceKmh);
  return { roadKm: Math.round(roadKm * 10) / 10, minutes: Math.round((roadKm / pace) * 60) };
}
