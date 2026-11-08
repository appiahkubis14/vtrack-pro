import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { Maintenance } from '../maintenance/entities/maintenance.entity';
import { Trip } from '../trips/entities/trip.entity';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { PredictiveMaintenanceEngine } from './engines/predictive.engine';
import { EfficiencyEngine } from './engines/efficiency.engine';

@Module({
  imports: [TypeOrmModule.forFeature([Vehicle, Maintenance, Trip])],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, PredictiveMaintenanceEngine, EfficiencyEngine],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
