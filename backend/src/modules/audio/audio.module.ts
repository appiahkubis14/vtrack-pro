import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AudioPolicy } from './entities/audio-policy.entity';
import { AudioConsent } from './entities/audio-consent.entity';
import { AudioSession } from './entities/audio-session.entity';
import { AudioClip } from './entities/audio-clip.entity';
import { AudioAccessLog } from './entities/audio-access-log.entity';
import { AudioEvidenceExport } from './entities/audio-evidence-export.entity';
import { AudioTranscript } from './entities/audio-transcript.entity';
import { AudioSessionsController } from './audio-sessions.controller';
import { AudioSessionsService } from './audio-sessions.service';
import { AudioConsentsController, AudioPoliciesController } from './audio-policy.controller';
import { AudioPolicyService } from './audio-policy.service';
import { AudioPolicyEngine } from './engines/audio-policy.engine';
import { EvidenceChainEngine } from './engines/evidence-chain.engine';
import { AudioStorageService } from './audio-storage.service';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AudioPolicy,
      AudioConsent,
      AudioSession,
      AudioClip,
      AudioAccessLog,
      AudioEvidenceExport,
      AudioTranscript,
    ]),
    RealtimeModule,
  ],
  controllers: [AudioSessionsController, AudioConsentsController, AudioPoliciesController],
  providers: [AudioSessionsService, AudioPolicyService, AudioPolicyEngine, EvidenceChainEngine, AudioStorageService],
  exports: [AudioSessionsService, AudioPolicyEngine],
})
export class AudioModule {}
