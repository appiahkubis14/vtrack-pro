import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TheftCase } from './entities/theft-case.entity';
import { RecoveryTeam } from './entities/recovery-team.entity';
import { RecoveryEvent } from './entities/recovery-event.entity';
import { RecoveryAction } from './entities/recovery-action.entity';
import { RecoveryNote } from './entities/recovery-note.entity';
import { Device } from '../devices/entities/device.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { TheftRecoveryController } from './theft-recovery.controller';
import { RecoveryTeamsController } from './recovery-teams.controller';
import { TheftRecoveryService } from './theft-recovery.service';
import { ImmobilizerSafetyEngine } from './engines/immobilizer-safety.engine';
import { JammingDetectionEngine } from './engines/jamming-detection.engine';
import { TwinModule } from '../twin/twin.module';
import { CommandsModule } from '../commands/commands.module';
import { AlertsModule } from '../alerts/alerts.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TheftCase, RecoveryTeam, RecoveryEvent, RecoveryAction, RecoveryNote, Device, Vehicle]),
    TwinModule,
    CommandsModule,
    AlertsModule,
    RealtimeModule,
  ],
  controllers: [TheftRecoveryController, RecoveryTeamsController],
  providers: [TheftRecoveryService, ImmobilizerSafetyEngine, JammingDetectionEngine],
  exports: [TheftRecoveryService],
})
export class TheftRecoveryModule {}
