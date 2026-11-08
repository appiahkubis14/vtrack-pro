import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AudioSession, AudioSessionStatus, AudioSessionType } from './entities/audio-session.entity';
import { AudioClip } from './entities/audio-clip.entity';
import { AudioPolicyEngine } from './engines/audio-policy.engine';
import { EvidenceChainEngine } from './engines/evidence-chain.engine';
import { AudioStorageService } from './audio-storage.service';
import { Role } from '../../common/constants/roles.constant';
import { RealtimeEventsGateway } from '../realtime/realtime-events.gateway';
import { ServerEvents } from '../../common/constants/websocket-events.constant';

const ROLES_ALLOWED_TO_APPROVE_COVERT_AUDIO: Role[] = [Role.SUPER_ADMIN, Role.ORG_ADMIN];

export interface CreateAudioSessionInput {
  deviceId?: string;
  vehicleId?: string;
  driverId?: string;
  sessionType: AudioSessionType;
  triggerType?: string;
  country?: string;
  transcriptionEnabled?: boolean;
}

@Injectable()
export class AudioSessionsService {
  constructor(
    @InjectRepository(AudioSession) private readonly sessions: Repository<AudioSession>,
    @InjectRepository(AudioClip) private readonly clips: Repository<AudioClip>,
    private readonly policyEngine: AudioPolicyEngine,
    private readonly evidenceChain: EvidenceChainEngine,
    private readonly storage: AudioStorageService,
    private readonly realtimeGateway: RealtimeEventsGateway,
  ) {}

  findAll(query: { organizationId?: string; vehicleId?: string; status?: AudioSessionStatus; limit?: number } = {}) {
    return this.sessions.find({
      where: {
        ...(query.organizationId ? { organizationId: query.organizationId } : {}),
        ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      order: { createdAt: 'DESC' },
      take: query.limit ?? 100,
    });
  }

  async findOne(id: string) {
    const session = await this.sessions.findOne({ where: { id } });
    if (!session) throw new NotFoundException(`Audio session ${id} not found`);
    return session;
  }

  /**
   * Every session, regardless of trigger, passes through
   * AudioPolicyEngine.checkSessionAllowed() first. A denied check still
   * creates a session row (status='policy_denied' or 'consent_missing')
   * rather than throwing silently - there's always an auditable record that
   * recording was attempted and refused.
   */
  async create(input: CreateAudioSessionInput, organizationId: string, createdBy: string) {
    const check = await this.policyEngine.checkSessionAllowed(organizationId, input.sessionType, input.driverId, input.country);

    if (!check.allowed) {
      const session = await this.sessions.save(
        this.sessions.create({
          ...input,
          organizationId,
          createdBy,
          status: check.reason?.includes('consent') ? AudioSessionStatus.CONSENT_MISSING : AudioSessionStatus.POLICY_DENIED,
          denialReason: check.reason,
        }),
      );

      if (check.reason?.includes('consent')) {
        this.realtimeGateway.emit(organizationId, ServerEvents.AUDIO_CONSENT_REQUIRED, {
          sessionId: session.id,
          driverId: input.driverId,
          reason: check.reason,
        });
      }

      throw new ForbiddenException({ message: check.reason, sessionId: session.id });
    }

    const session = await this.sessions.save(
      this.sessions.create({
        ...input,
        organizationId,
        createdBy,
        consentId: check.consentId,
        legalBasis: check.legalBasis,
        status: check.requiresApproval ? AudioSessionStatus.REQUESTED : AudioSessionStatus.RECORDING,
        startTime: check.requiresApproval ? undefined : new Date(),
      }),
    );

    if (!check.requiresApproval) {
      this.realtimeGateway.emit(organizationId, ServerEvents.AUDIO_SESSION_STARTED, {
        sessionId: session.id,
        vehicleId: input.vehicleId,
        sessionType: input.sessionType,
      });
    }

    return session;
  }

  /** Covert sessions (policy status = covert_requires_approval) need explicit sign-off before recording actually starts. */
  async approveSession(sessionId: string, approverId: string, approverRole: Role) {
    if (!ROLES_ALLOWED_TO_APPROVE_COVERT_AUDIO.includes(approverRole)) {
      throw new ForbiddenException(`Role "${approverRole}" cannot approve covert audio sessions`);
    }
    const session = await this.findOne(sessionId);
    if (session.status !== AudioSessionStatus.REQUESTED) {
      throw new ForbiddenException(`Session is in status "${session.status}", not awaiting approval`);
    }
    if (session.createdBy === approverId) {
      throw new ForbiddenException('The requester cannot approve their own covert audio session');
    }

    await this.sessions.update(sessionId, {
      approvedBy: approverId,
      approvedAt: new Date(),
      status: AudioSessionStatus.RECORDING,
      startTime: new Date(),
    });

    this.realtimeGateway.emit(session.organizationId, ServerEvents.AUDIO_SESSION_STARTED, {
      sessionId,
      vehicleId: session.vehicleId,
      sessionType: session.sessionType,
      approvedBy: approverId,
    });

    return this.findOne(sessionId);
  }

  /** Called when the device finishes uploading a clip. Hashes the real audio bytes immediately - evidence integrity starts at ingestion. */
  async ingestClip(sessionId: string, audioBuffer: Buffer, recordedAt: Date, latitude?: number, longitude?: number) {
    const session = await this.findOne(sessionId);
    if (session.status !== AudioSessionStatus.RECORDING) {
      throw new ForbiddenException(`Cannot ingest audio for a session in status "${session.status}"`);
    }

    const hash = this.evidenceChain.hashAudioBuffer(audioBuffer);
    const existingCount = await this.clips.count({ where: { sessionId } });
    const storagePath = await this.storage.save(sessionId, existingCount, audioBuffer);

    return this.clips.save(
      this.clips.create({
        sessionId,
        clipIndex: existingCount,
        storageLocation: storagePath,
        fileSizeBytes: audioBuffer.length,
        sha256Hash: hash,
        recordedAt,
        latitude,
        longitude,
      }),
    );
  }

  async endSession(sessionId: string) {
    const session = await this.findOne(sessionId);
    const clipCount = await this.clips.count({ where: { sessionId } });
    const totalBytes = await this.clips
      .createQueryBuilder('c')
      .select('COALESCE(SUM(c.file_size_bytes), 0)', 'total')
      .where('c.session_id = :sessionId', { sessionId })
      .getRawOne();

    const endTime = new Date();
    const durationSeconds = session.startTime ? Math.round((endTime.getTime() - session.startTime.getTime()) / 1000) : 0;

    await this.sessions.update(sessionId, {
      status: AudioSessionStatus.COMPLETED,
      endTime,
      durationSeconds,
      fileSizeBytes: Number(totalBytes.total),
    });

    this.realtimeGateway.emit(session.organizationId, ServerEvents.AUDIO_SESSION_ENDED, {
      sessionId,
      vehicleId: session.vehicleId,
      durationSeconds,
      clipCount,
    });

    return { ...(await this.findOne(sessionId)), clipCount };
  }

  clipsForSession(sessionId: string) {
    return this.clips.find({ where: { sessionId }, order: { clipIndex: 'ASC' } });
  }
}
