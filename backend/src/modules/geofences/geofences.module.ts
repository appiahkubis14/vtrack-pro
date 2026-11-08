import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Geofence } from './entities/geofence.entity';
import { GeofenceEvent } from './entities/geofence-event.entity';
import { GeofenceDeviceState } from './entities/geofence-device-state.entity';
import { Device } from '../devices/entities/device.entity';
import { Position } from '../devices/entities/position.entity';
import { AuthModule } from '../auth/auth.module';
import { GeofencesController } from './geofences.controller';
import { GeofencesService } from './geofences.service';
import { GeofenceCheckerEngine } from './engines/geofence-checker.engine';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [TypeOrmModule.forFeature([Geofence, GeofenceEvent, GeofenceDeviceState, Device]), TypeOrmModule.forFeature([Position], 'timescale'), AlertsModule, AuthModule],
  controllers: [GeofencesController],
  providers: [GeofencesService, GeofenceCheckerEngine],
  exports: [GeofencesService],
})
export class GeofencesModule {}
