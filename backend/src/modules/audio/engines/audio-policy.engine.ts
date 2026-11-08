import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AudioPolicy, AudioPolicyStatus } from '../entities/audio-policy.entity';
import { AudioConsent } from '../entities/audio-consent.entity';
import { AudioSessionType } from '../entities/audio-session.entity';

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
  requiresApproval: boolean;
  legalBasis?: string;
  consentId?: string;
}

/**
 * The single choke point every audio session must pass through before any
 * recording happens. "No policy row exists" and "policy status is disabled"
 * both resolve to DISABLED - there is no code path where audio recording is
 * possible without an organization having explicitly opted in. This is
 * deliberate: the spec is explicit that audio must not be assumed legal.
 */
@Injectable()
export class AudioPolicyEngine {
  constructor(
    @InjectRepository(AudioPolicy) private readonly policies: Repository<AudioPolicy>,
    @InjectRepository(AudioConsent) private readonly consents: Repository<AudioConsent>,
  ) {}

  async resolvePolicy(organizationId: string, country?: string): Promise<AudioPolicy> {
    if (country) {
      const countrySpecific = await this.policies.findOne({ where: { organizationId, country } });
      if (countrySpecific) return countrySpecific;
    }
    const orgDefault = await this.policies.findOne({ where: { organizationId, country: undefined } });
    if (orgDefault) return orgDefault;

    // No policy configured at all - synthesize a DISABLED policy rather than
    // treating "not configured" as "no restriction." This is the load-bearing
    // safety default: a brand-new organization cannot record audio until
    // someone explicitly sets a policy.
    return this.policies.create({ organizationId, country, status: AudioPolicyStatus.DISABLED, retentionDays: 90 });
  }

  async checkSessionAllowed(
    organizationId: string,
    sessionType: AudioSessionType,
    driverId: string | undefined,
    country: string | undefined,
  ): Promise<PolicyCheckResult> {
    const policy = await this.resolvePolicy(organizationId, country);

    if (policy.status === AudioPolicyStatus.DISABLED) {
      return { allowed: false, reason: 'Audio monitoring is disabled for this organization', requiresApproval: false };
    }

    if (policy.status === AudioPolicyStatus.PROHIBITED_BY_JURISDICTION) {
      return {
        allowed: false,
        reason: `Audio recording is prohibited in ${country ?? 'this jurisdiction'} per configured policy`,
        requiresApproval: false,
      };
    }

    if (policy.status === AudioPolicyStatus.ENABLED_FOR_SOS_ONLY && sessionType !== AudioSessionType.SOS_TRIGGERED) {
      return {
        allowed: false,
        reason: `Policy only permits SOS-triggered recording; "${sessionType}" is not allowed`,
        requiresApproval: false,
      };
    }

    if (
      policy.status === AudioPolicyStatus.ENABLED_FOR_SECURITY_INCIDENTS &&
      ![AudioSessionType.SOS_TRIGGERED, AudioSessionType.INCIDENT_TRIGGERED].includes(sessionType)
    ) {
      return {
        allowed: false,
        reason: `Policy only permits SOS/incident-triggered recording; "${sessionType}" is not allowed`,
        requiresApproval: false,
      };
    }

    if (policy.status === AudioPolicyStatus.COVERT_REQUIRES_APPROVAL) {
      return { allowed: true, requiresApproval: true, legalBasis: 'covert_approved' };
    }

    if (driverId) {
      const consent = await this.findActiveConsent(driverId);
      if (!consent) {
        return { allowed: false, reason: `No active consent on file for driver ${driverId}`, requiresApproval: false };
      }
      return { allowed: true, requiresApproval: false, legalBasis: consent.legalBasis, consentId: consent.id };
    }

    // SOS-triggered sessions with no specific driver context (e.g. an
    // anonymous panic-button press) are allowed through on the policy's own
    // authority without per-driver consent - can't require pre-existing
    // consent for an emergency you can't predict.
    if (sessionType === AudioSessionType.SOS_TRIGGERED) {
      return { allowed: true, requiresApproval: false, legalBasis: 'emergency_exception' };
    }

    return { allowed: false, reason: 'No driver context and no emergency exception applies', requiresApproval: false };
  }

  private async findActiveConsent(driverId: string): Promise<AudioConsent | null> {
    const consent = await this.consents.findOne({ where: { driverId }, order: { grantedAt: 'DESC' } });
    if (!consent) return null;
    if (consent.withdrawnAt) return null;
    if (consent.expiresAt && consent.expiresAt < new Date()) return null;
    return consent;
  }
}
