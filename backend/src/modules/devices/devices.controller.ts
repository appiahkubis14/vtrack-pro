import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ADMIN_ROLES } from '../../common/auth/auth-user';
import { Role } from '../../common/constants/roles.constant';
import { DevicesService } from './devices.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { BulkImportDeviceDto } from './dto/bulk-import-device.dto';
import { SendDeviceCommandDto } from './dto/send-device-command.dto';

const WRITE: Role[] = [...ADMIN_ROLES, Role.FLEET_MANAGER, Role.HUB_MANAGER];

@ApiTags('Devices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get()
  @ApiOperation({ summary: "List devices for the caller's organization" })
  findAll(@Query() query: any, @Req() req: Request) {
    const user = req.user as { organizationId: string };
    return this.devicesService.findAll({ ...query, organizationId: user.organizationId });
  }

  @Post() @Roles(...WRITE)
  @ApiOperation({ summary: 'Register a device' })
  create(@Body() dto: CreateDeviceDto, @Req() req: Request) {
    const user = req.user as { organizationId: string };
    return this.devicesService.create({ ...dto, organizationId: user.organizationId });
  }

  @Get('statistics')
  @ApiOperation({ summary: 'Fleet-wide device statistics (online/offline counts)' })
  statistics(@Req() req: Request) {
    const user = req.user as { organizationId: string };
    return this.devicesService.statistics(user.organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a device' })
  findOne(@Param('id') id: string, @Req() req: Request) {
    return this.devicesService.findOne(id, (req.user as { organizationId: string }).organizationId);
  }

  @Put(':id') @Roles(...WRITE)
  @ApiOperation({ summary: 'Update a device' })
  update(@Param('id') id: string, @Body() dto: UpdateDeviceDto, @Req() req: Request) {
    return this.devicesService.update(id, dto, (req.user as { organizationId: string }).organizationId);
  }

  @Delete(':id') @Roles(...WRITE)
  @ApiOperation({ summary: 'Delete a device' })
  remove(@Param('id') id: string, @Req() req: Request) {
    return this.devicesService.remove(id, (req.user as { organizationId: string }).organizationId);
  }

  @Post('bulk-import') @Roles(...WRITE)
  @ApiOperation({ summary: 'Bulk import devices (CSV/Excel parsed client-side or via reports module)' })
  bulkImport(@Body() dto: BulkImportDeviceDto, @Req() req: Request) {
    const user = req.user as { organizationId: string };
    return this.devicesService.bulkImport(dto, user.organizationId);
  }

  @Post(':id/command') @Roles(...WRITE)
  @ApiOperation({ summary: 'Send a remote command to a device' })
  sendCommand(@Param('id') id: string, @Body() dto: SendDeviceCommandDto, @Req() req: Request) {
    const user = req.user as { sub: string; organizationId: string };
    return this.devicesService.sendCommand(id, user.sub, dto, user.organizationId);
  }

  @Get(':id/commands')
  @ApiOperation({ summary: 'Command history for a device' })
  listCommands(@Param('id') id: string, @Req() req: Request) {
    return this.devicesService.listCommands(id, (req.user as { organizationId: string }).organizationId);
  }

  @Post(':id/update-config') @Roles(...WRITE)
  @ApiOperation({ summary: 'Update device configuration (report interval, sensors, thresholds)' })
  updateConfig(@Param('id') id: string, @Body() config: Record<string, unknown>, @Req() req: Request) {
    return this.devicesService.updateConfig(id, config, (req.user as { organizationId: string }).organizationId);
  }
}
