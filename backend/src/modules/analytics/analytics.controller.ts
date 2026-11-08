import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AnalyticsService } from './analytics.service';

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('predictive-maintenance')
  @ApiOperation({ summary: 'Predicted maintenance needs' })
  predictiveMaintenance(@Query() query: any) {
    return this.analyticsService.predictiveMaintenance(query);
  }

  @Get('driver-risk')
  @ApiOperation({ summary: 'Driver risk assessment' })
  driverRisk(@Query() query: any) {
    return this.analyticsService.driverRisk(query);
  }

  @Get('fuel-forecast')
  @ApiOperation({ summary: 'Fuel consumption forecast' })
  fuelForecast(@Query() query: any) {
    return this.analyticsService.fuelForecast(query);
  }

  @Get('anomalies')
  @ApiOperation({ summary: 'Detected anomalies' })
  anomalies(@Query() query: any) {
    return this.analyticsService.anomalies(query);
  }
}
