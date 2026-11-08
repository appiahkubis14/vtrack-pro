import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantLimitsService } from './tenant-limits.service';

@ApiTags('Tenant Commercial')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tenant/usage')
export class TenantLimitsController {
  constructor(private readonly tenantLimitsService: TenantLimitsService) {}

  @Get('')
  @ApiOperation({ summary: "Current device/user usage against the caller's organization limits, plus billing status" })
  usage(@Req() req: Request) {
    const user = req.user as { organizationId: string };
    return this.tenantLimitsService.usage(user.organizationId);
  }
}
