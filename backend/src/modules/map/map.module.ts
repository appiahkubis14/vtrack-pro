import { Module } from '@nestjs/common';
import { HubsModule } from '../hubs/hubs.module';
import { GeofencesModule } from '../geofences/geofences.module';
import { AlertsModule } from '../alerts/alerts.module';
import { PositionsModule } from '../positions/positions.module';
import { MapAdvancedController, TelemetryIngestController } from './advanced.controller';
import { AdvancedService } from './advanced.service';
import { DispatchService } from './dispatch.service';
import { TasksService } from './tasks.service';
import { MapController } from './map.controller';
import { MapService } from './map.service';
import { GeocodeService } from './geocode.service';
import { MapScopeService } from './map-scope.service';
import { MatchService } from './match.service';

@Module({
  imports: [HubsModule, GeofencesModule, AlertsModule, PositionsModule],
  controllers: [MapController, MapAdvancedController, TelemetryIngestController],
  providers: [MapService, GeocodeService, MapScopeService, MatchService, AdvancedService, DispatchService, TasksService],
  exports: [MapService, MapScopeService, MatchService],
})
export class MapModule {}
