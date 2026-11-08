import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EnergyService } from './energy.service';
import { CreateChargeScheduleDto } from './dto/create-charge-schedule.dto';
import { StartChargingSessionDto } from './dto/start-charging-session.dto';

@ApiTags('EV Energy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('vehicles/:id')
export class EnergyController {
  constructor(private readonly energyService: EnergyService) {}

  @Get('ev-state')
  @ApiOperation({ summary: "Vehicle's latest EV telemetry (SoC, SoH, charging status, faults)" })
  evState(@Param('id') id: string) {
    return this.energyService.getEvState(id);
  }

  @Get('charging-sessions')
  @ApiOperation({ summary: 'Charging session history' })
  chargingSessions(@Param('id') id: string) {
    return this.energyService.listChargingSessions(id);
  }

  @Post('charging-sessions')
  @ApiOperation({ summary: 'Start a charging session' })
  startSession(@Param('id') id: string, @Body() dto: StartChargingSessionDto, @Req() req: Request) {
    const user = req.user as { organizationId: string };
    return this.energyService.startChargingSession(id, user.organizationId, dto);
  }

  @Get('energy-report')
  @ApiOperation({ summary: 'Energy consumption + cost summary' })
  energyReport(@Param('id') id: string) {
    return this.energyService.energyReport(id);
  }

  @Post('charge-schedule')
  @ApiOperation({ summary: 'Compute and save a smart charging schedule for a target SoC + departure time' })
  createSchedule(@Param('id') id: string, @Body() dto: CreateChargeScheduleDto, @Req() req: Request) {
    const user = req.user as { organizationId: string };
    return this.energyService.createChargeSchedule(id, user.organizationId, dto);
  }
}

@ApiTags('EV Energy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ev')
export class EvFleetController {
  constructor(private readonly energyService: EnergyService) {}

  @Get('battery-health')
  @ApiOperation({ summary: 'Fleet-wide EV battery health summary (latest SoH per vehicle)' })
  batteryHealth(@Query('organizationId') organizationId?: string) {
    return this.energyService.batteryHealth(organizationId);
  }
}

@ApiTags('EV Energy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('charging-sessions')
export class ChargingSessionsController {
  constructor(private readonly energyService: EnergyService) {}

  @Put(':sessionId/end')
  @ApiOperation({ summary: 'End a charging session' })
  end(@Param('sessionId') sessionId: string, @Body() body: any) {
    return this.energyService.endChargingSession(sessionId, body);
  }
}
