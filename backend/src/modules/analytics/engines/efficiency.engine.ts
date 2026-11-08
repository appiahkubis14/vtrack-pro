import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trip } from '../../trips/entities/trip.entity';

export interface FleetEfficiencySummary {
  vehicleId: string;
  avgKmPerLiter: number | null;
  totalDistanceKm: number;
  totalFuelLiters: number;
  tripCount: number;
}

@Injectable()
export class EfficiencyEngine {
  constructor(@InjectRepository(Trip) private readonly trips: Repository<Trip>) {}

  async byVehicle(vehicleId: string): Promise<FleetEfficiencySummary> {
    const trips = await this.trips.find({ where: { vehicleId } });
    const totalDistanceKm = trips.reduce((s, t) => s + Number(t.distance ?? 0), 0);
    const totalFuelLiters = trips.reduce((s, t) => s + Number(t.fuelConsumed ?? 0), 0);

    return {
      vehicleId,
      totalDistanceKm,
      totalFuelLiters,
      tripCount: trips.length,
      avgKmPerLiter: totalFuelLiters > 0 ? totalDistanceKm / totalFuelLiters : null,
    };
  }

  /** Anomaly = trip efficiency more than 2x worse than the vehicle's own rolling average. */
  async detectAnomalies(vehicleId: string): Promise<Trip[]> {
    const trips = await this.trips.find({ where: { vehicleId }, order: { startTime: 'DESC' }, take: 50 });
    const withEfficiency = trips.filter((t) => t.fuelEfficiency);
    if (withEfficiency.length < 5) return [];

    const avg = withEfficiency.reduce((s, t) => s + Number(t.fuelEfficiency), 0) / withEfficiency.length;
    return withEfficiency.filter((t) => Number(t.fuelEfficiency) < avg / 2);
  }
}
