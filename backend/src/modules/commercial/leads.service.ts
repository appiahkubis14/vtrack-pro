import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead, LeadStatus } from './entities/lead.entity';
import { LeadEvent } from './entities/lead-event.entity';
import { RealtimeEventsGateway } from '../realtime/realtime-events.gateway';
import { ServerEvents } from '../../common/constants/websocket-events.constant';

const VALID_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  [LeadStatus.NEW]: [LeadStatus.CONTACTED, LeadStatus.QUALIFIED, LeadStatus.QUOTE_SENT, LeadStatus.WON, LeadStatus.LOST, LeadStatus.ARCHIVED],
  [LeadStatus.CONTACTED]: [LeadStatus.QUALIFIED, LeadStatus.QUOTE_SENT, LeadStatus.WON, LeadStatus.LOST, LeadStatus.ARCHIVED],
  [LeadStatus.QUALIFIED]: [LeadStatus.QUOTE_SENT, LeadStatus.WON, LeadStatus.LOST],
  [LeadStatus.QUOTE_SENT]: [LeadStatus.NEGOTIATING, LeadStatus.WON, LeadStatus.LOST, LeadStatus.QUOTE_SENT],
  [LeadStatus.NEGOTIATING]: [LeadStatus.WON, LeadStatus.LOST, LeadStatus.QUOTE_SENT],
  [LeadStatus.WON]: [LeadStatus.ARCHIVED],
  [LeadStatus.LOST]: [LeadStatus.ARCHIVED, LeadStatus.CONTACTED], // re-engagement path
  [LeadStatus.ARCHIVED]: [],
};

@Injectable()
export class LeadsService {
  constructor(
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(LeadEvent) private readonly events: Repository<LeadEvent>,
    private readonly realtimeGateway: RealtimeEventsGateway,
  ) {}

  // NOTE on `leadCreated` (spec's WebSocket event list): leads have no
  // organization_id - they belong to internal sales staff working across
  // all prospective customers, not to a customer's tenant. The
  // RealtimeEventsGateway's org-room broadcast pattern (used by every other
  // v2.1 event) genuinely doesn't fit here without inventing a fake org
  // association. A real implementation needs a distinct "sales team" room
  // that staff join regardless of which (if any) customer org they're
  // currently viewing - not built here to avoid broadcasting to the wrong
  // audience under a technically-passing but semantically wrong event.

  findAll(query: { status?: LeadStatus; assignedTo?: string; limit?: number } = {}) {
    return this.leads.find({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.assignedTo ? { assignedTo: query.assignedTo } : {}),
      },
      order: { createdAt: 'DESC' },
      take: query.limit ?? 100,
    });
  }

  async findOne(id: string) {
    const lead = await this.leads.findOne({ where: { id } });
    if (!lead) throw new NotFoundException(`Lead ${id} not found`);
    return lead;
  }

  /** Used by both the authenticated admin API and the public (unauthenticated) lead-capture endpoint. */
  async create(body: Partial<Lead>) {
    const lead = await this.leads.save(this.leads.create({ ...body, status: LeadStatus.NEW }));
    await this.events.save(this.events.create({ leadId: lead.id, eventType: 'created', toStatus: LeadStatus.NEW }));
    return lead;
  }

  async updateStatus(id: string, toStatus: LeadStatus, userId?: string, note?: string) {
    const lead = await this.findOne(id);
    if (lead.status === toStatus) return lead; // no-op, e.g. a quote being re-sent

    const allowed = VALID_TRANSITIONS[lead.status] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new BadRequestException(`Cannot transition lead from "${lead.status}" to "${toStatus}"`);
    }

    await this.leads.update(id, { status: toStatus });
    await this.events.save(
      this.events.create({
        leadId: id,
        eventType: 'status_change',
        fromStatus: lead.status,
        toStatus,
        note,
        createdBy: userId,
      }),
    );
    return this.findOne(id);
  }

  async logEvent(id: string, eventType: string, note?: string, userId?: string) {
    await this.findOne(id);
    return this.events.save(this.events.create({ leadId: id, eventType, note, createdBy: userId }));
  }

  history(id: string) {
    return this.events.find({ where: { leadId: id }, order: { createdAt: 'ASC' } });
  }

  /**
   * Marks a lead won and links it to the resulting tenant. Actual
   * organization creation is a separate step (via AuthService.register() or
   * an admin-provisioning flow) - this just records the link once it exists,
   * since a lead can be "won" before the tenant is technically provisioned.
   */
  async convert(id: string, organizationId: string) {
    const lead = await this.updateStatus(id, LeadStatus.WON, undefined, 'Converted to customer');
    await this.leads.update(id, { convertedOrganizationId: organizationId });
    return this.findOne(id);
  }
}
