import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Rider } from '../ev-fleet/entities/rider.entity';
import { RiderAssignment } from './entities/rider-assignment.entity';
import { Battery, BatterySwap, ChargeEvent } from './entities/battery.entity';
import { DailyCollection } from './entities/daily-collection.entity';
import { HubsModule } from '../hubs/hubs.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';

@Module({
  imports: [TypeOrmModule.forFeature([Rider, RiderAssignment, Battery, BatterySwap, ChargeEvent, DailyCollection]), HubsModule],
  controllers: [OperationsController],
  providers: [OperationsService],
  exports: [OperationsService],
})
export class OperationsModule {}
