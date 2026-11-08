import { Controller, ForbiddenException, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DigitalTwinService } from './digital-twin.service';
import { MapScopeService } from '../map/map-scope.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { MAP_READ } from '../map/map.controller';
import { AuthUser } from '../../common/auth/auth-user';

/** A live state may be shown only to someone allowed to see that vehicle, and never while the vehicle is off duty (driver privacy). */
async function canSee(scope: MapScopeService, user: AuthUser, state: { organizationId: string; vehicleId: string } | null) {
  if (!state || state.organizationId !== user.organizationId) return false;
  if (await scope.isOffDuty(user.organizationId, state.vehicleId)) return false;
  const s = await scope.hubScope(user);
  if (s.all) return true;
  const hub = await scope.hubOfVehicle(user.organizationId, state.vehicleId);
  return !!hub && s.hubIds.includes(hub);
}

@ApiTags('Digital Twin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('vehicles')
export class DigitalTwinController {
  constructor(private readonly twinService: DigitalTwinService, private readonly scope: MapScopeService) {}

  @Get(':id/digital-twin') @Roles(...MAP_READ)
  @ApiOperation({ summary: 'Live vehicle state (Redis-backed, sub-second)' })
  async get(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as AuthUser;
    const state = await this.twinService.get(id);
    if (state && state.organizationId !== user.organizationId) {
      throw new ForbiddenException('Vehicle does not belong to your organization');
    }
    return (await canSee(this.scope, user, state)) ? state : null;
  }
}

/** Fleet-wide live-map feed - separate controller so its base path stays clean. */
@ApiTags('Digital Twin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('twin')
export class TwinFleetController {
  constructor(private readonly twinService: DigitalTwinService, private readonly scope: MapScopeService) {}

  @Get('fleet') @Roles(...MAP_READ)
  @ApiOperation({ summary: "Live state for the caller's vehicles at once (fleet map feed)" })
  async fleet(@Query('vehicleIds') vehicleIds: string, @Req() req: Request) {
    const user = req.user as AuthUser;
    const ids = (vehicleIds ?? '').split(',').filter(Boolean).slice(0, 500);
    const states = await this.twinService.getMany(ids);

    // Drop any vehicle whose twin belongs to a different org - defense in
    // depth in case a caller passes IDs they don't actually own.
    for (const [vehicleId, state] of Object.entries(states)) {
      if (state && !(await canSee(this.scope, user, state))) {
        states[vehicleId] = null;
      }
    }
    return states;
  }
}
