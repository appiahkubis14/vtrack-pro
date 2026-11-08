import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ADMIN_ROLES, OPS_ROLES, currentUser } from '../../common/auth/auth-user';
import { Role } from '../../common/constants/roles.constant';
import { EnforcementService } from './enforcement.service';

@ApiTags('Safe lock')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('enforcement')
export class EnforcementController {
  constructor(private readonly svc: EnforcementService) {}

  @Get('states') @Roles(...OPS_ROLES, Role.FINANCE, Role.AUDITOR)
  states(@Req() req: Request) { return this.svc.listStates(currentUser(req)); }

  @Get('lock-requests') @Roles(...OPS_ROLES, Role.AUDITOR)
  requests(@Query('status') status: string, @Req() req: Request) { return this.svc.listRequests(currentUser(req), { status }); }

  @Post('lock-requests') @Roles(...OPS_ROLES)
  request(@Body() b: { vehicleId: string; reason: string }, @Req() req: Request) { return this.svc.requestLock(currentUser(req), b); }

  @Post('lock-requests/:id/approve') @Roles(...ADMIN_ROLES)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() b: { note?: string }, @Req() req: Request) { return this.svc.decide(currentUser(req), id, true, b?.note); }

  @Post('lock-requests/:id/reject') @Roles(...ADMIN_ROLES)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() b: { note?: string }, @Req() req: Request) { return this.svc.decide(currentUser(req), id, false, b?.note); }

  @Post('unlock') @Roles(...OPS_ROLES)
  unlock(@Body() b: { vehicleId: string; reason: string }, @Req() req: Request) { return this.svc.manualUnlock(currentUser(req), b); }

  // BR17 (proposed): approved periods in which a rider is not locked
  @Get('exceptions') @Roles(...OPS_ROLES, Role.AUDITOR)
  exceptions(@Query('riderId') riderId: string, @Req() req: Request) { return this.svc.listExceptions(currentUser(req), riderId); }

  @Post('exceptions') @Roles(...OPS_ROLES)
  createException(@Body() b: any, @Req() req: Request) { return this.svc.createException(currentUser(req), b); }

  @Post('exceptions/:id/cancel') @Roles(...OPS_ROLES)
  cancelException(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) { return this.svc.cancelException(currentUser(req), id); }
}
