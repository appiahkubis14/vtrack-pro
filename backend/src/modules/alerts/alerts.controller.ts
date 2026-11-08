import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AlertsService } from './alerts.service';

@ApiTags('Alerts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get('')
  @ApiOperation({ summary: "List alerts for the caller's organization" })
  findAll(@Query() query: any, @Req() req: Request) {
    const user = req.user as { organizationId: string };
    return this.alertsService.findAll({ ...query, organizationId: user.organizationId });
  }

  @Get('statistics')
  @ApiOperation({ summary: 'Alert statistics' })
  statistics(@Req() req: Request) {
    const user = req.user as { organizationId: string };
    return this.alertsService.statistics(user.organizationId);
  }

  @Get('rules')
  @ApiOperation({ summary: 'List alert rules' })
  listRules() {
    return this.alertsService.listRules();
  }

  @Post('rules')
  @ApiOperation({ summary: 'Create an alert rule' })
  createRule(@Body() body: any) {
    return this.alertsService.createRule(body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an alert' })
  findOne(@Param('id') id: string) {
    return this.alertsService.findOne(id);
  }

  @Put(':id/acknowledge')
  @ApiOperation({ summary: 'Acknowledge an alert' })
  acknowledge(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as { sub: string };
    return this.alertsService.acknowledge(id, user.sub);
  }

  @Put(':id/resolve')
  @ApiOperation({ summary: 'Resolve an alert' })
  resolve(@Param('id') id: string, @Body() body: { note?: string }, @Req() req: Request) {
    const user = req.user as { sub: string };
    return this.alertsService.resolve(id, user.sub, body?.note);
  }
}
