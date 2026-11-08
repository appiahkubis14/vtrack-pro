import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DriversService } from './drivers.service';

@ApiTags('Drivers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('drivers')
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  @Get('')
  @ApiOperation({ summary: 'List drivers' })
  findAll(@Query() query: any) {
    return this.driversService.findAll(query);
  }

  @Post('')
  @ApiOperation({ summary: 'Create a driver' })
  create(@Body() body: any) {
    return this.driversService.create(body);
  }

  @Get('leaderboard')
  @ApiOperation({ summary: 'Driver leaderboard' })
  leaderboard(@Query() query: any) {
    return this.driversService.leaderboard(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a driver' })
  findOne(@Param('id') id: string) {
    return this.driversService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a driver' })
  update(@Param('id') id: string, @Body() body: any) {
    return this.driversService.update(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a driver' })
  remove(@Param('id') id: string) {
    return this.driversService.remove(id);
  }

  @Get(':id/score')
  @ApiOperation({ summary: 'Driver behavior score' })
  score(@Param('id') id: string) {
    return this.driversService.score(id);
  }

  @Get(':id/trips')
  @ApiOperation({ summary: 'Trips for this driver' })
  trips(@Param('id') id: string) {
    return this.driversService.trips(id);
  }

  @Post(':id/assign')
  @ApiOperation({ summary: 'Assign to a vehicle' })
  assign(@Param('id') id: string, @Body() body: any) {
    return this.driversService.assign(id, body);
  }

  @Post(':id/unassign')
  @ApiOperation({ summary: 'Unassign from a vehicle' })
  unassign(@Param('id') id: string, @Body() body: any) {
    return this.driversService.unassign(id, body);
  }
}
