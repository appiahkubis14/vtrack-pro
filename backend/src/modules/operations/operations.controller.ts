import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ADMIN_ROLES, OPS_ROLES, currentUser } from '../../common/auth/auth-user';
import { Role } from '../../common/constants/roles.constant';
import { AssignmentInput, OperationsService, RiderInput } from './operations.service';

const READ = [...OPS_ROLES, Role.FINANCE, Role.AUDITOR];

@ApiTags('Operations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class OperationsController {
  constructor(private readonly ops: OperationsService) {}

  @Get('riders') @Roles(...READ) riders(@Query() q: { hubId?: string }, @Req() req: Request) { return this.ops.listRiders(currentUser(req), q); }
  @Post('riders') @Roles(...OPS_ROLES) createRider(@Body() b: RiderInput, @Req() req: Request) { return this.ops.createRider(currentUser(req), b); }
  @Get('riders/:id') @Roles(...READ) rider(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) { return this.ops.getRider(currentUser(req), id); }
  @Put('riders/:id') @Roles(...OPS_ROLES) updateRider(@Param('id', ParseUUIDPipe) id: string, @Body() b: RiderInput, @Req() req: Request) { return this.ops.updateRider(currentUser(req), id, b); }

  @Get('assignments') @Roles(...READ) assignments(@Query() q: { hubId?: string; status?: string }, @Req() req: Request) { return this.ops.listAssignments(currentUser(req), q); }
  @Put('assignments/:id') @Roles(...OPS_ROLES) updateAssignment(@Param('id', ParseUUIDPipe) id: string, @Body() b: AssignmentInput, @Req() req: Request) { return this.ops.updateAssignment(currentUser(req), id, b ?? {}); }
  @Post('assignments') @Roles(...OPS_ROLES) assign(@Body() b: AssignmentInput, @Req() req: Request) { return this.ops.assign(currentUser(req), b); }
  @Post('assignments/:id/end') @Roles(...OPS_ROLES) end(@Param('id', ParseUUIDPipe) id: string, @Body() b: { reason?: string }, @Req() req: Request) { return this.ops.endAssignment(currentUser(req), id, b?.reason); }

  @Get('batteries') @Roles(...READ) batteries(@Query() q: { hubId?: string; status?: string }, @Req() req: Request) { return this.ops.listBatteries(currentUser(req), q); }
  @Post('batteries') @Roles(...ADMIN_ROLES, Role.FLEET_MANAGER) createBattery(@Body() b: any, @Req() req: Request) { return this.ops.createBattery(currentUser(req), b); }
  @Post('batteries/:id/fit') @Roles(...OPS_ROLES) fit(@Param('id', ParseUUIDPipe) id: string, @Body() b: { vehicleId: string }, @Req() req: Request) { return this.ops.fit(currentUser(req), id, b.vehicleId); }
  @Get('battery-swaps') @Roles(...READ) swaps(@Query() q: { hubId?: string }, @Req() req: Request) { return this.ops.listSwaps(currentUser(req), q); }
  @Post('battery-swaps') @Roles(...OPS_ROLES) swap(@Body() b: { vehicleId?: string; batteryInId?: string; riderId?: string }, @Req() req: Request) { return this.ops.swap(currentUser(req), b); }

  @Get('charge-events') @Roles(...READ) charges(@Query() q: { hubId?: string; date?: string }, @Req() req: Request) { return this.ops.listCharges(currentUser(req), q); }
  @Post('charge-events') @Roles(...OPS_ROLES) startCharge(@Body() b: { batteryId?: string; riderId?: string; chargePointId?: string }, @Req() req: Request) { return this.ops.startCharge(currentUser(req), b); }
  @Post('charge-events/:id/finish') @Roles(...OPS_ROLES) finish(@Param('id', ParseUUIDPipe) id: string, @Body() b: { kwh?: number; feePesewas?: number }, @Req() req: Request) { return this.ops.finishCharge(currentUser(req), id, b); }

  @Get('collections') @Roles(...READ) collections(@Query() q: { hubId?: string; date?: string; riderId?: string }, @Req() req: Request) { return this.ops.listCollections(currentUser(req), q); }
  @Post('collections') @Roles(...OPS_ROLES) collect(@Body() b: any, @Req() req: Request) { return this.ops.recordCollection(currentUser(req), b); }
}
