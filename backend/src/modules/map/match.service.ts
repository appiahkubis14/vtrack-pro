import { Injectable, Logger } from '@nestjs/common';
import { haversineDistanceMeters } from '../../helpers/geo.helper';
import { angleDiff, bearingDeg, thin } from './engines/geo.engine';
import { TrackPoint } from './engines/track.engine';

export interface MatchedPoint extends TrackPoint { rawLat: number; rawLng: number; snapped: boolean; moved: number; headingOk: boolean }
export interface MatchResult { method: 'osrm' | 'none'; points: MatchedPoint[]; snappedShare: number; note?: string }

const MAX_SNAP_M = 40;

/**
 * Road snapping through an OSRM server (ROUTING_URL). A GPS point is moved onto the nearest road only when it is within a short
 * distance; a point whose road direction contradicts the reported heading at speed is left where it was; a vehicle that is standing
 * still does not drift between points. When the routing service is not reachable the raw points are returned unchanged and `method`
 * says so: nothing here ever invents a position.
 */
@Injectable()
export class MatchService {
  private readonly logger = new Logger(MatchService.name);
  private readonly url = (process.env.ROUTING_URL || 'https://router.project-osrm.org').replace(/\/$/, '');
  /** Snapping every live position is only done on a routing server you run yourself (ROUTING_URL set); the public demo server is not for that. */
  readonly liveEnabled = !!process.env.ROUTING_URL && process.env.MAP_SNAP_LIVE !== 'false';
  private readonly cache = new Map<string, { at: number; v: { lat: number; lng: number; distanceM: number } | null }>();

  private async get(path: string, ms = 8000): Promise<any | null> {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch(this.url + path, { signal: ctl.signal, headers: { 'User-Agent': 'VTrackPro/1.0' } });
      return res.ok ? await res.json() : null;
    } catch (e: any) { this.logger.debug(`Routing unavailable: ${e.message}`); return null; } finally { clearTimeout(timer); }
  }

  /** One live position onto the nearest road (cached by place for 10 minutes). */
  async snapPoint(lat: number, lng: number, heading?: number): Promise<{ lat: number; lng: number; distanceM: number } | null> {
    const key = `${lat.toFixed(4)},${lng.toFixed(4)},${heading !== undefined ? Math.round(heading / 45) : ''}`;
    const hit = this.cache.get(key); if (hit && Date.now() - hit.at < 600_000) return hit.v;
    const bearings = heading !== undefined && Number.isFinite(heading) ? `&bearings=${Math.round(heading) % 360},60` : '';
    const j = await this.get(`/nearest/v1/driving/${lng},${lat}?number=1${bearings}`, 2500);
    const w = j?.waypoints?.[0];
    const v = w && Number.isFinite(w.distance) && w.distance <= MAX_SNAP_M ? { lng: w.location[0], lat: w.location[1], distanceM: Math.round(w.distance) } : null;
    this.cache.set(key, { at: Date.now(), v }); if (this.cache.size > 20000) this.cache.clear();
    return v;
  }

  /** Road routes between two points (the first is the fastest; more only when `alternatives` is set). Geometry is [lng, lat] pairs. */
  async routes(a: { lat: number; lng: number }, b: { lat: number; lng: number }, alternatives = false): Promise<{ distance: number; duration: number; geometry: [number, number][] }[] | null> {
    const j = await this.get(`/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified&geometries=geojson&alternatives=${alternatives ? 'true' : 'false'}`, 6000);
    const list = (j?.routes ?? []).filter((r: any) => Number.isFinite(r.distance) && Number.isFinite(r.duration));
    return list.length ? list.slice(0, 3).map((r: any) => ({ distance: r.distance, duration: r.duration, geometry: (r.geometry?.coordinates ?? []) as [number, number][] })) : null;
  }

  async matchTrace(points: TrackPoint[], maxPoints = 500): Promise<MatchResult> {
    const raw = (note?: string): MatchResult => ({ method: 'none', note, snappedShare: 0, points: points.map((p) => ({ ...p, rawLat: p.lat, rawLng: p.lng, snapped: false, moved: 0, headingOk: true })) });
    if (points.length < 2) return raw('Too few points to match.');
    const pts = thin(points, maxPoints);
    // keep time strictly increasing, which the matcher requires
    const seq: TrackPoint[] = []; let lastS = -1;
    for (const p of pts) { const s = Math.floor(new Date(p.t).getTime() / 1000); if (s > lastS) { seq.push(p); lastS = s; } }
    const out: MatchedPoint[] = seq.map((p) => ({ ...p, rawLat: p.lat, rawLng: p.lng, snapped: false, moved: 0, headingOk: true }));
    let ok = 0, anyReply = false;
    for (let i = 0; i < seq.length; i += 100) {
      const chunk = seq.slice(i, i + 100); if (chunk.length < 2) continue;
      const coords = chunk.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
      const ts = chunk.map((p) => Math.floor(new Date(p.t).getTime() / 1000)).join(';');
      const rad = chunk.map(() => 30).join(';');
      const j = await this.get(`/match/v1/driving/${coords}?overview=false&gaps=split&tidy=true&radiuses=${rad}&timestamps=${ts}`);
      if (!j || j.code !== 'Ok' || !Array.isArray(j.tracepoints)) continue;
      anyReply = true;
      j.tracepoints.forEach((tp: any, k: number) => {
        if (!tp?.location) return; const o = out[i + k]; const sl = tp.location[1], sg = tp.location[0];
        o.moved = Math.round(haversineDistanceMeters(o.rawLat, o.rawLng, sl, sg));
        if (o.moved <= 60) { o.lat = sl; o.lng = sg; o.snapped = true; }
      });
    }
    if (!anyReply) return raw('The routing service did not answer, so the raw GPS points are shown.');
    // Standing still: keep the vehicle at one place instead of drifting between road points.
    for (let i = 1; i < out.length; i++) {
      if (out[i].speed <= 2 && out[i - 1].speed <= 2 && haversineDistanceMeters(out[i].rawLat, out[i].rawLng, out[i - 1].rawLat, out[i - 1].rawLng) < 25) { out[i].lat = out[i - 1].lat; out[i].lng = out[i - 1].lng; out[i].snapped = out[i - 1].snapped; }
    }
    // Direction check: at speed, the road direction must agree with the reported heading, otherwise it is probably a parallel or opposite road.
    for (let i = 1; i < out.length; i++) {
      const a = out[i - 1], b = out[i];
      if (!b.snapped || !a.snapped || b.speed < 10 || !Number.isFinite(b.heading) || haversineDistanceMeters(a.lat, a.lng, b.lat, b.lng) < 8) continue;
      if (angleDiff(bearingDeg(a, b), b.heading) > 110) { b.headingOk = false; b.lat = b.rawLat; b.lng = b.rawLng; b.snapped = false; }
    }
    ok = out.filter((p) => p.snapped).length;
    return { method: 'osrm', points: out, snappedShare: Math.round((ok / out.length) * 100) / 100 };
  }
}
