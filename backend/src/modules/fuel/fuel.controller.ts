import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FuelService } from './fuel.service';

@ApiTags('Fuel')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fuel')
export class FuelController {
  constructor(private readonly fuelService: FuelService) {}

  @Get('consumption')
  @ApiOperation({ summary: 'Fleet-wide consumption' })
  consumptionOverview(@Query() query: any) {
    return this.fuelService.consumptionOverview(query);
  }

  @Get(':deviceId/consumption')
  @ApiOperation({ summary: 'Consumption for a device' })
  consumptionByDevice(@Param('deviceId') deviceId: string) {
    return this.fuelService.consumptionByDevice(deviceId);
  }

  @Get(':deviceId/level')
  @ApiOperation({ summary: 'Current fuel level' })
  levelByDevice(@Param('deviceId') deviceId: string) {
    return this.fuelService.levelByDevice(deviceId);
  }

  @Get(':deviceId/theft-detection')
  @ApiOperation({ summary: 'Fuel theft events' })
  theftEvents(@Param('deviceId') deviceId: string) {
    return this.fuelService.theftEvents(deviceId);
  }

  @Get(':deviceId/refueling')
  @ApiOperation({ summary: 'Refueling events' })
  refuelingEvents(@Param('deviceId') deviceId: string) {
    return this.fuelService.refuelingEvents(deviceId);
  }

  @Get('reports')
  @ApiOperation({ summary: 'Fuel reports' })
  reports(@Query() query: any) {
    return this.fuelService.reports(query);
  }

  @Post('sensor/calibrate')
  @ApiOperation({ summary: 'Calibrate a fuel sensor' })
  calibrateSensor(@Body() body: any) {
    return this.fuelService.calibrateSensor(body);
  }
}
