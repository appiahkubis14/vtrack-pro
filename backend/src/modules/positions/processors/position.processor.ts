import { Injectable } from '@nestjs/common';
import { DeviceStatus } from '../../../common/constants/alerts.constant';
import { ParsedPosition } from '../../devices/processors/protocol.interface';

const MOVING_SPEED_THRESHOLD_KMH = 5;
const PARKED_AFTER_MS = 5 * 60 * 1000; // "stationary > 5 min" per spec

export interface PreviousPositionState {
  speed?: number;
  ignition?: boolean;
  timestamp: Date;
  stoppedSinceMs?: number; // how long it's been continuously stationary, carried forward
}

@Injectable()
export class PositionProcessor {
  /**
   * IDLE = engine on, not moving. MOVING = in motion. STOPPED = engine off.
   * PARKED = stationary > 5 min. OFFLINE is decided elsewhere (last-seen timeout),
   * not from a single position.
   */
  classify(current: ParsedPosition, previous?: PreviousPositionState): DeviceStatus {
    const speed = current.speed ?? 0;

    if (speed >= MOVING_SPEED_THRESHOLD_KMH) {
      return DeviceStatus.MOVING;
    }

    if (current.ignition === false) {
      return DeviceStatus.STOPPED;
    }

    const stoppedSinceMs = this.stationaryDurationMs(current, previous);
    if (stoppedSinceMs >= PARKED_AFTER_MS) {
      return DeviceStatus.PARKED;
    }

    return DeviceStatus.IDLE;
  }

  private stationaryDurationMs(current: ParsedPosition, previous?: PreviousPositionState): number {
    if (!previous || (previous.speed ?? 0) >= MOVING_SPEED_THRESHOLD_KMH) return 0;
    const prevStopped = previous.stoppedSinceMs ?? 0;
    return prevStopped + (current.timestamp.getTime() - previous.timestamp.getTime());
  }
}
