import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SimProfilesService } from './sim-profiles.service';

@ApiTags('Roaming')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sim-profiles')
export class SimProfilesController {
  constructor(private readonly simProfilesService: SimProfilesService) {}

  @Get('')
  @ApiOperation({ summary: "List SIM profiles for the caller's organization" })
  findAll(@Query() query: any, @Req() req: Request) {
    const user = req.user as { organizationId: string };
    return this.simProfilesService.findAll({ ...query, organizationId: user.organizationId });
  }

  @Post('')
  @ApiOperation({ summary: 'Register a SIM profile' })
  create(@Body() body: any, @Req() req: Request) {
    const user = req.user as { organizationId: string };
    return this.simProfilesService.create({ ...body, organizationId: user.organizationId });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a SIM profile' })
  findOne(@Param('id') id: string) {
    return this.simProfilesService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a SIM profile (including device reassignment)' })
  update(@Param('id') id: string, @Body() body: any) {
    return this.simProfilesService.update(id, body);
  }
}

@ApiTags('Roaming')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('roaming')
export class RoamingController {
  constructor(private readonly simProfilesService: SimProfilesService) {}

  @Get('events')
  @ApiOperation({ summary: 'Roaming event history (roaming start/end, data cap warnings, unexpected country)' })
  events(@Query() query: any) {
    return this.simProfilesService.listRoamingEvents(query);
  }
}
