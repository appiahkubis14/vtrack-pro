import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Maintenance } from '../../maintenance/entities/maintenance.entity';
import { Vehicle } from '../../vehicles/entities/vehicle.entity';

export interface MaintenancePrediction {
  vehicleId: string;
  serviceType: string;
  predictedDueOdometer: number;
  predictedDueDate: Date | null;
  confidence: 'low' | 'medium' | 'high';
}

/**
 * Naive linear predictor: average km/day over the vehicle's maintenance
 * history, projected forward to the next mileage-based service interval.
 * Swap in a real regression/ML model once you have enough historical data
 * per vehicle (a few dozen completed services minimum) - this is a
 * placeholder that keeps the /analytics/predictive-maintenance endpoint
 * honest rather than returning hardcoded numbers.
 */
@Injectable()
export class PredictiveMaintenanceEngine {
  constructor(
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(Maintenance) private readonly maintenance: Repository<Maintenance>,
  ) {}

  async predict(vehicleId: string, serviceType: string, intervalKm: number): Promise<MaintenancePrediction> {
    const vehicle = await this.vehicles.findOneOrFail({ where: { id: vehicleId } });
    const history = await this.maintenance.find({
      where: { vehicleId, serviceType },
      order: { completedDate: 'ASC' },
      take: 10,
    });

    const kmPerDay = this.estimateKmPerDay(history, Number(vehicle.odometer));
    const lastOdometer = history[history.length - 1]?.odometerAtService ?? 0;
    const predictedDueOdometer = Number(lastOdometer) + intervalKm;
    const kmRemaining = predictedDueOdometer - Number(vehicle.odometer);
    const daysRemaining = kmPerDay > 0 ? kmRemaining / kmPerDay : null;

    return {
      vehicleId,
      serviceType,
      predictedDueOdometer,
      predictedDueDate: daysRemaining ? new Date(Date.now() + daysRemaining * 86_400_000) : null,
      confidence: history.length >= 5 ? 'medium' : 'low',
    };
  }

  private estimateKmPerDay(history: Maintenance[], currentOdometer: number): number {
    if (history.length < 2) return 0;
    const first = history[0];
    const daysSinceFirst =
      (Date.now() - new Date(first.completedDate ?? first.createdAt).getTime()) / 86_400_000;
    if (daysSinceFirst <= 0) return 0;
    return (currentOdometer - Number(first.odometerAtService ?? 0)) / daysSinceFirst;
  }
}
