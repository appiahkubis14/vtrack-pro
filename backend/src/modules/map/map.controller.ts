import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ADMIN_ROLES, currentUser } from '../../common/auth/auth-user';
import { Role } from '../../common/constants/roles.constant';
import { MapService } from './map.service';
import { GeocodeService } from './geocode.service';
import { DispatchService } from './dispatch.service';

/** Who may look at the map. Hub managers see only their hubs' vehicles (DataScopeService); drivers, riders and investors use their own screens. */
export const MAP_READ: Role[] = [...ADMIN_ROLES, Role.FLEET_MANAGER, Role.HUB_MANAGER, Role.DISPATCHER, Role.FINANCE, Role.AUDITOR, Role.VIEWER];
const MAP_WRITE: Role[] = [...ADMIN_ROLES, Role.FLEET_MANAGER, Role.DISPATCHER];

@ApiTags('Map')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('map')
export class MapController {
  constructor(private readonly map: MapService, private readonly geo: GeocodeService, private readonly dispatch: DispatchService) {}

  @Get('config') @Roles(...MAP_READ)
  config(@Req() req: Request) { return this.map.config(currentUser(req)); }

  @Get('fleet') @Roles(...MAP_READ)
  fleet(@Req() req: Request) { return this.map.fleet(currentUser(req)); }

  @Get('history') @Roles(...MAP_READ)
  history(@Query() q: any, @Req() req: Request) { return this.map.history(currentUser(req), q); }

  @Get('heatmap') @Roles(...MAP_READ)
  heatmap(@Query() q: any, @Req() req: Request) { return this.map.heatmap(currentUser(req), q); }

  @Get('events') @Roles(...MAP_READ)
  events(@Query() q: any, @Req() req: Request) { return this.map.events(currentUser(req), q); }

  @Get('geocode/search') @Roles(...MAP_READ)
  search(@Query('q') q: string, @Query('lat') lat: string, @Query('lng') lng: string) {
    const near = lat !== undefined && lng !== undefined && isFinite(Number(lat)) && isFinite(Number(lng)) ? { lat: Number(lat), lng: Number(lng) } : undefined;
    return this.geo.search(q, near);
  }

  @Get('geocode/reverse') @Roles(...MAP_READ)
  reverse(@Query('lat') lat: string, @Query('lng') lng: string) { return this.geo.reverse(Number(lat), Number(lng)); }

  @Get('pois') @Roles(...MAP_READ)
  pois(@Req() req: Request) { return this.map.listPois(currentUser(req)); }

  @Post('pois') @Roles(...MAP_WRITE)
  createPoi(@Body() b: any, @Req() req: Request) { return this.map.createPoi(currentUser(req), b); }

  @Put('pois/:id') @Roles(...MAP_WRITE)
  updatePoi(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Req() req: Request) { return this.map.updatePoi(currentUser(req), id, b); }

  @Delete('pois/:id') @Roles(...MAP_WRITE)
  removePoi(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) { return this.map.removePoi(currentUser(req), id); }

  @Put('vehicles/:id/icon') @Roles(...MAP_WRITE)
  icon(@Param('id', ParseUUIDPipe) id: string, @Body() b: { icon: string | null }, @Req() req: Request) { return this.map.setIcon(currentUser(req), id, b?.icon ?? null); }

  @Put('vehicles/:id/destination') @Roles(...MAP_WRITE)
  async setDest(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Req() req: Request) { const u = currentUser(req); const r = await this.map.setDestination(u, id, b); await this.dispatch.checkNow(u.organizationId, id); return r; }

  @Delete('vehicles/:id/destination') @Roles(...MAP_WRITE)
  clearDest(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) { return this.map.clearDestination(currentUser(req), id); }

  @Post('vehicles/:id/eta') @Roles(...MAP_READ)
  eta(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Req() req: Request) { return this.map.eta(currentUser(req), id, b ?? {}); }
}
