import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MaintenanceService } from './maintenance.service';

@ApiTags('Maintenance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @Get('')
  @ApiOperation({ summary: 'List maintenance records' })
  findAll(@Query() query: any) {
    return this.maintenanceService.findAll(query);
  }

  @Post('')
  @ApiOperation({ summary: 'Create a maintenance record' })
  create(@Body() body: any) {
    return this.maintenanceService.create(body);
  }

    @Get('schedule')
  @ApiOperation({ summary: 'Upcoming schedule' })
  schedule(@Query() query: any) {
    return this.maintenanceService.schedule(query);
  }

  @Get('overdue')
  @ApiOperation({ summary: 'Overdue maintenance' })
  overdue(@Query() query: any) {
    return this.maintenanceService.overdue(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a maintenance record' })
  findOne(@Param('id') id: string) {
    return this.maintenanceService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a maintenance record' })
  update(@Param('id') id: string, @Body() body: any) {
    return this.maintenanceService.update(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a maintenance record' })
  remove(@Param('id') id: string) {
    return this.maintenanceService.remove(id);
  }
}
