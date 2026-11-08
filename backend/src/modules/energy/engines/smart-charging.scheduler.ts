import { Injectable } from '@nestjs/common';

export interface SmartChargeInput {
  currentSoc: number; // 0-100
  targetSoc: number; // 0-100
  departureTime: Date;
  batteryCapacityKwh: number;
  chargerPowerKw: number; // max power the plugged-in charger can deliver
  electricityPriceSchedule: Array<{ hour: number; pricePerKwh: number }>; // 24 entries, hour 0-23, local time
  now?: Date;
  batteryTempC?: number; // charging is throttled/avoided outside a safe band
  minSafeTempC?: number;
  maxSafeTempC?: number;
}

export interface SmartChargeOutput {
  recommendedStartTime: Date;
  recommendedEndTime: Date;
  estimatedCost: number;
  estimatedSohImpactPct: number;
  recommendedChargeLimitPct: number;
  hourlyPlan: Array<{ hour: number; date: string; energyKwh: number; pricePerKwh: number; cost: number }>;
  warnings: string[];
}

const DEFAULT_MIN_SAFE_TEMP_C = 0;
const DEFAULT_MAX_SAFE_TEMP_C = 45;
// Charging above ~90% and/or in temperature extremes accelerates degradation -
// a simplified, monotonic penalty curve, not a physics model. Calibrate
// against your battery vendor's degradation curves before using this for
// anything beyond a rough estimate.
const HIGH_SOC_DEGRADATION_THRESHOLD = 90;

@Injectable()
export class SmartChargingScheduler {
  /**
   * Greedy cheapest-hours-first scheduler: given the energy needed and a
   * deadline, fill the cheapest available hours between now and departure
   * first, subject to charger power limits. This is optimal for a single
   * vehicle with no grid-demand constraints; for fleet-wide coordination
   * (many vehicles competing for a shared circuit's capacity), swap this for
   * a proper LP/MILP solver - the greedy approach doesn't account for
   * cross-vehicle contention.
   */
  plan(input: SmartChargeInput): SmartChargeOutput {
    const now = input.now ?? new Date();
    const warnings: string[] = [];

    const socToAdd = Math.max(0, input.targetSoc - input.currentSoc);
    const energyNeededKwh = (socToAdd / 100) * input.batteryCapacityKwh;

    if (energyNeededKwh === 0) {
      return {
        recommendedStartTime: now,
        recommendedEndTime: now,
        estimatedCost: 0,
        estimatedSohImpactPct: 0,
        recommendedChargeLimitPct: input.targetSoc,
        hourlyPlan: [],
        warnings: ['Already at or above target SoC.'],
      };
    }

    const minTemp = input.minSafeTempC ?? DEFAULT_MIN_SAFE_TEMP_C;
    const maxTemp = input.maxSafeTempC ?? DEFAULT_MAX_SAFE_TEMP_C;
    if (input.batteryTempC !== undefined && (input.batteryTempC < minTemp || input.batteryTempC > maxTemp)) {
      warnings.push(
        `Battery temperature ${input.batteryTempC}°C is outside the safe charging band (${minTemp}-${maxTemp}°C) - consider preconditioning before charging.`,
      );
    }

    // Build the list of candidate hourly slots between now and departure.
    const slots = this.buildHourlySlots(now, input.departureTime, input.electricityPriceSchedule);
    if (!slots.length) {
      warnings.push('No time available between now and departure - charging must start immediately.');
    }

    // Sort cheapest-first, fill until energy need is met, then reorder the
    // selected slots back into chronological order for the actual plan.
    const cheapestFirst = [...slots].sort((a, b) => a.pricePerKwh - b.pricePerKwh);
    const selected: typeof slots = [];
    let remainingKwh = energyNeededKwh;

    for (const slot of cheapestFirst) {
      if (remainingKwh <= 0) break;
      const slotEnergyKwh = Math.min(input.chargerPowerKw, remainingKwh);
      selected.push({ ...slot, energyKwh: slotEnergyKwh });
      remainingKwh -= slotEnergyKwh;
    }

    if (remainingKwh > 0) {
      warnings.push(
        `Charger power (${input.chargerPowerKw}kW) and available time cannot fully reach ${input.targetSoc}% SoC by departure - ${remainingKwh.toFixed(1)}kWh short.`,
      );
    }

    selected.sort((a, b) => a.start.getTime() - b.start.getTime());
    const hourlyPlan = selected.map((s) => ({
      hour: s.start.getHours(),
      date: s.start.toISOString().slice(0, 10),
      energyKwh: Math.round(s.energyKwh * 100) / 100,
      pricePerKwh: s.pricePerKwh,
      cost: Math.round(s.energyKwh * s.pricePerKwh * 100) / 100,
    }));

    const estimatedCost = hourlyPlan.reduce((sum, s) => sum + s.cost, 0);
    const recommendedStartTime = selected[0]?.start ?? now;
    const recommendedEndTime = selected[selected.length - 1]?.end ?? now;

    const achievedSoc = input.currentSoc + ((energyNeededKwh - Math.max(0, remainingKwh)) / input.batteryCapacityKwh) * 100;
    const recommendedChargeLimitPct = Math.min(input.targetSoc, 100);

    let estimatedSohImpactPct = 0.01; // baseline negligible impact per session
    if (achievedSoc > HIGH_SOC_DEGRADATION_THRESHOLD) {
      estimatedSohImpactPct += (achievedSoc - HIGH_SOC_DEGRADATION_THRESHOLD) * 0.005;
      warnings.push(
        `Target SoC ${input.targetSoc}% is above ${HIGH_SOC_DEGRADATION_THRESHOLD}% - consider a lower daily limit and reserving 100% charges for long trips.`,
      );
    }

    return {
      recommendedStartTime,
      recommendedEndTime,
      estimatedCost: Math.round(estimatedCost * 100) / 100,
      estimatedSohImpactPct: Math.round(estimatedSohImpactPct * 10000) / 10000,
      recommendedChargeLimitPct,
      hourlyPlan,
      warnings,
    };
  }

  private buildHourlySlots(
    now: Date,
    departureTime: Date,
    priceSchedule: Array<{ hour: number; pricePerKwh: number }>,
  ): Array<{ start: Date; end: Date; pricePerKwh: number; energyKwh: number }> {
    const priceByHour = new Map(priceSchedule.map((p) => [p.hour, p.pricePerKwh]));
    const slots: Array<{ start: Date; end: Date; pricePerKwh: number; energyKwh: number }> = [];

    const cursor = new Date(now);
    cursor.setMinutes(0, 0, 0);
    if (cursor < now) cursor.setHours(cursor.getHours() + 1);

    while (cursor < departureTime) {
      const end = new Date(cursor.getTime() + 3600_000);
      slots.push({
        start: new Date(cursor),
        end,
        pricePerKwh: priceByHour.get(cursor.getHours()) ?? this.averagePrice(priceSchedule),
        energyKwh: 0,
      });
      cursor.setHours(cursor.getHours() + 1);
    }

    return slots;
  }

  private averagePrice(schedule: Array<{ hour: number; pricePerKwh: number }>): number {
    if (!schedule.length) return 0.15; // arbitrary fallback if no schedule was provided at all
    return schedule.reduce((sum, p) => sum + p.pricePerKwh, 0) / schedule.length;
  }
}
