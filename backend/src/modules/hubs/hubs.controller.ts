import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ADMIN_ROLES, OPS_ROLES, currentUser } from '../../common/auth/auth-user';
import { Role } from '../../common/constants/roles.constant';
import { DataScopeService } from './data-scope.service';
import { HubInput, HubsService } from './hubs.service';
import { PowerSource } from './entities/hub.entity';

@ApiTags('Hubs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('hubs')
export class HubsController {
  constructor(private readonly hubs: HubsService, private readonly scope: DataScopeService) {}

  @Get()
  @Roles(...OPS_ROLES, Role.FINANCE, Role.AUDITOR)
  @ApiOperation({ summary: 'List hubs (hub managers see only their own)' })
  async list(@Req() req: Request) {
    const user = currentUser(req);
    return this.hubs.list(user.organizationId, await this.scope.forUser(user));
  }

  @Post()
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Create a hub' })
  create(@Body() body: HubInput, @Req() req: Request) {
    return this.hubs.create(currentUser(req).organizationId, body);
  }

  @Get(':id')
  @Roles(...OPS_ROLES, Role.FINANCE, Role.AUDITOR)
  async get(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const user = currentUser(req);
    this.scope.assertHub(await this.scope.forUser(user), id);
    return this.hubs.get(user.organizationId, id);
  }

  @Put(':id')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Update a hub, including assigning its manager' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: HubInput, @Req() req: Request) {
    return this.hubs.update(currentUser(req).organizationId, id, body);
  }

  @Get(':id/charge-points')
  @Roles(...OPS_ROLES, Role.FINANCE, Role.AUDITOR)
  async chargePoints(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const user = currentUser(req);
    this.scope.assertHub(await this.scope.forUser(user), id);
    return this.hubs.listChargePoints(user.organizationId, id);
  }

  @Post(':id/charge-points')
  @Roles(...ADMIN_ROLES)
  addChargePoint(@Param('id', ParseUUIDPipe) id: string, @Body() body: { name?: string; powerSource?: PowerSource }, @Req() req: Request) {
    return this.hubs.addChargePoint(currentUser(req).organizationId, id, body);
  }
}
