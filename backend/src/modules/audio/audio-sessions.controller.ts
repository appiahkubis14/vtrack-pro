import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AudioSessionsService } from './audio-sessions.service';
import { EvidenceChainEngine } from './engines/evidence-chain.engine';
import { AudioStorageService } from './audio-storage.service';
import { Role } from '../../common/constants/roles.constant';

@ApiTags('Audio Monitoring')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('audio/sessions')
export class AudioSessionsController {
  constructor(
    private readonly audioSessionsService: AudioSessionsService,
    private readonly evidenceChain: EvidenceChainEngine,
    private readonly storage: AudioStorageService,
  ) {}

  @Post('')
  @ApiOperation({ summary: 'Request an audio session - runs the mandatory policy/consent check before any recording can start' })
  create(@Body() body: any, @Req() req: Request) {
    const user = req.user as { sub: string; organizationId: string };
    return this.audioSessionsService.create(body, user.organizationId, user.sub);
  }

  @Get('')
  @ApiOperation({ summary: "List audio sessions for the caller's organization" })
  findAll(@Query() query: any, @Req() req: Request) {
    const user = req.user as { organizationId: string };
    return this.audioSessionsService.findAll({ ...query, organizationId: user.organizationId });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an audio session' })
  findOne(@Param('id') id: string) {
    return this.audioSessionsService.findOne(id);
  }

  @Post(':id/start')
  @ApiOperation({ summary: 'Approve a pending covert session request (requires a second, non-requesting approver)' })
  start(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as { sub: string; role: Role };
    return this.audioSessionsService.approveSession(id, user.sub, user.role);
  }

  @Post(':id/clips')
  @ApiOperation({ summary: 'Upload an audio clip for an active session (base64-encoded bytes)' })
  uploadClip(@Param('id') id: string, @Body() body: { audioBase64: string; latitude?: number; longitude?: number }) {
    const buffer = Buffer.from(body.audioBase64, 'base64');
    return this.audioSessionsService.ingestClip(id, buffer, new Date(), body.latitude, body.longitude);
  }

  @Post(':id/stop')
  @ApiOperation({ summary: 'End an active recording session' })
  stop(@Param('id') id: string) {
    return this.audioSessionsService.endSession(id);
  }

  @Get(':id/evidence')
  @ApiOperation({ summary: 'Build a formal chain-of-custody evidence export, verifying every clip against its stored hash by re-reading the actual file bytes' })
  async evidence(@Param('id') id: string, @Query('caseReference') caseReference: string, @Req() req: Request) {
    const user = req.user as { sub: string };
    const clips = await this.audioSessionsService.clipsForSession(id);

    const clipBuffers = new Map<string, Buffer>();
    for (const clip of clips) {
      clipBuffers.set(clip.id, await this.storage.read(clip.storageLocation));
    }
    return this.evidenceChain.createExport(id, clipBuffers, user.sub, caseReference);
  }
}
