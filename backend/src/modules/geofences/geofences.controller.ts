import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ADMIN_ROLES, currentUser } from '../../common/auth/auth-user';
import { Role } from '../../common/constants/roles.constant';
import { GeofencesService } from './geofences.service';

const READ = [...ADMIN_ROLES, Role.FLEET_MANAGER, Role.HUB_MANAGER, Role.DISPATCHER, Role.FINANCE, Role.AUDITOR, Role.VIEWER];
const WRITE = [...ADMIN_ROLES, Role.FLEET_MANAGER, Role.DISPATCHER];

@ApiTags('Geofences')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('geofences')
export class GeofencesController {
  constructor(private readonly geofencesService: GeofencesService) {}

  @Get('') @Roles(...READ) @ApiOperation({ summary: 'List geofences of your organization' })
  findAll(@Req() req: Request) { return this.geofencesService.findAll(currentUser(req)); }

  @Post('') @Roles(...WRITE) @ApiOperation({ summary: 'Create a geofence (circle, polygon or rectangle; a circle may follow a vehicle)' })
  create(@Body() body: any, @Req() req: Request) { return this.geofencesService.create(currentUser(req), body); }

  @Get('active') @Roles(...READ) @ApiOperation({ summary: 'Active geofences' })
  active(@Req() req: Request) { return this.geofencesService.active(currentUser(req)); }

  @Get(':id') @Roles(...READ) @ApiOperation({ summary: 'Get a geofence' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) { return this.geofencesService.findOne(currentUser(req), id); }

  @Put(':id') @Roles(...WRITE) @ApiOperation({ summary: 'Update a geofence' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: any, @Req() req: Request) { return this.geofencesService.update(currentUser(req), id, body); }

  @Delete(':id') @Roles(...WRITE) @ApiOperation({ summary: 'Delete a geofence' })
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) { return this.geofencesService.remove(currentUser(req), id); }

  @Post(':id/test') @Roles(...READ) @ApiOperation({ summary: 'Test a point against a geofence' })
  test(@Param('id', ParseUUIDPipe) id: string, @Body() body: any, @Req() req: Request) { return this.geofencesService.test(currentUser(req), id, body); }

  @Get(':id/events') @Roles(...READ) @ApiOperation({ summary: 'Entry/exit events' })
  events(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) { return this.geofencesService.events(currentUser(req), id); }
}
