export interface HysteresisConfig {
  entryDwellSeconds: number;
  exitDwellSeconds: number;
  accuracyThresholdMeters: number;
  bufferMeters: number;
  cooldownSeconds: number;
}

export interface HysteresisState {
  candidateState: 'in' | 'out';
  confirmedState: 'in' | 'out';
  candidateSince?: Date;
  lastAlertAt?: Date;
}

export interface HysteresisInput {
  /** Raw geometric test result, before any debouncing. */
  rawInside: boolean;
  /** Distance in meters from the geofence boundary - positive if inside past the buffer, used to soften edge noise. */
  distanceFromBoundaryMeters: number;
  /** GPS accuracy/HDOP-derived error estimate in meters, if available. Low-accuracy fixes are down-weighted. */
  accuracyMeters?: number;
  now: Date;
}

export interface HysteresisResult {
  nextState: HysteresisState;
  /** Only true the instant a debounced transition is confirmed - this is when an alert should fire. */
  transitioned: 'entry' | 'exit' | null;
  /** True if a transition would have fired but was suppressed by the cooldown window. */
  suppressedByCooldown: boolean;
}

/**
 * GPS drift causes vehicles to appear to cross a geofence boundary
 * repeatedly when they're actually parked right at the edge. This engine
 * requires a raw reading to persist for entryDwellSeconds/exitDwellSeconds
 * before confirming the transition, applies a buffer so points just past
 * the boundary don't count, down-weights (ignores) low-accuracy fixes, and
 * enforces a cooldown so a flickering signal can't spam repeat alerts.
 */
export function evaluateHysteresis(
  config: HysteresisConfig,
  state: HysteresisState,
  input: HysteresisInput,
): HysteresisResult {
  // Low-accuracy fixes can't be trusted to make a boundary call - hold state.
  if (input.accuracyMeters !== undefined && input.accuracyMeters > config.accuracyThresholdMeters) {
    return { nextState: state, transitioned: null, suppressedByCooldown: false };
  }

  // Apply the buffer: a point just barely past the boundary doesn't count as
  // a real crossing - only trust readings clearly beyond the buffer zone.
  const effectiveInside =
    input.rawInside && Math.abs(input.distanceFromBoundaryMeters) >= config.bufferMeters
      ? true
      : !input.rawInside && Math.abs(input.distanceFromBoundaryMeters) >= config.bufferMeters
        ? false
        : state.confirmedState === 'in'; // inside the buffer zone: keep the last confirmed state (no flip)

  const rawState: 'in' | 'out' = effectiveInside ? 'in' : 'out';

  // Reading agrees with the last confirmed state - nothing to debounce, just clear any stale candidate.
  if (rawState === state.confirmedState) {
    return {
      nextState: { ...state, candidateState: rawState, candidateSince: undefined },
      transitioned: null,
      suppressedByCooldown: false,
    };
  }

  // Reading disagrees with confirmed state - start or continue a candidate window.
  const candidateSince =
    state.candidateState === rawState && state.candidateSince ? state.candidateSince : input.now;

  const dwellRequiredSeconds = rawState === 'in' ? config.entryDwellSeconds : config.exitDwellSeconds;
  const dwellElapsedSeconds = (input.now.getTime() - candidateSince.getTime()) / 1000;

  if (dwellElapsedSeconds < dwellRequiredSeconds) {
    // Still within the debounce window - not confirmed yet.
    return {
      nextState: { ...state, candidateState: rawState, candidateSince },
      transitioned: null,
      suppressedByCooldown: false,
    };
  }

  // Dwell satisfied - confirm the transition, subject to cooldown.
  const cooldownActive =
    state.lastAlertAt != null && // a database NULL arrives as null, not undefined
    (input.now.getTime() - state.lastAlertAt.getTime()) / 1000 < config.cooldownSeconds;

  const nextState: HysteresisState = {
    confirmedState: rawState,
    candidateState: rawState,
    candidateSince: undefined,
    lastAlertAt: cooldownActive ? state.lastAlertAt : input.now,
  };

  return {
    nextState,
    transitioned: cooldownActive ? null : rawState === 'in' ? 'entry' : 'exit',
    suppressedByCooldown: cooldownActive,
  };
}
