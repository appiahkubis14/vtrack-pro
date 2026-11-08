import { MapMatchingEngine, RoadSegment, TracePoint } from './map-matching.engine';

describe('MapMatchingEngine', () => {
  const engine = new MapMatchingEngine();

  // A short straight "road" running east-west along latitude 22.500.
  const mainStreet: RoadSegment = {
    id: 'road-1',
    name: 'Main Street',
    points: [
      [22.5, 114.0],
      [22.5, 114.01],
    ],
  };

  const network: RoadSegment[] = [mainStreet];

  it('snaps a point that is slightly off the road onto the road', () => {
    const trace: TracePoint[] = [{ lat: 22.5001, lng: 114.005, timestamp: new Date() }];
    const [result] = engine.matchTrace(trace, network);

    expect(result.roadId).toBe('road-1');
    expect(result.snapped.lat).toBeCloseTo(22.5, 3);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('does not snap a point that is far from any road', () => {
    const trace: TracePoint[] = [{ lat: 22.6, lng: 114.5, timestamp: new Date() }];
    const [result] = engine.matchTrace(trace, network);

    expect(result.roadId).toBeNull();
    expect(result.confidence).toBe(0);
    // Falls back to the original point, not some far-away snap.
    expect(result.snapped.lat).toBe(22.6);
  });

  it('projects onto the middle of a segment, not just an endpoint', () => {
    const midpointLng = (mainStreet.points[0][1] + mainStreet.points[1][1]) / 2;
    const trace: TracePoint[] = [{ lat: 22.5002, lng: midpointLng, timestamp: new Date() }];
    const [result] = engine.matchTrace(trace, network);

    expect(result.snapped.lng).toBeCloseTo(midpointLng, 3);
  });

  it('clamps projection to the segment endpoints rather than the infinite line', () => {
    // Point far past the end of the segment (east of both endpoints).
    const trace: TracePoint[] = [{ lat: 22.5, lng: 114.05, timestamp: new Date() }];
    const [result] = engine.matchTrace(trace, network);

    // Should either snap to the segment's east endpoint or reject as too far -
    // never extrapolate past [114.0, 114.01].
    if (result.roadId) {
      expect(result.snapped.lng).toBeLessThanOrEqual(114.01 + 1e-6);
    }
  });

  it('discards an isolated bad snap that breaks continuity with its neighbors', () => {
    const farRoad: RoadSegment = {
      id: 'road-2',
      name: 'Side Street',
      points: [
        [22.55, 114.0],
        [22.55, 114.001],
      ],
    };
    const twoRoadNetwork = [mainStreet, farRoad];

    const trace: TracePoint[] = [
      { lat: 22.5001, lng: 114.001, timestamp: new Date(0) },
      // A noisy point that happens to land suspiciously close to the far road
      // instead of continuing along Main Street.
      { lat: 22.5499, lng: 114.0005, timestamp: new Date(1000) },
      { lat: 22.5002, lng: 114.003, timestamp: new Date(2000) },
    ];

    const results = engine.matchTrace(trace, twoRoadNetwork);

    // The middle point's snap should have been discarded by continuity
    // smoothing (falls back to its raw coordinates) since both neighbors
    // are on Main Street, far from Side Street.
    expect(results[1].roadId).toBeNull();
    expect(results[1].snapped.lat).toBe(22.5499);
  });

  it('returns an empty array for an empty trace', () => {
    expect(engine.matchTrace([], network)).toEqual([]);
  });
});
