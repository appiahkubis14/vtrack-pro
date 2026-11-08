import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AudioPolicy } from './entities/audio-policy.entity';
import { AudioConsent } from './entities/audio-consent.entity';

@Injectable()
export class AudioPolicyService {
  constructor(
    @InjectRepository(AudioPolicy) private readonly policies: Repository<AudioPolicy>,
    @InjectRepository(AudioConsent) private readonly consents: Repository<AudioConsent>,
  ) {}

  listPolicies(organizationId: string) {
    return this.policies.find({ where: { organizationId } });
  }

  async setPolicy(organizationId: string, body: Partial<AudioPolicy>, setBy: string) {
    const existing = await this.policies.findOne({ where: { organizationId, country: body.country } });
    if (existing) {
      await this.policies.update(existing.id, { ...body, setBy } as any);
      return this.policies.findOne({ where: { id: existing.id } });
    }
    return this.policies.save(this.policies.create({ ...body, organizationId, setBy }));
  }

  listConsents(query: { organizationId?: string; driverId?: string } = {}) {
    return this.consents.find({
      where: {
        ...(query.organizationId ? { organizationId: query.organizationId } : {}),
        ...(query.driverId ? { driverId: query.driverId } : {}),
      },
      order: { grantedAt: 'DESC' },
    });
  }

  createConsent(body: Partial<AudioConsent> & { organizationId: string }, recordedBy: string) {
    return this.consents.save(this.consents.create({ ...body, recordedBy }));
  }

  async withdrawConsent(id: string, reason?: string) {
    const consent = await this.consents.findOne({ where: { id } });
    if (!consent) throw new NotFoundException(`Consent record ${id} not found`);
    await this.consents.update(id, { withdrawnAt: new Date(), withdrawalReason: reason });
    return this.consents.findOne({ where: { id } });
  }
}
