import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CorridorsService } from './corridors.service';

@ApiTags('Roaming')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('border-crossings')
export class BorderCrossingsController {
  constructor(private readonly corridorsService: CorridorsService) {}

  @Get('')
  @ApiOperation({ summary: 'Border crossing history' })
  findAll(@Query() query: any) {
    return this.corridorsService.listBorderCrossings(query);
  }
}

@ApiTags('Roaming')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('travel-corridors')
export class TravelCorridorsController {
  constructor(private readonly corridorsService: CorridorsService) {}

  @Get('')
  @ApiOperation({ summary: "List travel corridors for the caller's organization" })
  findAll(@Req() req: Request) {
    const user = req.user as { organizationId: string };
    return this.corridorsService.findAll(user.organizationId);
  }

  @Post('')
  @ApiOperation({ summary: 'Define a travel corridor (expected cross-border route)' })
  create(@Body() body: any, @Req() req: Request) {
    const user = req.user as { organizationId: string };
    return this.corridorsService.create({ ...body, organizationId: user.organizationId });
  }

  @Get(':id/events')
  @ApiOperation({ summary: 'Deviation/long-stop/unauthorized-country events for a corridor' })
  events(@Param('id') id: string) {
    return this.corridorsService.events(id);
  }
}
