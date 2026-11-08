import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CatalogService } from '../catalog/catalog.service';
import { LeadsService } from '../commercial/leads.service';
import { Testimonial } from './entities/testimonial.entity';
import { Faq } from './entities/faq.entity';
import { PublicPage } from './entities/public-page.entity';

// Stricter than the app-wide default - public write endpoints are the most
// realistic spam/abuse target on this whole API, since they need no
// authentication at all.
/** Only these fields may come from an anonymous visitor; anything else (status, assignedTo, ids) is ignored. */
function leadFields(b: any) {
  const str = (v: any, max: number) => (v == null || v === '' ? undefined : String(v).trim().slice(0, max));
  const n = Number(b?.fleetSize);
  return {
    contactName: str(b?.contactName, 120) ?? '', companyName: str(b?.companyName, 160), phone: str(b?.phone, 30), email: str(b?.email, 160), whatsappNumber: str(b?.whatsappNumber, 30),
    country: str(b?.country, 2)?.toUpperCase(), city: str(b?.city, 100), fleetSize: Number.isInteger(n) && n > 0 && n < 100000 ? n : undefined,
    productInterestId: /^[0-9a-f-]{36}$/i.test(String(b?.productInterestId ?? '')) ? String(b.productInterestId) : undefined, message: str(b?.message, 2000),
    preferredLanguage: str(b?.preferredLanguage, 10) ?? 'en',
  };
}
const PUBLIC_WRITE_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
const PUBLIC_READ_THROTTLE = { default: { limit: 30, ttl: 60_000 } };

@ApiTags('Public')
@Controller('public')
export class PublicController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly leadsService: LeadsService,
    @InjectRepository(Testimonial) private readonly testimonials: Repository<Testimonial>,
    @InjectRepository(Faq) private readonly faqs: Repository<Faq>,
    @InjectRepository(PublicPage) private readonly pages: Repository<PublicPage>,
  ) {}

  @Get('products')
  @Throttle(PUBLIC_READ_THROTTLE)
  @ApiOperation({ summary: 'List active, publicly-visible products (cache-friendly)' })
  async products(@Query('country') country?: string) {
    const all = await this.catalogService.findAll({ isActive: true, country });
    return all.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      shortDescription: p.shortDescription,
      category: p.category ? { name: p.category.name, slug: p.category.slug } : null,
      isFeatured: p.isFeatured,
      imageUrls: p.imageUrls,
      datasheetUrl: p.datasheetUrl,
    }));
  }

  @Get('products/:slug')
  @Throttle(PUBLIC_READ_THROTTLE)
  @ApiOperation({ summary: 'Get a single product by slug for its public product page' })
  async productBySlug(@Param('slug') slug: string) {
    const product = await this.catalogService.findBySlug(slug);
    const [features, variants] = await Promise.all([
      this.catalogService.listFeatures(product.id),
      this.catalogService.listVariants(product.id),
    ]);

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      shortDescription: product.shortDescription,
      longDescription: product.longDescription,
      technicalSpecs: product.technicalSpecs,
      installationRequirements: product.installationRequirements,
      seoTitle: product.seoTitle,
      seoDescription: product.seoDescription,
      imageUrls: product.imageUrls,
      datasheetUrl: product.datasheetUrl,
      features: features.map((f) => ({ label: f.featureLabel, description: f.description })),
      variants: variants.map((v) => ({ name: v.name, includesSim: v.includesSim, includesInstallation: v.includesInstallation })),
    };
  }

  @Get('product-categories')
  @Throttle(PUBLIC_READ_THROTTLE)
  @ApiOperation({ summary: 'List product categories for site navigation' })
  categories() {
    return this.catalogService.listCategories();
  }

  @Post('leads')
  @Throttle(PUBLIC_WRITE_THROTTLE)
  @ApiOperation({ summary: 'Website "Get Quote" / contact form submission' })
  async createLead(@Body() body: any) {
    if (!body.consentToContact) {
      return { received: false, reason: 'Consent to contact is required' };
    }
    const f = leadFields(body);
    if (!f.contactName || !(f.phone || f.email || f.whatsappNumber)) return { received: false, reason: 'A name and a phone number or email are required' };
    const lead = await this.leadsService.create({ ...f, sourceChannel: 'website', consentToContact: true });
    return { received: true, leadId: lead.id };
  }

  @Post('quotes/request')
  @Throttle(PUBLIC_WRITE_THROTTLE)
  @ApiOperation({ summary: 'Request a quote from the website - creates a lead and notifies sales, does not expose pricing directly' })
  async requestQuote(@Body() body: any) {
    // A real quote (with actual pricing) is generated by a sales rep via the
    // authenticated /api/quotes endpoint after reviewing the lead - this
    // endpoint deliberately does NOT auto-generate and expose pricing to an
    // anonymous website visitor, since pricing may be tenant/negotiated.
    const f = leadFields(body);
    if (!f.contactName || !(f.phone || f.email || f.whatsappNumber)) return { received: false, reason: 'A name and a phone number or email are required' };
    const lead = await this.leadsService.create({
      ...f,
      sourceChannel: 'website_quote_request',
      consentToContact: true,
    });
    return { received: true, leadId: lead.id, message: 'A team member will follow up with your quote shortly.' };
  }

  @Get('faqs')
  @Throttle(PUBLIC_READ_THROTTLE)
  @ApiOperation({ summary: 'Published FAQs' })
  async faqsList(@Query('category') category?: string, @Query('productId') productId?: string) {
    return this.faqs.find({
      where: { isPublished: true, ...(category ? { category } : {}), ...(productId ? { productId } : {}) },
      order: { displayOrder: 'ASC' },
    });
  }

  @Get('testimonials')
  @Throttle(PUBLIC_READ_THROTTLE)
  @ApiOperation({ summary: 'Published customer testimonials' })
  async testimonialsList(@Query('productId') productId?: string) {
    return this.testimonials.find({
      where: { isPublished: true, ...(productId ? { productId } : {}) },
      order: { displayOrder: 'ASC' },
    });
  }

  @Get('pages/:slug')
  @Throttle(PUBLIC_READ_THROTTLE)
  @ApiOperation({ summary: 'A published static page (privacy policy, terms, about) by slug' })
  async page(@Param('slug') slug: string, @Query('lang') lang = 'en') {
    return this.pages.findOne({ where: { slug, language: lang, isPublished: true } });
  }
}
