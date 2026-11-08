import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SimProfile } from './entities/sim-profile.entity';
import { SimAssignmentHistory } from './entities/sim-assignment-history.entity';
import { RoamingEvent } from './entities/roaming-event.entity';
import { CountryBoundary } from './entities/country-boundary.entity';
import { TravelCorridor } from './entities/travel-corridor.entity';
import { BorderCrossing } from './entities/border-crossing.entity';
import { CorridorEvent } from './entities/corridor-event.entity';
import { Device } from '../devices/entities/device.entity';
import { SimProfilesController, RoamingController } from './sim-profiles.controller';
import { SimWebhookController } from './sim-webhook.controller';
import { BorderCrossingsController, TravelCorridorsController } from './corridors.controller';
import { SimProfilesService } from './sim-profiles.service';
import { CorridorsService } from './corridors.service';
import { BorderCrossingEngine } from './engines/border-crossing.engine';
import { AlertsModule } from '../alerts/alerts.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SimProfile,
      SimAssignmentHistory,
      RoamingEvent,
      CountryBoundary,
      TravelCorridor,
      BorderCrossing,
      CorridorEvent,
      Device,
    ]),
    AlertsModule,
    RealtimeModule,
  ],
  controllers: [SimProfilesController, RoamingController, SimWebhookController, BorderCrossingsController, TravelCorridorsController],
  providers: [SimProfilesService, CorridorsService, BorderCrossingEngine],
  exports: [SimProfilesService, BorderCrossingEngine],
})
export class RoamingModule {}
