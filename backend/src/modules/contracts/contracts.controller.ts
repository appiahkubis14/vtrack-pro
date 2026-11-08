import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ADMIN_ROLES, FINANCE_ROLES, currentUser } from '../../common/auth/auth-user';
import { Role } from '../../common/constants/roles.constant';
import { DataScopeService } from '../hubs/data-scope.service';
import { OwnerInput, OwnersService } from './owners.service';
import { ContractInput, ContractsService } from './contracts.service';

const SALES_ROLES = [...ADMIN_ROLES, Role.FLEET_MANAGER, Role.FINANCE];
const VIEW_ROLES = [...SALES_ROLES, Role.AUDITOR, Role.INVESTOR];

@ApiTags('Owners and contracts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ContractsController {
  constructor(private readonly owners: OwnersService, private readonly contracts: ContractsService, private readonly scope: DataScopeService) {}

  @Get('owners') @Roles(...VIEW_ROLES)
  async listOwners(@Req() req: Request) { const u = currentUser(req); return this.owners.list(u.organizationId, await this.scope.forUser(u)); }

  @Post('owners') @Roles(...SALES_ROLES)
  createOwner(@Body() b: OwnerInput, @Req() req: Request) { return this.owners.create(currentUser(req).organizationId, b); }

  @Get('owners/:id') @Roles(...VIEW_ROLES)
  async getOwner(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const u = currentUser(req); this.scope.assertOwner(await this.scope.forUser(u), id); return this.owners.get(u.organizationId, id);
  }

  @Put('owners/:id') @Roles(...SALES_ROLES)
  updateOwner(@Param('id', ParseUUIDPipe) id: string, @Body() b: OwnerInput, @Req() req: Request) { return this.owners.update(currentUser(req).organizationId, id, b); }

  @Get('contracts') @Roles(...VIEW_ROLES)
  async list(@Query() q: { status?: string; ownerId?: string }, @Req() req: Request) {
    const u = currentUser(req); return this.contracts.list(u.organizationId, await this.scope.forUser(u), q);
  }

  @Post('contracts') @Roles(...SALES_ROLES)
  create(@Body() b: ContractInput, @Req() req: Request) { return this.contracts.create(currentUser(req), b); }

  @Get('contracts/:id') @Roles(...VIEW_ROLES)
  async get(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const u = currentUser(req); return this.contracts.get(u.organizationId, id, await this.scope.forUser(u));
  }

  @Put('contracts/:id') @Roles(...SALES_ROLES)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() b: ContractInput, @Req() req: Request) { return this.contracts.update(currentUser(req), id, b ?? {}); }

  @Post('contracts/:id/activate') @Roles(...FINANCE_ROLES)
  activate(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) { return this.contracts.activate(currentUser(req), id); }

  @Post('contracts/:id/payments') @Roles(...FINANCE_ROLES)
  pay(@Param('id', ParseUUIDPipe) id: string, @Body() b: { amountPesewas?: number; reference?: string }, @Req() req: Request) { return this.contracts.recordPayment(currentUser(req), id, b); }

  @Post('contracts/:id/cancel') @Roles(...FINANCE_ROLES)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) { return this.contracts.cancel(currentUser(req), id); }

  @Post('contracts/:id/default') @Roles(...FINANCE_ROLES)
  markDefault(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) { return this.contracts.markDefaulted(currentUser(req).organizationId, id); }

  @Post('contracts/:id/reinstate') @Roles(...FINANCE_ROLES)
  reinstate(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) { return this.contracts.reinstate(currentUser(req).organizationId, id); }

  @Post('contracts/:id/repossess') @Roles(...ADMIN_ROLES)
  repossess(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) { return this.contracts.repossess(currentUser(req), id); }
}
