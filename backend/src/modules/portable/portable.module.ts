import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PortableAsset } from './entities/portable-asset.entity';
import { AssetDeployment } from './entities/asset-deployment.entity';
import { DeploymentAuditLog } from './entities/deployment-audit-log.entity';
import { BatteryTelemetry } from './entities/battery-telemetry.entity';
import { DeviceSleepEvent } from './entities/device-sleep-event.entity';
import { WakeEvent } from './entities/wake-event.entity';
import { Device } from '../devices/entities/device.entity';
import { PortableAssetsController, DeploymentsController } from './portable-assets.controller';
import { PortableAssetsService } from './portable-assets.service';
import { CovertModePolicyEngine } from './engines/covert-mode-policy.engine';
import { BatteryIntelligenceEngine } from './engines/battery-intelligence.engine';
import { WakeSleepEngine } from './engines/wake-sleep.engine';
import { WakeSleepScheduler } from './wake-sleep.scheduler';
import { PortableTelemetryListener } from './portable-telemetry.listener';
import { AlertsModule } from '../alerts/alerts.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PortableAsset,
      AssetDeployment,
      DeploymentAuditLog,
      BatteryTelemetry,
      DeviceSleepEvent,
      WakeEvent,
      Device,
    ]),
    AlertsModule,
    RealtimeModule,
  ],
  controllers: [PortableAssetsController, DeploymentsController],
  providers: [
    PortableAssetsService,
    CovertModePolicyEngine,
    BatteryIntelligenceEngine,
    WakeSleepEngine,
    WakeSleepScheduler,
    PortableTelemetryListener,
  ],
  exports: [PortableAssetsService],
})
export class PortableModule {}
