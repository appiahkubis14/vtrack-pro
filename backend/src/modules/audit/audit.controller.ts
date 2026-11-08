import { Controller, Get, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/constants/roles.constant';
import { ADMIN_ROLES, currentUser } from '../../common/auth/auth-user';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuditService } from './audit.service';

@ApiTags('Audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ADMIN_ROLES, Role.AUDITOR)
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('logs')
  @ApiOperation({ summary: 'List audit log entries' })
  findAll(@Query() query: { userId?: string; resourceType?: string; limit?: string }, @Req() req: Request) {
    // Always limited to the caller's own organization: the organization is never taken from the query string.
    return this.auditService.findAll({ organizationId: currentUser(req).organizationId, userId: query.userId, resourceType: query.resourceType, limit: Math.min(Number(query.limit) || 100, 500) });
  }

  @Get('logs/:id')
  @ApiOperation({ summary: 'Get an audit log entry' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const log = await this.auditService.findOne(id);
    if (log.organizationId !== currentUser(req).organizationId) throw new (await import('@nestjs/common')).NotFoundException('Audit log not found');
    return log;
  }
}
