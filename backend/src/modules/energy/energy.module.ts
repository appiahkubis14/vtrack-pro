import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EvState } from './entities/ev-state.entity';
import { ChargingSession } from './entities/charging-session.entity';
import { ChargeSchedule } from './entities/charge-schedule.entity';
import { EnergyConsumptionStat } from './entities/energy-consumption-stat.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { EnergyController, EvFleetController, ChargingSessionsController } from './energy.controller';
import { EnergyService } from './energy.service';
import { SmartChargingScheduler } from './engines/smart-charging.scheduler';
import { EnergyMetricsEngine } from './engines/energy-metrics.engine';
import { TwinModule } from '../twin/twin.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([EvState, ChargingSession, ChargeSchedule, EnergyConsumptionStat, Vehicle]),
    TwinModule,
  ],
  controllers: [EnergyController, EvFleetController, ChargingSessionsController],
  providers: [EnergyService, SmartChargingScheduler, EnergyMetricsEngine],
  exports: [EnergyService],
})
export class EnergyModule {}
