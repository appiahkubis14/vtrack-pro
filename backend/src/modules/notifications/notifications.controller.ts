import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('')
  @ApiOperation({ summary: 'List notifications' })
  findAll(@Query() query: any) {
    return this.notificationsService.findAll(query);
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Get channel preferences' })
  getPreferences(@Query() query: any) {
    return this.notificationsService.getPreferences(query);
  }

  @Post('preferences')
  @ApiOperation({ summary: 'Update channel preferences' })
  updatePreferences(@Body() body: any) {
    return this.notificationsService.updatePreferences(body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a notification' })
  findOne(@Param('id') id: string) {
    return this.notificationsService.findOne(id);
  }

  @Put(':id/read')
  @ApiOperation({ summary: 'Mark as read' })
  markRead(@Param('id') id: string) {
    return this.notificationsService.markRead(id);
  }
}
