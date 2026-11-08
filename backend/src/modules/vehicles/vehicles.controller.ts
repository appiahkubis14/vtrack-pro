import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ADMIN_ROLES, currentUser } from '../../common/auth/auth-user';
import { Role } from '../../common/constants/roles.constant';
import { VehiclesService } from './vehicles.service';
import { VehicleHistoryService } from './vehicle-history.service';

const READ: Role[] = [...ADMIN_ROLES, Role.FLEET_MANAGER, Role.HUB_MANAGER, Role.DISPATCHER, Role.FINANCE, Role.AUDITOR, Role.VIEWER];
const WRITE: Role[] = [...ADMIN_ROLES, Role.FLEET_MANAGER, Role.HUB_MANAGER];

@ApiTags('Vehicles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService, private readonly history: VehicleHistoryService) {}

  @Get('') @Roles(...READ)
  @ApiOperation({ summary: "List vehicles (search, status, fuelType, hubId, lifecycle, sort, dir, page, limit)" })
  findAll(@Query() query: any, @Req() req: Request) { return this.vehiclesService.findAll(currentUser(req), query); }

  @Post('') @Roles(...WRITE)
  @ApiOperation({ summary: 'Register a vehicle' })
  create(@Body() body: any, @Req() req: Request) { return this.vehiclesService.create(currentUser(req), body); }

  @Get(':id/history') @Roles(...READ)
  @ApiOperation({ summary: 'Vehicle history: summary, analysis and findings for a period (days or from/to)' })
  historyAnalysis(@Param('id') id: string, @Query() q: any, @Req() req: Request) { return this.history.analysis(currentUser(req), id, q); }

  @Get(':id/history/events') @Roles(...READ)
  @ApiOperation({ summary: 'Vehicle activity timeline (types, before, limit)' })
  historyEvents(@Param('id') id: string, @Query() q: any, @Req() req: Request) { return this.history.events(currentUser(req), id, q); }

  @Get(':id/history/route') @Roles(...READ)
  @ApiOperation({ summary: 'Route driven in the period as polyline segments' })
  historyRoute(@Param('id') id: string, @Query() q: any, @Req() req: Request) { return this.history.route(currentUser(req), id, q); }

  @Get(':id') @Roles(...READ)
  @ApiOperation({ summary: 'Get a vehicle' })
  findOne(@Param('id') id: string, @Req() req: Request) { return this.vehiclesService.findOne(currentUser(req), id); }

  @Put(':id') @Roles(...WRITE)
  @ApiOperation({ summary: 'Update a vehicle' })
  update(@Param('id') id: string, @Body() body: any, @Req() req: Request) { return this.vehiclesService.update(currentUser(req), id, body); }

  @Delete(':id') @Roles(...WRITE)
  @ApiOperation({ summary: 'Delete a vehicle' })
  remove(@Param('id') id: string, @Req() req: Request) { return this.vehiclesService.remove(currentUser(req), id); }

  @Get(':id/maintenance') @Roles(...READ)
  @ApiOperation({ summary: 'Maintenance history' })
  listMaintenance(@Param('id') id: string, @Req() req: Request) { return this.vehiclesService.listMaintenance(currentUser(req), id); }

  @Post(':id/maintenance') @Roles(...WRITE)
  @ApiOperation({ summary: 'Schedule maintenance' })
  scheduleMaintenance(@Param('id') id: string, @Body() body: any, @Req() req: Request) { return this.vehiclesService.scheduleMaintenance(currentUser(req), id, body); }
}
