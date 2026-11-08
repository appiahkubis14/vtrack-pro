import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DashboardService } from './dashboard.service';
import { AttentionService } from './attention.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ADMIN_ROLES, currentUser } from '../../common/auth/auth-user';
import { Role } from '../../common/constants/roles.constant';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService, private readonly attention: AttentionService) {}

  private orgId(req: Request): string {
    return (req.user as { organizationId: string }).organizationId;
  }

  @Get('attention')
  @UseGuards(RolesGuard)
  @Roles(...ADMIN_ROLES, Role.FLEET_MANAGER, Role.HUB_MANAGER, Role.DISPATCHER, Role.FINANCE, Role.AUDITOR)
  @ApiOperation({ summary: 'What needs attention now, with the money and fleet numbers behind it' })
  attentionNow(@Req() req: Request) {
    return this.attention.build(currentUser(req));
  }

  @Get('overview')
  @ApiOperation({ summary: "Fleet overview KPIs for the caller's organization" })
  overview(@Req() req: Request) {
    return this.dashboardService.overview(this.orgId(req));
  }

  @Get('real-time')
  @ApiOperation({ summary: 'Real-time snapshot' })
  realTime(@Req() req: Request) {
    return this.dashboardService.realTime(this.orgId(req));
  }

  @Get('fuel')
  @ApiOperation({ summary: 'Fuel KPIs' })
  fuel(@Req() req: Request) {
    return this.dashboardService.fuel(this.orgId(req));
  }

  @Get('alerts')
  @ApiOperation({ summary: 'Alert KPIs' })
  alerts(@Req() req: Request) {
    return this.dashboardService.alertsSummary(this.orgId(req));
  }

  @Get('performance')
  @ApiOperation({ summary: 'Fleet performance KPIs' })
  performance(@Req() req: Request) {
    return this.dashboardService.performance(this.orgId(req));
  }

  @Get('statistics')
  @ApiOperation({ summary: 'General statistics' })
  statistics(@Req() req: Request) {
    return this.dashboardService.statistics(this.orgId(req));
  }
}
