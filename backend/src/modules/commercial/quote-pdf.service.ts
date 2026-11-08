import { Injectable } from '@nestjs/common';
import { PdfGenerator } from '../reports/generators/pdf.generator';
import { QuotesService } from './quotes.service';

@Injectable()
export class QuotePdfService {
  constructor(
    private readonly pdfGenerator: PdfGenerator,
    private readonly quotesService: QuotesService,
  ) {}

  async generate(quoteId: string): Promise<Buffer> {
    const quote = await this.quotesService.findOne(quoteId);

    const lines = [
      `Quote ${quote.quoteNumber}`,
      `Status: ${quote.status}`,
      `Currency: ${quote.currency}`,
      `Valid until: ${quote.expiresAt ? new Date(quote.expiresAt).toDateString() : 'N/A'}`,
      '',
      'Line Items:',
      ...quote.items.map(
        (item: any) =>
          `  ${item.description} x${item.quantity} - Hardware: ${item.unitHardwarePrice}, ` +
          `Install: ${item.unitInstallationPrice}, Subscription: ${item.unitSubscriptionPrice}/mo, Total: ${item.lineTotal}`,
      ),
      '',
      `Subtotal: ${quote.subtotal} ${quote.currency}`,
      `Discount: -${quote.discountTotal} ${quote.currency}`,
      `Tax: ${quote.taxTotal} ${quote.currency}`,
      `Grand Total: ${quote.grandTotal} ${quote.currency}`,
      '',
      quote.paymentSchedule ? `Payment Schedule: ${quote.paymentSchedule}` : '',
      quote.notes ? `Notes: ${quote.notes}` : '',
      '',
      quote.termsAndConditions ?? 'Standard V-Track Pro terms and conditions apply.',
    ].filter(Boolean);

    return this.pdfGenerator.generate(`V-Track Pro Quote ${quote.quoteNumber}`, lines);
  }
}
