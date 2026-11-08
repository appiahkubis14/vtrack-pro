import { haversineDistanceMeters } from '../../../helpers/geo.helper';

export interface RoadSegment {
  id: string;
  name?: string;
  /** Polyline as [lat, lng] pairs, at least 2 points. */
  points: [number, number][];
}

export interface TracePoint {
  lat: number;
  lng: number;
  timestamp: Date;
}

export interface MatchedPoint {
  original: TracePoint;
  snapped: { lat: number; lng: number };
  roadId: string | null;
  roadName?: string;
  distanceToRoadMeters: number;
  confidence: number; // 0-1
}

const MAX_SNAP_DISTANCE_METERS = 50;
const CONTINUITY_PENALTY_METERS = 200; // jumping this far between consecutive matched roads drops confidence sharply

/**
 * Lightweight, dependency-free map matcher: for each raw GPS point, project
 * it onto the nearest point of the nearest road segment (within
 * MAX_SNAP_DISTANCE_METERS), then apply a simple continuity check so a
 * single noisy point can't snap to a completely unrelated road far from its
 * neighbors in the trace.
 *
 * This is NOT a full Hidden Markov Model map matcher (no Viterbi decoding
 * over a routable graph, no transition probabilities informed by actual
 * road connectivity) - it's the "custom HMM" option's simpler sibling,
 * good enough to noticeably clean up sidewalk-vs-road GPS jitter and
 * improve distance calculations, but it will not correctly disambiguate
 * parallel roads or handle complex interchanges the way OSRM/Valhalla do.
 * Swap to the OSRM integration in docs/v2-architecture.md section 11 when
 * you need that level of accuracy.
 */
export class MapMatchingEngine {
  matchTrace(trace: TracePoint[], roadNetwork: RoadSegment[]): MatchedPoint[] {
    if (!trace.length) return [];

    const rawMatches = trace.map((point) => this.snapPoint(point, roadNetwork));
    return this.applyContinuitySmoothing(rawMatches);
  }

  private snapPoint(point: TracePoint, roadNetwork: RoadSegment[]): MatchedPoint {
    let best: { segment: RoadSegment; snapped: { lat: number; lng: number }; distance: number } | null = null;

    for (const segment of roadNetwork) {
      for (let i = 0; i < segment.points.length - 1; i++) {
        const [lat1, lng1] = segment.points[i];
        const [lat2, lng2] = segment.points[i + 1];
        const projected = this.projectOntoSegment(point.lat, point.lng, lat1, lng1, lat2, lng2);
        const distance = haversineDistanceMeters(point.lat, point.lng, projected.lat, projected.lng);

        if (!best || distance < best.distance) {
          best = { segment, snapped: projected, distance };
        }
      }
    }

    if (!best || best.distance > MAX_SNAP_DISTANCE_METERS) {
      return {
        original: point,
        snapped: { lat: point.lat, lng: point.lng },
        roadId: null,
        distanceToRoadMeters: best?.distance ?? Infinity,
        confidence: 0,
      };
    }

    const confidence = Math.max(0, 1 - best.distance / MAX_SNAP_DISTANCE_METERS);
    return {
      original: point,
      snapped: best.snapped,
      roadId: best.segment.id,
      roadName: best.segment.name,
      distanceToRoadMeters: Math.round(best.distance * 10) / 10,
      confidence: Math.round(confidence * 100) / 100,
    };
  }

  /**
   * Perpendicular projection of a point onto a line segment, using an
   * equirectangular approximation (fine at road-segment scale - a few
   * hundred meters at most - not for long segments spanning large
   * latitude ranges).
   */
  private projectOntoSegment(
    pLat: number,
    pLng: number,
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): { lat: number; lng: number } {
    const latRad = (lat1 * Math.PI) / 180;
    const cosLat = Math.cos(latRad);

    // Convert to a local flat approximation (meters-ish units via degrees * cos-scaled lng).
    const ax = lng1 * cosLat;
    const ay = lat1;
    const bx = lng2 * cosLat;
    const by = lat2;
    const px = pLng * cosLat;
    const py = pLat;

    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) return { lat: lat1, lng: lng1 };

    let t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t)); // clamp to the segment, not the infinite line

    const projX = ax + t * dx;
    const projY = ay + t * dy;

    return { lat: projY, lng: projX / cosLat };
  }

  /**
   * If a point snapped to a road far (in world-distance terms) from where
   * its neighbors snapped, treat it as an isolated mismatch and fall back
   * to the raw (unsnapped) point rather than letting one bad snap create a
   * visible zigzag in the route.
   */
  private applyContinuitySmoothing(matches: MatchedPoint[]): MatchedPoint[] {
    return matches.map((match, i) => {
      if (!match.roadId) return match;

      const prev = matches[i - 1];
      const next = matches[i + 1];
      const neighbors = [prev, next].filter((m): m is MatchedPoint => Boolean(m?.roadId));
      if (!neighbors.length) return match;

      const jumps = neighbors.map((n) => haversineDistanceMeters(match.snapped.lat, match.snapped.lng, n.snapped.lat, n.snapped.lng));
      const isolated = jumps.every((d) => d > CONTINUITY_PENALTY_METERS);

      if (isolated) {
        return {
          ...match,
          snapped: { lat: match.original.lat, lng: match.original.lng },
          roadId: null,
          confidence: 0,
        };
      }
      return match;
    });
  }
}
