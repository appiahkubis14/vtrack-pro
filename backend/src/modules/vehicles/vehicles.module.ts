import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vehicle } from './entities/vehicle.entity';
import { Maintenance } from '../maintenance/entities/maintenance.entity';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';
import { VehicleHistoryService } from './vehicle-history.service';
import { MapModule } from '../map/map.module';

@Module({
  imports: [TypeOrmModule.forFeature([Vehicle, Maintenance]), MapModule],
  controllers: [VehiclesController],
  providers: [VehiclesService, VehicleHistoryService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
