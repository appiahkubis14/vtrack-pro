import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { AudioClip } from '../entities/audio-clip.entity';
import { AudioEvidenceExport, ChainOfCustodyEntry } from '../entities/audio-evidence-export.entity';
import { AudioAccessLog } from '../entities/audio-access-log.entity';

@Injectable()
export class EvidenceChainEngine {
  constructor(
    @InjectRepository(AudioClip) private readonly clips: Repository<AudioClip>,
    @InjectRepository(AudioEvidenceExport) private readonly exports: Repository<AudioEvidenceExport>,
    @InjectRepository(AudioAccessLog) private readonly accessLogs: Repository<AudioAccessLog>,
  ) {}

  /** Real SHA-256 over the actual audio bytes - called when a clip is first stored. */
  hashAudioBuffer(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /** Verifies a clip's stored hash still matches its current bytes - detects any post-storage tampering. */
  verifyClipIntegrity(clip: AudioClip, currentBuffer: Buffer): boolean {
    return this.hashAudioBuffer(currentBuffer) === clip.sha256Hash;
  }

  /**
   * Builds a formal evidence export: verifies every clip's hash against its
   * recorded value (refuses to export if any clip fails integrity check),
   * then hashes the whole bundle so the export itself has a single
   * verifiable fingerprint distinct from any individual clip's hash.
   */
  async createExport(
    sessionId: string,
    clipBuffers: Map<string, Buffer>,
    exportedBy: string,
    caseReference?: string,
  ): Promise<AudioEvidenceExport> {
    const clips = await this.clips.find({ where: { sessionId }, order: { clipIndex: 'ASC' } });
    if (!clips.length) throw new BadRequestException('No audio clips exist for this session - nothing to export');

    const chainOfCustody: ChainOfCustodyEntry[] = [];
    for (const clip of clips) {
      const buffer = clipBuffers.get(clip.id);
      if (!buffer) {
        throw new BadRequestException(`Missing audio bytes for clip ${clip.id} - cannot verify integrity before export`);
      }
      if (!this.verifyClipIntegrity(clip, buffer)) {
        throw new BadRequestException(
          `Clip ${clip.id} failed integrity verification - stored hash does not match current file contents. Export refused.`,
        );
      }
      chainOfCustody.push({ clipId: clip.id, originalHash: clip.sha256Hash, verifiedAt: new Date().toISOString() });
    }

    const bundleFingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify({ sessionId, caseReference, chain: chainOfCustody.map((c) => c.originalHash).sort() }))
      .digest('hex');

    const exportRecord = await this.exports.save(
      this.exports.create({ sessionId, exportedBy, caseReference, exportHash: bundleFingerprint, chainOfCustody }),
    );

    for (const clip of clips) {
      await this.accessLogs.save(
        this.accessLogs.create({
          clipId: clip.id,
          sessionId,
          accessedBy: exportedBy,
          accessType: 'export',
          justification: caseReference ? `Evidence export for case ${caseReference}` : 'Evidence export',
        }),
      );
    }

    return exportRecord;
  }

  async logAccess(
    clipId: string,
    sessionId: string | undefined,
    accessedBy: string,
    accessType: 'playback' | 'download' | 'transcript_view',
    ipAddress?: string,
  ) {
    return this.accessLogs.save(this.accessLogs.create({ clipId, sessionId, accessedBy, accessType, ipAddress }));
  }

  accessHistory(clipId: string) {
    return this.accessLogs.find({ where: { clipId }, order: { createdAt: 'DESC' } });
  }
}
