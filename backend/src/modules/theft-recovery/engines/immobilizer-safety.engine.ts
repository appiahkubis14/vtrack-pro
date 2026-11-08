import { Injectable } from '@nestjs/common';
import { SafetyCheckResult } from '../entities/recovery-action.entity';

const UNSAFE_SPEED_THRESHOLD_KMH = 10;

/**
 * Cutting a moving vehicle's engine is a real safety hazard - a driver
 * losing power steering/braking assist at speed can cause a crash. This is
 * the one check that must never be silently bypassed, even for a
 * legitimate theft case: if the vehicle is moving above the threshold, the
 * command is held as "recommend safe stop" rather than executed immediately.
 * An emergency override exists (a human can force it), but every override
 * is logged with the overriding user - see TheftRecoveryService.
 */
@Injectable()
export class ImmobilizerSafetyEngine {
  evaluate(currentSpeedKmh: number): SafetyCheckResult {
    if (currentSpeedKmh <= UNSAFE_SPEED_THRESHOLD_KMH) {
      return {
        speedKmh: currentSpeedKmh,
        safeToImmobilize: true,
        reason: `Vehicle is stationary or near-stationary (${currentSpeedKmh}km/h) - safe to immobilize`,
      };
    }

    return {
      speedKmh: currentSpeedKmh,
      safeToImmobilize: false,
      reason: `Vehicle is moving at ${currentSpeedKmh}km/h - immobilizing now risks a crash. Recommend waiting for a safe stop, or an explicit emergency override.`,
    };
  }
}
