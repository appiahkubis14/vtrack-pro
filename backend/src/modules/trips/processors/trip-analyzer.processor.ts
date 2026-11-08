import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Trip } from '../entities/trip.entity';
import { Position } from '../../devices/entities/position.entity';
import { haversineDistanceMeters } from '../../../helpers/geo.helper';

/**
 * Computes distance/duration/avg+max speed/fuel efficiency for a closed trip
 * by walking its position stream. Call after TripDetectionProcessor closes a
 * trip, or on-demand via POST /trips/analyze.
 */
@Injectable()
export class TripAnalyzerProcessor {
  constructor(
    @InjectRepository(Trip) private readonly trips: Repository<Trip>,
    @InjectRepository(Position, 'timescale') private readonly positions: Repository<Position>,
  ) {}

  async analyze(tripId: string): Promise<Trip> {
    const trip = await this.trips.findOneOrFail({ where: { id: tripId } });
    if (!trip.endTime) throw new Error('Cannot analyze a trip that has not ended');

    const points = await this.positions.find({
      where: { deviceId: trip.deviceId, timestamp: Between(trip.startTime, trip.endTime) },
      order: { timestamp: 'ASC' },
    });

    let distanceMeters = 0;
    let maxSpeed = 0;
    let speedSum = 0;
    let stopCount = 0;
    let wasStopped = false;

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      distanceMeters += haversineDistanceMeters(
        Number(prev.latitude),
        Number(prev.longitude),
        Number(curr.latitude),
        Number(curr.longitude),
      );
      const speed = Number(curr.speed ?? 0);
      maxSpeed = Math.max(maxSpeed, speed);
      speedSum += speed;

      const stopped = speed < 2;
      if (stopped && !wasStopped) stopCount++;
      wasStopped = stopped;
    }

    const durationSeconds = (trip.endTime.getTime() - trip.startTime.getTime()) / 1000;
    const avgSpeed = points.length ? speedSum / points.length : 0;
    const fuelStart = Number(points[0]?.fuelLevel ?? 0);
    const fuelEnd = Number(points[points.length - 1]?.fuelLevel ?? 0);
    const fuelConsumed = Math.max(0, fuelStart - fuelEnd);
    const distanceKm = distanceMeters / 1000;

    await this.trips.update(tripId, {
      distance: distanceKm,
      duration: durationSeconds,
      averageSpeed: avgSpeed,
      maxSpeed,
      stopCount,
      fuelConsumed,
      fuelEfficiency: fuelConsumed > 0 ? distanceKm / fuelConsumed : undefined,
      routeGeometry: JSON.stringify({
        type: 'LineString',
        coordinates: points.map((p) => [Number(p.longitude), Number(p.latitude)]),
      }),
    });

    return this.trips.findOneOrFail({ where: { id: tripId } });
  }
}
