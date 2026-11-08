import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Quote, QuoteStatus } from './entities/quote.entity';
import { QuoteItem } from './entities/quote-item.entity';
import { QuoteCalculationEngine, QuoteLineInput } from './engines/quote-calculation.engine';
import { LeadsService } from './leads.service';
import { LeadStatus } from './entities/lead.entity';
import { RealtimeEventsGateway } from '../realtime/realtime-events.gateway';
import { ServerEvents } from '../../common/constants/websocket-events.constant';

export interface CreateQuoteInput {
  leadId?: string;
  customerId?: string;
  currency: string;
  country?: string;
  organizationId?: string; // for tenant-negotiated pricing lookup
  lines: QuoteLineInput[];
  validityDays?: number;
  termsAndConditions?: string;
  paymentSchedule?: string;
  notes?: string;
}

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    @InjectRepository(Quote) private readonly quotes: Repository<Quote>,
    @InjectRepository(QuoteItem) private readonly quoteItems: Repository<QuoteItem>,
    private readonly calculationEngine: QuoteCalculationEngine,
    private readonly leadsService: LeadsService,
    private readonly realtimeGateway: RealtimeEventsGateway,
  ) {}

  findAll(query: { status?: QuoteStatus; leadId?: string; limit?: number } = {}) {
    return this.quotes.find({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.leadId ? { leadId: query.leadId } : {}),
      },
      order: { createdAt: 'DESC' },
      take: query.limit ?? 100,
    });
  }

  async findOne(id: string) {
    const quote = await this.quotes.findOne({ where: { id } });
    if (!quote) throw new NotFoundException(`Quote ${id} not found`);
    const items = await this.quoteItems.find({ where: { quoteId: id }, order: { displayOrder: 'ASC' } });
    return { ...quote, items };
  }

  async create(input: CreateQuoteInput, createdBy?: string) {
    const calc = await this.calculationEngine.calculate(input.lines, input.currency, input.organizationId, input.country);

    const quoteNumber = await this.generateQuoteNumber();
    const validityDays = input.validityDays ?? 30;
    const expiresAt = new Date(Date.now() + validityDays * 86_400_000);

    const quote = await this.quotes.save(
      this.quotes.create({
        quoteNumber,
        leadId: input.leadId,
        customerId: input.customerId,
        organizationId: input.organizationId,
        createdBy,
        currency: calc.currency,
        subtotal: calc.subtotal,
        discountTotal: calc.discountTotal,
        taxTotal: calc.taxTotal,
        grandTotal: calc.grandTotal,
        validityDays,
        expiresAt,
        termsAndConditions: input.termsAndConditions,
        paymentSchedule: input.paymentSchedule,
        notes: input.notes,
        status: QuoteStatus.DRAFT,
      }),
    );

    const items = await this.quoteItems.save(
      calc.lines.map((line, i) =>
        this.quoteItems.create({
          quoteId: quote.id,
          productId: line.productId,
          variantId: line.variantId,
          description: line.productName,
          quantity: line.quantity,
          unitHardwarePrice: line.unitHardwarePrice,
          unitInstallationPrice: line.unitInstallationPrice,
          unitSubscriptionPrice: line.unitSubscriptionPrice,
          unitSimPrice: line.unitSimPrice,
          lineDiscountAmount: line.lineDiscountAmount,
          lineTaxAmount: line.lineTaxAmount,
          lineTotal: line.lineTotal,
          displayOrder: i,
        }),
      ),
    );

    if (input.leadId) {
      await this.leadsService.logEvent(input.leadId, 'quote_created', `Quote ${quoteNumber} created`);
    }

    return { ...quote, items };
  }

  async send(id: string) {
    const quote = await this.requireQuote(id);
    if (quote.status !== QuoteStatus.DRAFT && quote.status !== QuoteStatus.PENDING_APPROVAL) {
      throw new BadRequestException(`Cannot send a quote in status "${quote.status}"`);
    }
    await this.quotes.update(id, { status: QuoteStatus.SENT, sentAt: new Date() });
    if (quote.leadId) {
      await this.leadsService
        .updateStatus(quote.leadId, LeadStatus.QUOTE_SENT, undefined, `Quote ${quote.quoteNumber} sent`)
        .catch((err) => this.logger.warn(`Failed to sync lead ${quote.leadId} status after sending quote: ${err.message}`));
    }
    this.emitStatusChanged(quote, QuoteStatus.SENT);
    return this.findOne(id);
  }

  async accept(id: string) {
    const quote = await this.requireQuote(id);
    if (quote.status !== QuoteStatus.SENT) throw new BadRequestException('Only a sent quote can be accepted');
    if (quote.expiresAt && quote.expiresAt < new Date()) {
      await this.quotes.update(id, { status: QuoteStatus.EXPIRED });
      this.emitStatusChanged(quote, QuoteStatus.EXPIRED);
      throw new BadRequestException('Quote has expired');
    }
    await this.quotes.update(id, { status: QuoteStatus.ACCEPTED, acceptedAt: new Date() });
    if (quote.leadId) {
      await this.leadsService
        .updateStatus(quote.leadId, LeadStatus.WON, undefined, `Quote ${quote.quoteNumber} accepted`)
        .catch((err) => this.logger.warn(`Failed to sync lead ${quote.leadId} status after accepting quote: ${err.message}`));
    }
    this.emitStatusChanged(quote, QuoteStatus.ACCEPTED);
    return this.findOne(id);
  }

  async reject(id: string, reason?: string) {
    const quote = await this.requireQuote(id);
    if (quote.status !== QuoteStatus.SENT) throw new BadRequestException('Only a sent quote can be rejected');
    await this.quotes.update(id, { status: QuoteStatus.REJECTED, rejectedAt: new Date(), rejectionReason: reason });
    if (quote.leadId) {
      await this.leadsService
        .updateStatus(quote.leadId, LeadStatus.LOST, undefined, reason ?? 'Quote rejected')
        .catch((err) => this.logger.warn(`Failed to sync lead ${quote.leadId} status after rejecting quote: ${err.message}`));
    }
    this.emitStatusChanged(quote, QuoteStatus.REJECTED);
    return this.findOne(id);
  }

  private emitStatusChanged(quote: Quote, newStatus: QuoteStatus) {
    if (!quote.organizationId) return; // draft quotes created before a sales org context exists
    this.realtimeGateway.emit(quote.organizationId, ServerEvents.QUOTE_STATUS_CHANGED, {
      quoteId: quote.id,
      quoteNumber: quote.quoteNumber,
      status: newStatus,
    });
  }

  private async requireQuote(id: string): Promise<Quote> {
    const quote = await this.quotes.findOne({ where: { id } });
    if (!quote) throw new NotFoundException(`Quote ${id} not found`);
    return quote;
  }

  private async generateQuoteNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.quotes.count();
    return `QT-${year}-${String(count + 1).padStart(5, '0')}`;
  }
}
