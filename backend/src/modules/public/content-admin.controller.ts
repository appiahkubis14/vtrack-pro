import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Testimonial } from './entities/testimonial.entity';
import { Faq } from './entities/faq.entity';
import { PublicPage } from './entities/public-page.entity';

@ApiTags('Content Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('content')
export class ContentAdminController {
  constructor(
    @InjectRepository(Testimonial) private readonly testimonials: Repository<Testimonial>,
    @InjectRepository(Faq) private readonly faqs: Repository<Faq>,
    @InjectRepository(PublicPage) private readonly pages: Repository<PublicPage>,
  ) {}

  @Get('testimonials')
  @ApiOperation({ summary: 'List all testimonials, including unpublished (admin view)' })
  listTestimonials() {
    return this.testimonials.find({ order: { displayOrder: 'ASC' } });
  }

  @Post('testimonials')
  @ApiOperation({ summary: 'Create a testimonial (unpublished by default)' })
  createTestimonial(@Body() body: any) {
    return this.testimonials.save(this.testimonials.create(body));
  }

  @Put('testimonials/:id/publish')
  @ApiOperation({ summary: 'Publish a testimonial to the public site' })
  async publishTestimonial(@Param('id') id: string) {
    await this.testimonials.update(id, { isPublished: true });
    return this.testimonials.findOne({ where: { id } });
  }

  @Get('faqs')
  @ApiOperation({ summary: 'List all FAQs, including unpublished (admin view)' })
  listFaqs() {
    return this.faqs.find({ order: { displayOrder: 'ASC' } });
  }

  @Post('faqs')
  @ApiOperation({ summary: 'Create an FAQ (unpublished by default)' })
  createFaq(@Body() body: any) {
    return this.faqs.save(this.faqs.create(body));
  }

  @Put('faqs/:id/publish')
  @ApiOperation({ summary: 'Publish an FAQ to the public site' })
  async publishFaq(@Param('id') id: string) {
    await this.faqs.update(id, { isPublished: true });
    return this.faqs.findOne({ where: { id } });
  }

  @Get('pages')
  @ApiOperation({ summary: 'List all static pages, including unpublished' })
  listPages() {
    return this.pages.find();
  }

  @Post('pages')
  @ApiOperation({ summary: 'Create a static page (privacy policy, terms, about)' })
  createPage(@Body() body: any, @Req() req: Request) {
    const user = req.user as { sub: string };
    return this.pages.save(this.pages.create({ ...body, updatedBy: user.sub }));
  }

  @Put('pages/:id/publish')
  @ApiOperation({ summary: 'Publish a static page' })
  async publishPage(@Param('id') id: string) {
    await this.pages.update(id, { isPublished: true, publishedAt: new Date() });
    return this.pages.findOne({ where: { id } });
  }
}
