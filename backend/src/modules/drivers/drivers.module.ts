import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Driver } from './entities/driver.entity';
import { DriverAssignment } from './entities/driver-assignment.entity';
import { DriverScore } from './entities/driver-score.entity';
import { Trip } from '../trips/entities/trip.entity';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';
import { DriverScoringProcessor } from './processors/driver-scoring.processor';
import { HosTrackerProcessor } from './processors/hos-tracker.processor';

@Module({
  imports: [TypeOrmModule.forFeature([Driver, DriverAssignment, DriverScore, Trip])],
  controllers: [DriversController],
  providers: [DriversService, DriverScoringProcessor, HosTrackerProcessor],
  exports: [DriversService],
})
export class DriversModule {}
