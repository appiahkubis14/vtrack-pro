import { Injectable } from '@nestjs/common';

export interface EnergySample {
  soc?: number;
  odometerKm?: number;
  timestamp: Date;
}

@Injectable()
export class EnergyMetricsEngine {
  kwhPer100Km(energyConsumedKwh: number, distanceKm: number): number | null {
    if (distanceKm <= 0) return null;
    return (energyConsumedKwh / distanceKm) * 100;
  }

  milesPerKwh(energyConsumedKwh: number, distanceMiles: number): number | null {
    if (energyConsumedKwh <= 0) return null;
    return distanceMiles / energyConsumedKwh;
  }

  energyCost(energyKwh: number, pricePerKwh: number): number {
    return Math.round(energyKwh * pricePerKwh * 100) / 100;
  }

  /** % SoH lost per month, from a series of periodic SoH readings. Needs >= 2 points spanning >= 1 month for a meaningful trend. */
  degradationTrendPctPerMonth(sohReadings: Array<{ soh: number; at: Date }>): number | null {
    if (sohReadings.length < 2) return null;
    const sorted = [...sohReadings].sort((a, b) => a.at.getTime() - b.at.getTime());
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const months = (last.at.getTime() - first.at.getTime()) / (30 * 86_400_000);
    if (months < 1) return null;
    return (first.soh - last.soh) / months;
  }

  /** How far off the vehicle's indicated range was from what it actually delivered. */
  rangeAccuracyPct(estimatedRangeKm: number, actualDistanceDeliveredKm: number): number | null {
    if (estimatedRangeKm <= 0) return null;
    return Math.max(0, 100 - (Math.abs(estimatedRangeKm - actualDistanceDeliveredKm) / estimatedRangeKm) * 100);
  }
}
