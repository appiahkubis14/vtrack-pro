import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Testimonial } from './entities/testimonial.entity';
import { Faq } from './entities/faq.entity';
import { PublicPage } from './entities/public-page.entity';
import { PublicController } from './public.controller';
import { ContentAdminController } from './content-admin.controller';
import { CatalogModule } from '../catalog/catalog.module';
import { CommercialModule } from '../commercial/commercial.module';

@Module({
  imports: [TypeOrmModule.forFeature([Testimonial, Faq, PublicPage]), CatalogModule, CommercialModule],
  controllers: [PublicController, ContentAdminController],
})
export class PublicSiteModule {}
