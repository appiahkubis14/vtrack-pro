import { Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PositionsService } from './positions.service';

@ApiTags('Positions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('positions')
export class PositionsController {
  constructor(private readonly positionsService: PositionsService) {}

  @Get()
  @ApiOperation({ summary: 'List recent positions (optionally filtered by device)' })
  findAll(@Query() query: { deviceId?: string; limit?: number }) {
    return this.positionsService.findAll(query);
  }

  @Get('latest')
  @ApiOperation({ summary: 'Latest known position per device (fleet map feed)' })
  latest(@Query('deviceId') deviceId?: string) {
    return this.positionsService.latest(deviceId);
  }

  @Get('device/:deviceId/history')
  @ApiOperation({ summary: 'Position history for a device over a time range' })
  history(
    @Param('deviceId') deviceId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.positionsService.history(
      deviceId,
      from ? new Date(from) : new Date(Date.now() - 24 * 3600 * 1000),
      to ? new Date(to) : new Date(),
    );
  }

  @Get('device/:deviceId/export')
  @ApiOperation({ summary: 'Export position history (CSV/Excel - see reports module)' })
  exportHistory(
    @Param('deviceId') deviceId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.positionsService.exportHistory(
      deviceId,
      from ? new Date(from) : new Date(Date.now() - 24 * 3600 * 1000),
      to ? new Date(to) : new Date(),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single position record' })
  findOne(@Param('id') id: string) {
    return this.positionsService.findOne(id);
  }

  @Post('playback/:tripId')
  @ApiOperation({ summary: 'Route playback for a trip - see TripsController.route() for the real implementation' })
  playback(@Param('tripId') tripId: string): never {
    throw new NotFoundException(
      `Use GET /trips/${tripId}/route for playback data - kept there so trip + route stay in one place.`,
    );
  }
}
