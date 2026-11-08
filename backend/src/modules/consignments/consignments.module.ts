import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Consignment, ConsignmentLine } from './entities/consignment.entity';
import { Supplier } from './entities/supplier.entity';
import { WriteOff } from './entities/write-off.entity';
import { VehicleModel } from './entities/vehicle-model.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { ConsignmentsController } from './consignments.controller';
import { ConsignmentsService } from './consignments.service';

@Module({
  imports: [TypeOrmModule.forFeature([Consignment, ConsignmentLine, VehicleModel, Vehicle, Supplier, WriteOff])],
  controllers: [ConsignmentsController],
  providers: [ConsignmentsService],
  exports: [ConsignmentsService],
})
export class ConsignmentsModule {}
