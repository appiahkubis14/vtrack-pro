import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { Lead, LeadStatus } from './entities/lead.entity';
import { LeadEvent } from './entities/lead-event.entity';
import { RealtimeEventsGateway } from '../realtime/realtime-events.gateway';

describe('LeadsService transition rules', () => {
  let service: LeadsService;
  let leadRow: Partial<Lead>;

  const leadRepo = {
    findOne: jest.fn(() => Promise.resolve(leadRow)),
    update: jest.fn((id: string, patch: Partial<Lead>) => {
      Object.assign(leadRow, patch);
      return Promise.resolve();
    }),
    save: jest.fn(),
    create: jest.fn((v) => v),
    find: jest.fn(),
  };
  const eventRepo = {
    save: jest.fn(),
    create: jest.fn((v) => v),
    find: jest.fn(() => Promise.resolve([])),
  };
  const realtimeGateway = { emit: jest.fn() };

  beforeEach(async () => {
    leadRow = { id: 'lead-1', status: LeadStatus.NEW };
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: getRepositoryToken(Lead), useValue: leadRepo },
        { provide: getRepositoryToken(LeadEvent), useValue: eventRepo },
        { provide: RealtimeEventsGateway, useValue: realtimeGateway },
      ],
    }).compile();

    service = moduleRef.get(LeadsService);
  });

  // This is the exact bug found while testing the real quote flow: a lead
  // is often quoted before it's manually marked "qualified", so the quote
  // engine needs to be able to drive NEW -> QUOTE_SENT directly.
  it('allows NEW -> QUOTE_SENT directly (a quote can be sent before manual qualification)', async () => {
    const result = await service.updateStatus('lead-1', LeadStatus.QUOTE_SENT);
    expect(result.status).toBe(LeadStatus.QUOTE_SENT);
  });

  it('allows NEW -> WON directly (a fast-close deal with no intermediate steps logged)', async () => {
    const result = await service.updateStatus('lead-1', LeadStatus.WON);
    expect(result.status).toBe(LeadStatus.WON);
  });

  it('allows QUOTE_SENT -> WON when a customer accepts', async () => {
    leadRow.status = LeadStatus.QUOTE_SENT;
    const result = await service.updateStatus('lead-1', LeadStatus.WON);
    expect(result.status).toBe(LeadStatus.WON);
  });

  it('treats a same-status transition as a no-op instead of throwing (e.g. a quote re-send)', async () => {
    leadRow.status = LeadStatus.QUOTE_SENT;
    const result = await service.updateStatus('lead-1', LeadStatus.QUOTE_SENT);
    expect(result.status).toBe(LeadStatus.QUOTE_SENT);
    expect(leadRepo.update).not.toHaveBeenCalled();
  });

  it('rejects a transition out of a terminal ARCHIVED state other than staying archived', async () => {
    leadRow.status = LeadStatus.ARCHIVED;
    await expect(service.updateStatus('lead-1', LeadStatus.CONTACTED)).rejects.toThrow(BadRequestException);
  });

  it('rejects WON -> NEW (cannot un-win a deal via a plain status update)', async () => {
    leadRow.status = LeadStatus.WON;
    await expect(service.updateStatus('lead-1', LeadStatus.NEW)).rejects.toThrow(BadRequestException);
  });

  it('allows LOST -> CONTACTED as a deliberate re-engagement path', async () => {
    leadRow.status = LeadStatus.LOST;
    const result = await service.updateStatus('lead-1', LeadStatus.CONTACTED);
    expect(result.status).toBe(LeadStatus.CONTACTED);
  });
});
