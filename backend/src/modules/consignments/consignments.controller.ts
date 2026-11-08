import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ADMIN_ROLES, FINANCE_ROLES, OPS_ROLES, currentUser } from '../../common/auth/auth-user';
import { Role } from '../../common/constants/roles.constant';
import { Supplier } from './entities/supplier.entity';
import { ConsignmentInput, ConsignmentsService, VehicleModelInput } from './consignments.service';
import { ConsignmentStatus } from '../../common/lifecycle/transitions';

const STOCK_ROLES = [...ADMIN_ROLES, Role.FLEET_MANAGER];
const VIEW_ROLES = [...STOCK_ROLES, Role.FINANCE, Role.AUDITOR];

@ApiTags('Consignments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ConsignmentsController {
  constructor(private readonly svc: ConsignmentsService) {}

  @Get('vehicle-models') @Roles(...OPS_ROLES, ...FINANCE_ROLES)
  models(@Req() req: Request) { return this.svc.listModels(currentUser(req).organizationId); }

  @Post('vehicle-models') @Roles(...STOCK_ROLES)
  createModel(@Body() b: VehicleModelInput, @Req() req: Request) { return this.svc.createModel(currentUser(req).organizationId, b); }

  @Put('vehicle-models/:id') @Roles(...STOCK_ROLES)
  updateModel(@Param('id', ParseUUIDPipe) id: string, @Body() b: VehicleModelInput, @Req() req: Request) { return this.svc.updateModel(currentUser(req).organizationId, id, b); }

  @Get('consignments') @Roles(...VIEW_ROLES)
  list(@Req() req: Request) { return this.svc.list(currentUser(req).organizationId); }

  @Post('consignments') @Roles(...STOCK_ROLES) @ApiOperation({ summary: 'Record a new container order' })
  create(@Body() b: ConsignmentInput, @Req() req: Request) { const u = currentUser(req); return this.svc.create(u.organizationId, u.sub, b); }

  @Get('consignments/:id') @Roles(...VIEW_ROLES)
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) { return this.svc.get(currentUser(req).organizationId, id); }

  @Put('consignments/:id/landed-cost') @Roles(...FINANCE_ROLES)
  landed(@Param('id', ParseUUIDPipe) id: string, @Body() b: { landedCostPesewas: number }, @Req() req: Request) {
    return this.svc.setLandedCost(currentUser(req).organizationId, id, b.landedCostPesewas);
  }

  @Post('consignments/:id/advance') @Roles(...STOCK_ROLES) @ApiOperation({ summary: 'Move to the next stage (shipped, at_port, cleared, closed)' })
  advance(@Param('id', ParseUUIDPipe) id: string, @Body() b: { status: ConsignmentStatus; date?: string }, @Req() req: Request) {
    return this.svc.advance(currentUser(req).organizationId, id, b.status, b.date);
  }

  @Post('consignments/:id/receive') @Roles(...STOCK_ROLES) @ApiOperation({ summary: 'Register received units as vehicles in stock' })
  receive(@Param('id', ParseUUIDPipe) id: string, @Body() b: { counts?: { lineId: string; count: number }[] }, @Req() req: Request) {
    return this.svc.receive(currentUser(req).organizationId, id, b?.counts);
  }

  @Get('consignments/:id/profitability') @Roles(...FINANCE_ROLES, Role.AUDITOR)
  profit(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) { return this.svc.profitability(currentUser(req).organizationId, id); }

  @Post('consignments/:id/write-offs') @Roles(...STOCK_ROLES) @ApiOperation({ summary: 'Write off lost or damaged units (reason required)' })
  writeOff(@Param('id', ParseUUIDPipe) id: string, @Body() b: { lineId: string; units?: number; reason: string }, @Req() req: Request) { return this.svc.writeOff(currentUser(req), id, b ?? ({} as any)); }

  @Get('suppliers') @Roles(...VIEW_ROLES)
  suppliers(@Req() req: Request) { return this.svc.listSuppliers(currentUser(req).organizationId); }

  @Post('suppliers') @Roles(...STOCK_ROLES)
  createSupplier(@Body() b: Partial<Supplier>, @Req() req: Request) { return this.svc.createSupplier(currentUser(req).organizationId, b ?? {}); }

  @Put('suppliers/:id') @Roles(...STOCK_ROLES)
  updateSupplier(@Param('id', ParseUUIDPipe) id: string, @Body() b: Partial<Supplier>, @Req() req: Request) { return this.svc.updateSupplier(currentUser(req).organizationId, id, b ?? {}); }

  @Get('business/vehicles') @Roles(...VIEW_ROLES)
  vehicles(@Query('status') status: string, @Req() req: Request) { return this.svc.listVehicles(currentUser(req).organizationId, { status }); }

  @Put('business/vehicles/:id') @Roles(...STOCK_ROLES)
  updateVehicle(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Req() req: Request) { return this.svc.updateVehicle(currentUser(req).organizationId, id, b ?? {}); }

  @Post('business/vehicles/:id/retire') @Roles(...STOCK_ROLES)
  retire(@Param('id', ParseUUIDPipe) id: string, @Body() b: { reason?: string }, @Req() req: Request) { return this.svc.retireVehicle(currentUser(req), id, b?.reason); }
}
