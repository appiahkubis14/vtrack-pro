import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ADMIN_ROLES, currentUser } from '../../common/auth/auth-user';
import { Role } from '../../common/constants/roles.constant';
import { TeamService } from './team.service';
import { PortalService } from './portal.service';

@ApiTags('Team and portals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class TeamController {
  constructor(private readonly team: TeamService, private readonly portal: PortalService) {}

  @Get('team/users') @Roles(...ADMIN_ROLES)
  list(@Req() req: Request) { return this.team.list(currentUser(req)); }

  @Post('team/users') @Roles(...ADMIN_ROLES)
  create(@Body() b: any, @Req() req: Request) { return this.team.create(currentUser(req), b ?? {}); }

  @Post('team/users/:id/deactivate') @Roles(...ADMIN_ROLES)
  deactivate(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) { return this.team.setActive(currentUser(req), id, false); }

  @Post('team/users/:id/activate') @Roles(...ADMIN_ROLES)
  activate(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) { return this.team.setActive(currentUser(req), id, true); }

  @Post('team/users/:id/reset-password') @Roles(...ADMIN_ROLES)
  reset(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) { return this.team.resetPassword(currentUser(req), id); }

  // any signed-in user
  @Get('account/me')
  me(@Req() req: Request) { return this.team.me(currentUser(req)); }

  @Post('account/change-password')
  change(@Body() b: { currentPassword: string; newPassword: string }, @Req() req: Request) { return this.team.changeOwnPassword(currentUser(req), b?.currentPassword, b?.newPassword); }

  // portals
  @Get('portal/investor') @Roles(Role.INVESTOR)
  investor(@Req() req: Request) { return this.portal.investor(currentUser(req)); }

  @Get('portal/rider') @Roles(Role.RIDER)
  rider(@Req() req: Request) { return this.portal.rider(currentUser(req)); }
}
