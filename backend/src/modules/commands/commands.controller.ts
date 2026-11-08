import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CommandsService } from './commands.service';
import { DeviceTargetDto } from './dto/send-command.dto';

@ApiTags('Commands')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('commands')
export class CommandsController {
  constructor(private readonly commandsService: CommandsService) {}

  private dispatch(name: string, dto: DeviceTargetDto, req: Request, parameters?: Record<string, unknown>) {
    const user = req.user as { sub: string };
    return this.commandsService.dispatch(name, user.sub, dto, parameters);
  }

  @Post('')
  @ApiOperation({ summary: 'Send an arbitrary named command (generic entry point alongside the convenience routes below)' })
  send(@Body() body: DeviceTargetDto & { command: string; parameters?: Record<string, unknown> }, @Req() req: Request) {
    return this.dispatch(body.command, body, req, body.parameters);
  }

  @Get('history')
  @ApiOperation({ summary: 'Command history across the fleet' })
  history(@Query() query: { deviceId?: string; limit?: number }) {
    return this.commandsService.history(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a command by id' })
  findOne(@Param('id') id: string) {
    return this.commandsService.findOne(id);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a high-risk command awaiting approval' })
  approve(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as { sub: string };
    return this.commandsService.approve(id, user.sub);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a command that has not reached a terminal state' })
  cancel(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req: Request) {
    const user = req.user as { sub: string };
    return this.commandsService.cancel(id, user.sub, body?.reason);
  }

  @Get(':id/state-history')
  @ApiOperation({ summary: 'Full state transition history for a command' })
  stateHistory(@Param('id') id: string) {
    return this.commandsService.stateHistory(id);
  }

  @Post('engine/start')
  @ApiOperation({ summary: 'Remote engine start' })
  engineStart(@Body() dto: DeviceTargetDto, @Req() req: Request) {
    return this.dispatch('engine_start', dto, req);
  }

  @Post('engine/stop')
  @ApiOperation({ summary: 'Remote engine stop' })
  engineStop(@Body() dto: DeviceTargetDto, @Req() req: Request) {
    return this.dispatch('engine_stop', dto, req);
  }

  @Post('immobilizer/on')
  @ApiOperation({ summary: 'Enable immobilizer' })
  immobilizerOn(@Body() dto: DeviceTargetDto, @Req() req: Request) {
    return this.dispatch('immobilizer_on', dto, req);
  }

  @Post('immobilizer/off')
  @ApiOperation({ summary: 'Disable immobilizer' })
  immobilizerOff(@Body() dto: DeviceTargetDto, @Req() req: Request) {
    return this.dispatch('immobilizer_off', dto, req);
  }

  @Post('door/lock')
  @ApiOperation({ summary: 'Lock doors' })
  doorLock(@Body() dto: DeviceTargetDto, @Req() req: Request) {
    return this.dispatch('door_lock', dto, req);
  }

  @Post('door/unlock')
  @ApiOperation({ summary: 'Unlock doors' })
  doorUnlock(@Body() dto: DeviceTargetDto, @Req() req: Request) {
    return this.dispatch('door_unlock', dto, req);
  }

  @Post('fuel/cutoff')
  @ApiOperation({ summary: 'Cut fuel supply' })
  fuelCutoff(@Body() dto: DeviceTargetDto, @Req() req: Request) {
    return this.dispatch('fuel_cutoff', dto, req);
  }

  @Post('fuel/restore')
  @ApiOperation({ summary: 'Restore fuel supply' })
  fuelRestore(@Body() dto: DeviceTargetDto, @Req() req: Request) {
    return this.dispatch('fuel_restore', dto, req);
  }

  @Post('alarm/silent')
  @ApiOperation({ summary: 'Trigger silent alarm (SOS)' })
  alarmSilent(@Body() dto: DeviceTargetDto, @Req() req: Request) {
    return this.dispatch('alarm_silent', dto, req);
  }

  @Post('alarm/sound')
  @ApiOperation({ summary: 'Trigger audible alarm/siren' })
  alarmSound(@Body() dto: DeviceTargetDto, @Req() req: Request) {
    return this.dispatch('alarm_sound', dto, req);
  }

  @Post('device/reboot')
  @ApiOperation({ summary: 'Reboot device' })
  deviceReboot(@Body() dto: DeviceTargetDto, @Req() req: Request) {
    return this.dispatch('device_reboot', dto, req);
  }

  @Post('device/update-firmware')
  @ApiOperation({ summary: 'Trigger OTA firmware update' })
  updateFirmware(@Body() dto: DeviceTargetDto & { firmwareUrl: string }, @Req() req: Request) {
    return this.dispatch('firmware_update', dto, req, { firmwareUrl: dto.firmwareUrl });
  }
}
