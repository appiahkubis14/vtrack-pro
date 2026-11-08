import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationsService } from './organizations.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/constants/roles.constant';
import { ADMIN_ROLES, currentUser } from '../../common/auth/auth-user';

/** An organization admin may touch only their own organization; only a super admin may list, create or delete organizations. */
function ownOrgOnly(req: Request, id: string) {
  const u = currentUser(req);
  if (u.role !== Role.SUPER_ADMIN && u.organizationId !== id) throw new ForbiddenException('You can only access your own organization');
}

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ADMIN_ROLES)
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get('')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'List organizations' })
  findAll(@Query() query: any) {
    return this.organizationsService.findAll(query);
  }

  @Post('')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create an organization' })
  create(@Body() body: any) {
    return this.organizationsService.create(body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an organization' })
  findOne(@Param('id') id: string, @Req() req: Request) {
    ownOrgOnly(req, id);
    return this.organizationsService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an organization' })
  update(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    ownOrgOnly(req, id);
    return this.organizationsService.update(id, body);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete an organization' })
  remove(@Param('id') id: string) {
    return this.organizationsService.remove(id);
  }

  @Get(':id/users')
  @ApiOperation({ summary: 'List users in an organization' })
  listUsers(@Param('id') id: string, @Req() req: Request) {
    ownOrgOnly(req, id);
    return this.organizationsService.listUsers(id);
  }

  @Post(':id/users/invite')
  @ApiOperation({ summary: 'Invite a user' })
  inviteUser(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    ownOrgOnly(req, id);
    return this.organizationsService.inviteUser(id, body);
  }
}
