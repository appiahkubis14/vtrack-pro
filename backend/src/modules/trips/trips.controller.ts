import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TripsService } from './trips.service';

@ApiTags('Trips')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('trips')
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Get('')
  @ApiOperation({ summary: 'List trips' })
  findAll(@Query() query: any) {
    return this.tripsService.findAll(query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Trip summary report' })
  summary(@Query() query: any) {
    return this.tripsService.summary(query);
  }

  @Get('device/:deviceId')
  @ApiOperation({ summary: 'Trips for a device' })
  byDevice(@Param('deviceId') deviceId: string) {
    return this.tripsService.byDevice(deviceId);
  }

  @Get('driver/:driverId')
  @ApiOperation({ summary: 'Trips for a driver' })
  byDriver(@Param('driverId') driverId: string) {
    return this.tripsService.byDriver(driverId);
  }

  @Post('analyze')
  @ApiOperation({ summary: 'Trigger trip analysis' })
  analyze(@Body() body: any) {
    return this.tripsService.analyze(body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a trip' })
  findOne(@Param('id') id: string) {
    return this.tripsService.findOne(id);
  }

  @Get(':id/route')
  @ApiOperation({ summary: 'Trip route geometry for playback' })
  route(@Param('id') id: string) {
    return this.tripsService.route(id);
  }
}
