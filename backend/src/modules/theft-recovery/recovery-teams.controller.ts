import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RecoveryTeam } from './entities/recovery-team.entity';

@ApiTags('Theft Recovery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('recovery-teams')
export class RecoveryTeamsController {
  constructor(@InjectRepository(RecoveryTeam) private readonly teams: Repository<RecoveryTeam>) {}

  @Get('')
  @ApiOperation({ summary: "List recovery teams for the caller's organization" })
  findAll(@Req() req: Request) {
    const user = req.user as { organizationId: string };
    return this.teams.find({ where: { organizationId: user.organizationId, isActive: true } });
  }

  @Post('')
  @ApiOperation({ summary: 'Register a recovery team' })
  create(@Body() body: { name: string; contactPhone?: string }, @Req() req: Request) {
    const user = req.user as { organizationId: string };
    return this.teams.save(this.teams.create({ ...body, organizationId: user.organizationId }));
  }
}
