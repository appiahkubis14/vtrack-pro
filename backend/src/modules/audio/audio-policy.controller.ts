import { Body, Controller, Get, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AudioPolicyService } from './audio-policy.service';

@ApiTags('Audio Monitoring')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('audio/consents')
export class AudioConsentsController {
  constructor(private readonly audioPolicyService: AudioPolicyService) {}

  @Get('')
  @ApiOperation({ summary: "List consent records for the caller's organization" })
  findAll(@Query() query: any, @Req() req: Request) {
    const user = req.user as { organizationId: string };
    return this.audioPolicyService.listConsents({ ...query, organizationId: user.organizationId });
  }

  @Post('')
  @ApiOperation({ summary: 'Record a new consent (e.g. a signed driver consent form)' })
  create(@Body() body: any, @Req() req: Request) {
    const user = req.user as { sub: string; organizationId: string };
    return this.audioPolicyService.createConsent({ ...body, organizationId: user.organizationId }, user.sub);
  }
}

@ApiTags('Audio Monitoring')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('audio/policies')
export class AudioPoliciesController {
  constructor(private readonly audioPolicyService: AudioPolicyService) {}

  @Get('')
  @ApiOperation({ summary: "List audio policies for the caller's organization" })
  findAll(@Req() req: Request) {
    const user = req.user as { organizationId: string };
    return this.audioPolicyService.listPolicies(user.organizationId);
  }

  @Put('')
  @ApiOperation({ summary: 'Set the audio recording policy - disabled by default until explicitly configured' })
  setPolicy(@Body() body: any, @Req() req: Request) {
    const user = req.user as { sub: string; organizationId: string };
    return this.audioPolicyService.setPolicy(user.organizationId, body, user.sub);
  }
}
