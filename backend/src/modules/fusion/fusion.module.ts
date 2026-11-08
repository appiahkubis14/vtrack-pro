import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VehicleDevice } from './entities/vehicle-device.entity';
import { DeviceTelemetrySource } from './entities/device-telemetry-source.entity';
import { Device } from '../devices/entities/device.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { FusionController } from './fusion.controller';
import { FleetGraphController } from './fleet-graph.controller';
import { SensorFusionService } from './sensor-fusion.service';
import { FleetGraphService } from './fleet-graph.service';
import { TwinModule } from '../twin/twin.module';

@Module({
  imports: [TypeOrmModule.forFeature([VehicleDevice, DeviceTelemetrySource, Device, Vehicle]), TwinModule],
  controllers: [FusionController, FleetGraphController],
  providers: [SensorFusionService, FleetGraphService],
  exports: [SensorFusionService, FleetGraphService],
})
export class FusionModule {}
