import { Injectable } from '@nestjs/common';

export interface FuelSample {
  fuelLevel?: number; // percent or liters, depending on sensor calibration
  odometer?: number; // km
  ignition?: boolean;
  timestamp: Date;
}

export interface ConsumptionResult {
  litersConsumed: number;
  kmTraveled: number;
  kmPerLiter: number | null;
  litersPer100Km: number | null;
}

@Injectable()
export class FuelCalculatorProcessor {
  /** Simple delta-based consumption between two fuel-level samples bracketing a distance. */
  calculate(start: FuelSample, end: FuelSample): ConsumptionResult {
    const litersConsumed = Math.max(0, (start.fuelLevel ?? 0) - (end.fuelLevel ?? 0));
    const kmTraveled = Math.max(0, (end.odometer ?? 0) - (start.odometer ?? 0));

    return {
      litersConsumed,
      kmTraveled,
      kmPerLiter: litersConsumed > 0 ? kmTraveled / litersConsumed : null,
      litersPer100Km: kmTraveled > 0 ? (litersConsumed / kmTraveled) * 100 : null,
    };
  }

  /** Fuel burned while ignition was on but the vehicle didn't move meaningfully. */
  idleConsumption(samples: FuelSample[]): number {
    let idleLiters = 0;
    for (let i = 1; i < samples.length; i++) {
      const prev = samples[i - 1];
      const curr = samples[i];
      const moved = (curr.odometer ?? 0) - (prev.odometer ?? 0) > 0.05; // 50m noise floor
      if (prev.ignition && !moved) {
        idleLiters += Math.max(0, (prev.fuelLevel ?? 0) - (curr.fuelLevel ?? 0));
      }
    }
    return idleLiters;
  }
}
