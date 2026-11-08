import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post('generate')
  @ApiOperation({ summary: 'Generate a report' })
  generate(@Body() body: any) {
    return this.reportsService.generate(body);
  }

  @Get('scheduled')
  @ApiOperation({ summary: 'List scheduled reports' })
  listScheduled(@Query() query: any) {
    return this.reportsService.listScheduled(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get report metadata' })
  findOne(@Param('id') id: string) {
    return this.reportsService.findOne(id);
  }

  @Get('download/:id')
  @ApiOperation({ summary: 'Download a generated report' })
  download(@Param('id') id: string) {
    return this.reportsService.download(id);
  }

  @Post('schedule')
  @ApiOperation({ summary: 'Schedule a recurring report' })
  schedule(@Body() body: any) {
    return this.reportsService.schedule(body);
  }

  @Delete('scheduled/:id')
  @ApiOperation({ summary: 'Cancel a scheduled report' })
  removeScheduled(@Param('id') id: string) {
    return this.reportsService.removeScheduled(id);
  }
}
