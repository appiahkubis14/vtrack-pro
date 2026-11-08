import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { DriverScore } from '../entities/driver-score.entity';
import { DriverAssignment } from '../entities/driver-assignment.entity';
import { Trip } from '../../trips/entities/trip.entity';

/**
 * Rolls up a driver's trips over a period into a 0-100 composite score.
 * Sub-scores start at 100 and lose points per violation - tune the
 * weights/penalties per fleet policy.
 */
@Injectable()
export class DriverScoringProcessor {
  constructor(
    @InjectRepository(DriverScore) private readonly scores: Repository<DriverScore>,
    @InjectRepository(DriverAssignment) private readonly assignments: Repository<DriverAssignment>,
    @InjectRepository(Trip) private readonly trips: Repository<Trip>,
  ) {}

  async computeForPeriod(driverId: string, periodStart: Date, periodEnd: Date): Promise<DriverScore> {
    const assignments = await this.assignments.find({ where: { driverId } });
    const vehicleIds = assignments.map((a) => a.vehicleId);

    const trips = vehicleIds.length
      ? await this.trips.find({
          where: { vehicleId: In(vehicleIds), startTime: Between(periodStart, periodEnd) } as any,
        })
      : [];

    const totalTrips = trips.length || 1;
    const avgScore = trips.reduce((sum, t) => sum + (t.score || 100), 0) / totalTrips;
    const fuelEfficiencyScore = this.scoreFuelEfficiency(trips);
    const speedingScore = this.scoreFromEventDensity(trips, 'speeding');
    const brakingScore = this.scoreFromEventDensity(trips, 'harsh_braking');

    const overall = Math.round((avgScore + fuelEfficiencyScore + speedingScore + brakingScore) / 4);

    return this.scores.save(
      this.scores.create({
        driverId,
        periodStart,
        periodEnd,
        overallScore: overall,
        speedingScore,
        brakingScore,
        fuelEfficiencyScore,
        events: { tripCount: trips.length },
      }),
    );
  }

  private scoreFuelEfficiency(trips: Trip[]): number {
    const withEfficiency = trips.filter((t) => t.fuelEfficiency);
    if (!withEfficiency.length) return 100;
    const avg = withEfficiency.reduce((s, t) => s + Number(t.fuelEfficiency), 0) / withEfficiency.length;
    // Naive: reward higher km/L. Calibrate against fleet-wide baseline in production.
    return Math.max(0, Math.min(100, avg * 10));
  }

  private scoreFromEventDensity(trips: Trip[], eventKey: string): number {
    let events = 0;
    for (const trip of trips) {
      const list = (trip.events as Record<string, number>) ?? {};
      events += list[eventKey] ?? 0;
    }
    const perTrip = events / (trips.length || 1);
    return Math.max(0, 100 - perTrip * 10);
  }
}
