import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Maintenance } from './entities/maintenance.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';
import { MaintenanceSchedulerProcessor } from './processors/maintenance-scheduler';

@Module({
  imports: [TypeOrmModule.forFeature([Maintenance, Vehicle])],
  controllers: [MaintenanceController],
  providers: [MaintenanceService, MaintenanceSchedulerProcessor],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
