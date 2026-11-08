import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Trip } from './entities/trip.entity';
import { Position } from '../devices/entities/position.entity';
import { Device } from '../devices/entities/device.entity';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';
import { TripDetectionProcessor } from './processors/trip-detection.processor';
import { TripAnalyzerProcessor } from './processors/trip-analyzer.processor';
import { MapMatchingEngine } from './engines/map-matching.engine';
import { GeospatialController, TripGeospatialController } from './geospatial.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Trip, Device]), TypeOrmModule.forFeature([Position], 'timescale')],
  controllers: [TripsController, GeospatialController, TripGeospatialController],
  providers: [TripsService, TripDetectionProcessor, TripAnalyzerProcessor, MapMatchingEngine],
  exports: [TripsService, MapMatchingEngine],
})
export class TripsModule {}
