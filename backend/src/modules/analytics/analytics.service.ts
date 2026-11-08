import { Injectable, NotImplementedException } from '@nestjs/common';
import { PredictiveMaintenanceEngine } from './engines/predictive.engine';
import { EfficiencyEngine } from './engines/efficiency.engine';

const DEFAULT_INTERVALS_KM: Record<string, number> = {
  oil_change: 8000,
  tire_rotation: 10000,
  brake_service: 25000,
};

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly predictiveEngine: PredictiveMaintenanceEngine,
    private readonly efficiencyEngine: EfficiencyEngine,
  ) {}

  async predictiveMaintenance(query?: { vehicleId?: string; serviceType?: string }) {
    if (!query?.vehicleId) throw new NotImplementedException('vehicleId query param is required');
    const serviceType = query.serviceType ?? 'oil_change';
    const intervalKm = DEFAULT_INTERVALS_KM[serviceType] ?? 10000;
    return this.predictiveEngine.predict(query.vehicleId, serviceType, intervalKm);
  }

  async driverRisk(query?: { driverId?: string }) {
    // TODO: combine DriverScoringProcessor history with HosTrackerProcessor
    // violations into a single risk index per driver. Not wired yet -
    // both processors currently live in DriversModule; either export them
    // or move the composite calculation into DriversService and call it here.
    throw new NotImplementedException('driverRisk not wired yet - see TODO in analytics.service.ts');
  }

  async fuelForecast(query?: { vehicleId?: string }) {
    if (!query?.vehicleId) throw new NotImplementedException('vehicleId query param is required');
    return this.efficiencyEngine.byVehicle(query.vehicleId);
  }

  async anomalies(query?: { vehicleId?: string }) {
    if (!query?.vehicleId) throw new NotImplementedException('vehicleId query param is required');
    return this.efficiencyEngine.detectAnomalies(query.vehicleId);
  }
}
