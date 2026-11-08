import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ADMIN_ROLES, FINANCE_ROLES, OPS_ROLES, currentUser } from '../../common/auth/auth-user';
import { Role } from '../../common/constants/roles.constant';
import { LedgerService } from './ledger.service';
import { SettlementsService } from './settlements.service';
import { BusinessReportsService } from './business-reports.service';
import { PaymentsService } from './payments.service';

const READ = [...OPS_ROLES, Role.FINANCE, Role.AUDITOR];
const LEDGER_READ = [...FINANCE_ROLES, Role.AUDITOR];

@ApiTags('Finance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class FinanceController {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly ledger: LedgerService, private readonly settlements: SettlementsService, private readonly reports: BusinessReportsService, private readonly payments: PaymentsService) {}

  // ----- settlements -----
  @Post('settlements/calculate') @Roles(...OPS_ROLES, Role.FINANCE)
  calculate(@Body() b: { date?: string; hubId?: string; riderId?: string }, @Req() req: Request) { return this.settlements.calculate(currentUser(req), b ?? {}); }

  @Get('settlements') @Roles(...READ, Role.INVESTOR)
  list(@Query() q: any, @Req() req: Request) { return this.settlements.list(currentUser(req), q); }

  @Post('settlements/:id/close') @Roles(...OPS_ROLES, Role.FINANCE)
  close(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) { return this.settlements.close(currentUser(req), id); }

  // ----- ledger (read only: there is no endpoint that edits or deletes entries) -----
  @Get('ledger/trial-balance') @Roles(...LEDGER_READ)
  trial(@Req() req: Request) { return this.ledger.trialBalance(currentUser(req).organizationId); }

  @Get('ledger/accounts/:id/entries') @Roles(...LEDGER_READ)
  entries(@Param('id', ParseUUIDPipe) id: string, @Query('limit') limit: string, @Req() req: Request) { return this.ledger.entries(currentUser(req).organizationId, id, limit ? Number(limit) : 200); }

  @Post('ledger/transactions/:id/reverse') @Roles(...ADMIN_ROLES, Role.FINANCE)
  reverse(@Param('id', ParseUUIDPipe) id: string, @Body() b: { reason?: string }, @Req() req: Request) {
    const u = currentUser(req);
    if (!b?.reason?.trim()) throw new BadRequestException('A reason is required to reverse a transaction');
    return this.ds.transaction((m) => this.ledger.reverseTransaction(m, u.organizationId, id, b.reason!, u.sub));
  }

  // ----- reports -----
  @Get('business-reports/hub-daily-close') @Roles(...READ)
  hubClose(@Query('hubId', ParseUUIDPipe) hubId: string, @Query('date') date: string, @Req() req: Request) { return this.reports.hubDailyClose(currentUser(req), hubId, date); }

  @Get('business-reports/rider-statement') @Roles(...READ)
  riderStatement(@Query('riderId', ParseUUIDPipe) riderId: string, @Query('from') from: string, @Query('to') to: string, @Req() req: Request) { return this.reports.riderStatement(currentUser(req), riderId, from, to); }

  @Get('business-reports/owner-statement') @Roles(...READ, Role.INVESTOR)
  ownerStatement(@Query('ownerId', ParseUUIDPipe) ownerId: string, @Query('from') from: string, @Query('to') to: string, @Req() req: Request) { return this.reports.ownerStatement(currentUser(req), ownerId, from, to); }

  @Get('business-reports/fleet-health') @Roles(...READ)
  fleetHealth(@Query('hubId') hubId: string, @Req() req: Request) { return this.reports.fleetHealth(currentUser(req), hubId || undefined); }

  @Get('business-reports/summary-by') @Roles(...READ)
  summaryBy(@Query('dimension') dimension: string, @Query('from') from: string, @Query('to') to: string, @Query('hubId') hubId: string, @Req() req: Request) { return this.reports.summaryBy(currentUser(req), dimension, from, to, hubId || undefined); }

  @Get('business-reports/arrears') @Roles(...FINANCE_ROLES, Role.AUDITOR, Role.FLEET_MANAGER)
  arrears(@Req() req: Request) { return this.reports.arrears(currentUser(req)); }

  @Get('business-reports/weekly-summary') @Roles(...READ)
  weekly(@Query('date') date: string, @Query('hubId') hubId: string, @Req() req: Request) { return this.reports.periodSummary(currentUser(req), 'week', date, hubId); }

  @Get('business-reports/monthly-summary') @Roles(...READ)
  monthly(@Query('date') date: string, @Query('hubId') hubId: string, @Req() req: Request) { return this.reports.periodSummary(currentUser(req), 'month', date, hubId); }

  // ----- payments, payouts and hub deposits -----
  @Get('payments') @Roles(...READ)
  listPayments(@Query() q: any, @Req() req: Request) { return this.payments.list(currentUser(req), q); }

  @Get('payments/balances') @Roles(...FINANCE_ROLES)
  balances(@Req() req: Request) { return this.payments.balances(currentUser(req)); }

  @Post('payouts/owners/:id') @Roles(...FINANCE_ROLES)
  payOwner(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Req() req: Request) { return this.payments.payoutOwner(currentUser(req), id, b ?? {}); }

  @Post('payouts/riders/:id') @Roles(...FINANCE_ROLES)
  payRider(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Req() req: Request) { return this.payments.payoutRider(currentUser(req), id, b ?? {}); }

  @Post('hubs/:id/cash-deposits') @Roles(...OPS_ROLES, Role.FINANCE)
  hubDeposit(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Req() req: Request) { return this.payments.hubDeposit(currentUser(req), id, b ?? {}); }

  @Post('charge-events/:id/pay') @Roles(...OPS_ROLES, Role.FINANCE)
  payCharge(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Req() req: Request) { return this.payments.payCharge(currentUser(req), id, b ?? {}); }
}
