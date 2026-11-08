import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TheftRecoveryService } from './theft-recovery.service';
import { TheftCaseStatus } from './entities/theft-case.entity';
import { Role } from '../../common/constants/roles.constant';

@ApiTags('Theft Recovery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('theft-cases')
export class TheftRecoveryController {
  constructor(private readonly theftRecoveryService: TheftRecoveryService) {}

  @Post('')
  @ApiOperation({ summary: 'Open a theft case for a vehicle - captures its last known digital-twin position automatically' })
  create(@Body() body: { vehicleId: string }, @Req() req: Request) {
    const user = req.user as { sub: string; organizationId: string };
    return this.theftRecoveryService.create(body.vehicleId, user.organizationId, user.sub);
  }

  @Get('')
  @ApiOperation({ summary: "List theft cases for the caller's organization" })
  findAll(@Query() query: any, @Req() req: Request) {
    const user = req.user as { organizationId: string };
    return this.theftRecoveryService.findAll({ ...query, organizationId: user.organizationId });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a theft case' })
  findOne(@Param('id') id: string) {
    return this.theftRecoveryService.findOne(id);
  }

  @Post(':id/activate')
  @ApiOperation({ summary: 'Escalate from suspected to active, and optionally enable high-frequency tracking' })
  async activate(@Param('id') id: string, @Body() body: { enableHighFrequency?: boolean }, @Req() req: Request) {
    const user = req.user as { sub: string };
    await this.theftRecoveryService.transitionStatus(id, TheftCaseStatus.ACTIVE, user.sub);
    if (body?.enableHighFrequency) {
      return this.theftRecoveryService.enableHighFrequencyMode(id, user.sub);
    }
    return this.theftRecoveryService.findOne(id);
  }

  @Post(':id/immobilize')
  @ApiOperation({ summary: 'Request remote immobilization - runs the mandatory speed safety check first' })
  immobilize(@Param('id') id: string, @Body() body: { emergencyOverride?: boolean; overrideReason?: string }, @Req() req: Request) {
    const user = req.user as { sub: string; role: Role };
    return this.theftRecoveryService.requestImmobilize(id, user.sub, user.role, Boolean(body?.emergencyOverride), body?.overrideReason);
  }

  @Post(':id/resolve')
  @ApiOperation({ summary: 'Close out a case as recovered / false alarm' })
  resolve(@Param('id') id: string, @Body() body: { status: TheftCaseStatus; notes?: string }, @Req() req: Request) {
    const user = req.user as { sub: string };
    return this.theftRecoveryService.transitionStatus(id, body.status, user.sub, body.notes);
  }

  @Post(':id/assign-team')
  @ApiOperation({ summary: 'Assign a recovery team to the case' })
  assignTeam(@Param('id') id: string, @Body() body: { teamId: string }, @Req() req: Request) {
    const user = req.user as { sub: string };
    return this.theftRecoveryService.assignTeam(id, body.teamId, user.sub);
  }

  @Post(':id/notes')
  @ApiOperation({ summary: 'Add an investigator note to the case' })
  addNote(@Param('id') id: string, @Body() body: { note: string }, @Req() req: Request) {
    const user = req.user as { sub: string };
    return this.theftRecoveryService.addNote(id, body.note, user.sub);
  }

  @Get(':id/notes')
  @ApiOperation({ summary: 'List investigator notes' })
  listNotes(@Param('id') id: string) {
    return this.theftRecoveryService.listNotes(id);
  }

  @Get(':id/events')
  @ApiOperation({ summary: 'Full case event timeline (status changes, commands, team assignment)' })
  listEvents(@Param('id') id: string) {
    return this.theftRecoveryService.listEvents(id);
  }

  @Get(':id/actions')
  @ApiOperation({ summary: 'Recovery actions taken on this case, including every immobilization attempt and its safety-check result' })
  listActions(@Param('id') id: string) {
    return this.theftRecoveryService.listActions(id);
  }
}
