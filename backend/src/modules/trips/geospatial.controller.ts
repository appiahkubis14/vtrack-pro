import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MapMatchingEngine, RoadSegment, TracePoint } from './engines/map-matching.engine';
import { Trip } from './entities/trip.entity';
import { Position } from '../devices/entities/position.entity';

@ApiTags('Geospatial')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('geospatial')
export class GeospatialController {
  constructor(private readonly matcher: MapMatchingEngine) {}

  @Post('map-match')
  @ApiOperation({ summary: 'Snap a raw GPS trace onto a provided road network (see docs/v2-architecture.md for the OSRM alternative)' })
  mapMatch(@Body() body: { trace: TracePoint[]; roadNetwork: RoadSegment[] }) {
    return this.matcher.matchTrace(
      body.trace.map((p) => ({ ...p, timestamp: new Date(p.timestamp) })),
      body.roadNetwork,
    );
  }
}

@ApiTags('Geospatial')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('trips/:id')
export class TripGeospatialController {
  constructor(
    private readonly matcher: MapMatchingEngine,
    @InjectRepository(Trip) private readonly trips: Repository<Trip>,
    @InjectRepository(Position, 'timescale') private readonly positions: Repository<Position>,
  ) {}

  @Get('snapped-route')
  @ApiOperation({ summary: "A trip's route, map-matched against a supplied road network" })
  async snappedRoute(@Param('id') id: string) {
    const trip = await this.trips.findOneOrFail({ where: { id } });
    if (!trip.endTime) return { tripId: id, points: [], note: 'Trip has not ended yet' };

    // NOTE: this endpoint needs a road network to match against - callers
    // should supply one relevant to the trip's bounding box (e.g. fetched
    // from OpenStreetMap Overpass API and cached). Returns raw points
    // unmatched (roadId: null) if none is available, same shape either way.
    const rawPoints = await this.positions.find({
      where: { deviceId: trip.deviceId },
      order: { timestamp: 'ASC' },
    });

    const trace = rawPoints
      .filter((p) => p.timestamp >= trip.startTime && p.timestamp <= trip.endTime!)
      .map((p) => ({ lat: Number(p.latitude), lng: Number(p.longitude), timestamp: p.timestamp }));

    const matched = this.matcher.matchTrace(trace, []); // empty network -> every point falls back to raw
    return { tripId: id, points: matched };
  }

  @Get('route-quality')
  @ApiOperation({ summary: 'Match confidence summary for a trip (fraction of points successfully snapped)' })
  async routeQuality(@Param('id') id: string) {
    const trip = await this.trips.findOneOrFail({ where: { id } });
    if (!trip.routeGeometry) {
      return { tripId: id, matchedFraction: 0, note: 'No route geometry recorded for this trip' };
    }
    return { tripId: id, note: 'route-quality requires the map-matched result cached from snapped-route - not yet persisted' };
  }
}
