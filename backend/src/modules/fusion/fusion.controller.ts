import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SensorFusionService } from './sensor-fusion.service';
import { AssignDeviceRoleDto } from './dto/assign-device-role.dto';
import { DigitalTwinService } from '../twin/digital-twin.service';

@ApiTags('Multi-Tracker')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('vehicles/:id')
export class FusionController {
  constructor(
    private readonly fusionService: SensorFusionService,
    private readonly twinService: DigitalTwinService,
  ) {}

  @Get('devices')
  @ApiOperation({ summary: 'List devices attached to this vehicle, with role + trust level' })
  devices(@Param('id') id: string) {
    return this.fusionService.listDevicesForVehicle(id);
  }

  @Post('devices')
  @ApiOperation({ summary: 'Attach a device to this vehicle with a role' })
  addDevice(@Param('id') id: string, @Body() dto: AssignDeviceRoleDto) {
    return this.fusionService.addDevice(id, dto.deviceId, dto.role, dto.trustLevel);
  }

  @Put('devices/:deviceId/role')
  @ApiOperation({ summary: "Change a device's role for this vehicle" })
  setRole(@Param('id') id: string, @Param('deviceId') deviceId: string, @Body() body: { role: string }) {
    return this.fusionService.setRole(id, deviceId, body.role as any);
  }

  @Delete('devices/:deviceId')
  @ApiOperation({ summary: 'Detach a device from this vehicle' })
  removeDevice(@Param('id') id: string, @Param('deviceId') deviceId: string) {
    return this.fusionService.removeDevice(id, deviceId);
  }

  @Get('sensor-fusion')
  @ApiOperation({ summary: 'Current fused digital twin state plus contributing device list' })
  async sensorFusion(@Param('id') id: string) {
    const [state, devices] = await Promise.all([
      this.twinService.get(id),
      this.fusionService.listDevicesForVehicle(id),
    ]);
    return { state, contributingDevices: devices };
  }
}
