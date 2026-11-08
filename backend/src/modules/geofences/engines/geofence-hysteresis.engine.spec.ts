import { evaluateHysteresis, HysteresisConfig, HysteresisState } from './geofence-hysteresis.engine';

const cfg: HysteresisConfig = { entryDwellSeconds: 0, exitDwellSeconds: 0, accuracyThresholdMeters: 50, bufferMeters: 0, cooldownSeconds: 300 };
const now = new Date('2026-11-07T10:00:00Z');

describe('evaluateHysteresis', () => {
  it('confirms an entry when the stored state comes from the database with null dates', () => {
    // a row read from Postgres has null (not undefined) for dates that were never set
    const state = { candidateState: 'out', confirmedState: 'out', candidateSince: null, lastAlertAt: null } as unknown as HysteresisState;
    const r = evaluateHysteresis(cfg, state, { rawInside: true, distanceFromBoundaryMeters: 40, now });
    expect(r.transitioned).toBe('entry');
    expect(r.nextState.confirmedState).toBe('in');
  });

  it('waits for the entry dwell time before confirming', () => {
    const slow = { ...cfg, entryDwellSeconds: 10 };
    const s0: HysteresisState = { candidateState: 'out', confirmedState: 'out' };
    const r1 = evaluateHysteresis(slow, s0, { rawInside: true, distanceFromBoundaryMeters: 40, now });
    expect(r1.transitioned).toBeNull();
    const r2 = evaluateHysteresis(slow, r1.nextState, { rawInside: true, distanceFromBoundaryMeters: 40, now: new Date(now.getTime() + 11000) });
    expect(r2.transitioned).toBe('entry');
  });

  it('suppresses a second alert inside the cooldown', () => {
    const s: HysteresisState = { candidateState: 'in', confirmedState: 'in', lastAlertAt: new Date(now.getTime() - 60_000) };
    const r = evaluateHysteresis(cfg, s, { rawInside: false, distanceFromBoundaryMeters: -40, now });
    expect(r.transitioned).toBeNull();
    expect(r.suppressedByCooldown).toBe(true);
  });

  it('holds the state for a low-accuracy fix', () => {
    const s: HysteresisState = { candidateState: 'out', confirmedState: 'out' };
    const r = evaluateHysteresis(cfg, s, { rawInside: true, distanceFromBoundaryMeters: 40, accuracyMeters: 200, now });
    expect(r.transitioned).toBeNull();
    expect(r.nextState).toBe(s);
  });
});
