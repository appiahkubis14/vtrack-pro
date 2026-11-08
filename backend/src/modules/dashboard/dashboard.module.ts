import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from '../devices/entities/device.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { Alert } from '../alerts/entities/alert.entity';
import { Trip } from '../trips/entities/trip.entity';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { AttentionService } from './attention.service';
import { MapModule } from '../map/map.module';

@Module({
  imports: [TypeOrmModule.forFeature([Device, Vehicle, Alert, Trip]), MapModule],
  controllers: [DashboardController],
  providers: [DashboardService, AttentionService],
  exports: [DashboardService],
})
export class DashboardModule {}
