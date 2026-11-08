import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PortableAssetsService } from './portable-assets.service';
import { Role } from '../../common/constants/roles.constant';

@ApiTags('Portable Assets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('portable-assets')
export class PortableAssetsController {
  constructor(private readonly portableAssetsService: PortableAssetsService) {}

  @Get('')
  @ApiOperation({ summary: "List portable assets for the caller's organization" })
  findAll(@Query() query: any, @Req() req: Request) {
    const user = req.user as { organizationId: string };
    return this.portableAssetsService.findAll({ ...query, organizationId: user.organizationId });
  }

  @Post('')
  @ApiOperation({ summary: 'Register a portable/magnetic asset tracker' })
  create(@Body() body: any, @Req() req: Request) {
    const user = req.user as { organizationId: string };
    return this.portableAssetsService.create({ ...body, organizationId: user.organizationId });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a portable asset' })
  findOne(@Param('id') id: string) {
    return this.portableAssetsService.findOne(id);
  }

  @Post(':id/deploy')
  @ApiOperation({ summary: 'Deploy a tracker to an asset for a bounded period (supports covert mode requests)' })
  deploy(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const user = req.user as { sub: string; role: Role };
    return this.portableAssetsService.createDeployment({ ...body, portableAssetId: id }, user.sub, user.role);
  }

  @Post(':id/return')
  @ApiOperation({ summary: 'Process the return of a deployed asset' })
  returnAsset(@Param('id') id: string, @Body() body: { deploymentId: string; condition: any; checklist?: Record<string, boolean> }) {
    return this.portableAssetsService.returnAsset(body.deploymentId, body.condition, body.checklist);
  }

  @Get(':id/battery')
  @ApiOperation({ summary: 'Battery telemetry history for this asset' })
  battery(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.portableAssetsService.getBatteryHistory(id, limit ? Number(limit) : undefined);
  }

  @Post(':id/power-profile')
  @ApiOperation({ summary: 'Change the device power profile' })
  setPowerProfile(@Param('id') id: string, @Body() body: { profile: string }) {
    return this.portableAssetsService.setPowerProfile(id, body.profile);
  }

  @Get(':id/deployments')
  @ApiOperation({ summary: 'Deployment history for this asset' })
  deployments(@Param('id') id: string) {
    return this.portableAssetsService.listDeployments(id);
  }
}

@ApiTags('Portable Assets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('deployments')
export class DeploymentsController {
  constructor(private readonly portableAssetsService: PortableAssetsService) {}

  @Post(':id/approve-covert')
  @ApiOperation({ summary: 'Approve a pending covert deployment request (requires a second, non-requesting approver)' })
  approveCovert(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as { sub: string; role: Role };
    return this.portableAssetsService.approveCovertDeployment(id, user.sub, user.role);
  }

  @Get(':id/audit-log')
  @ApiOperation({ summary: 'Covert mode audit trail for a deployment' })
  auditLog(@Param('id') id: string) {
    return this.portableAssetsService.auditHistory(id);
  }
}
