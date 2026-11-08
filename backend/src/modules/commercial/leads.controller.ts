import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ADMIN_ROLES } from '../../common/auth/auth-user';
import { LeadsService } from './leads.service';
import { LeadStatus } from './entities/lead.entity';

@ApiTags('Leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ADMIN_ROLES)
@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get('')
  @ApiOperation({ summary: 'List leads' })
  findAll(@Query() query: any) {
    return this.leadsService.findAll(query);
  }

  @Post('')
  @ApiOperation({ summary: 'Create a lead (internal - e.g. phone/walk-in capture by sales staff)' })
  create(@Body() body: any) {
    return this.leadsService.create(body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a lead' })
  findOne(@Param('id') id: string) {
    return this.leadsService.findOne(id);
  }

  @Put(':id/status')
  @ApiOperation({ summary: 'Transition a lead to a new status' })
  updateStatus(@Param('id') id: string, @Body() body: { status: LeadStatus; note?: string }, @Req() req: Request) {
    const user = req.user as { sub: string };
    return this.leadsService.updateStatus(id, body.status, user.sub, body.note);
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Lead event/status history' })
  history(@Param('id') id: string) {
    return this.leadsService.history(id);
  }

  @Post(':id/convert')
  @ApiOperation({ summary: 'Mark a lead won and link it to the resulting organization' })
  convert(@Param('id') id: string, @Body() body: { organizationId: string }) {
    return this.leadsService.convert(id, body.organizationId);
  }
}
