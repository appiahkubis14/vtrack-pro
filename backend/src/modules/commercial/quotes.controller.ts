import { Body, Controller, Get, Header, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ADMIN_ROLES } from '../../common/auth/auth-user';
import { QuotesService } from './quotes.service';
import { QuotePdfService } from './quote-pdf.service';

@ApiTags('Quotes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ADMIN_ROLES)
@Controller('quotes')
export class QuotesController {
  constructor(
    private readonly quotesService: QuotesService,
    private readonly quotePdfService: QuotePdfService,
  ) {}

  @Post('')
  @ApiOperation({ summary: 'Create a quote from selected products/quantities' })
  create(@Body() body: any, @Req() req: Request) {
    const user = req.user as { sub: string; organizationId: string };
    return this.quotesService.create({ ...body, organizationId: user.organizationId }, user.sub);
  }

  @Get('')
  @ApiOperation({ summary: 'List quotes' })
  findAll(@Query() query: any) {
    return this.quotesService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a quote with line items' })
  findOne(@Param('id') id: string) {
    return this.quotesService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update quote metadata - line items are immutable, create a new quote to re-price' })
  update(@Param('id') id: string) {
    return this.quotesService.findOne(id);
  }

  @Post(':id/send')
  @ApiOperation({ summary: 'Mark a quote sent to the customer' })
  send(@Param('id') id: string) {
    return this.quotesService.send(id);
  }

  @Post(':id/accept')
  @ApiOperation({ summary: 'Customer accepted the quote' })
  accept(@Param('id') id: string) {
    return this.quotesService.accept(id);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Customer rejected the quote' })
  reject(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.quotesService.reject(id, body.reason);
  }

  @Get(':id/pdf')
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({ summary: 'Download the quote as a PDF' })
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.quotePdfService.generate(id);
    res.setHeader('Content-Disposition', `attachment; filename="quote-${id}.pdf"`);
    res.send(buffer);
  }
}
