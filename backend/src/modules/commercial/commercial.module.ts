import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CampaignSource } from './entities/campaign-source.entity';
import { Lead } from './entities/lead.entity';
import { LeadEvent } from './entities/lead-event.entity';
import { Customer } from './entities/customer.entity';
import { Quote } from './entities/quote.entity';
import { QuoteItem } from './entities/quote-item.entity';
import { Discount } from './entities/discount.entity';
import { Tax } from './entities/tax.entity';
import { Bundle } from './entities/bundle.entity';
import { BundleItem } from './entities/bundle-item.entity';
import { Order } from './entities/order.entity';
import { Invoice } from './entities/invoice.entity';
import { ProductCatalogItem } from '../catalog/entities/product-catalog.entity';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { QuoteCalculationEngine } from './engines/quote-calculation.engine';
import { QuotePdfService } from './quote-pdf.service';
import { PdfGenerator } from '../reports/generators/pdf.generator';
import { CatalogModule } from '../catalog/catalog.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CampaignSource,
      Lead,
      LeadEvent,
      Customer,
      Quote,
      QuoteItem,
      Discount,
      Tax,
      Bundle,
      BundleItem,
      Order,
      Invoice,
      ProductCatalogItem,
    ]),
    CatalogModule, // for PricingEngine + EntitlementsEngine
    RealtimeModule,
  ],
  controllers: [LeadsController, QuotesController],
  providers: [LeadsService, QuotesService, QuoteCalculationEngine, QuotePdfService, PdfGenerator],
  exports: [LeadsService, QuotesService],
})
export class CommercialModule {}
