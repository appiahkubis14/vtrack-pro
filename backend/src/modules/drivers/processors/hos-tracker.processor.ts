import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trip } from '../../trips/entities/trip.entity';
import { DriverAssignment } from '../entities/driver-assignment.entity';

const MAX_DRIVING_HOURS_PER_DAY = 11; // US FMCSA property-carrying driver limit, adjust per jurisdiction
const MAX_DUTY_HOURS_PER_DAY = 14;

export interface HosStatus {
  drivingHoursToday: number;
  dutyHoursToday: number;
  violatesDrivingLimit: boolean;
  violatesDutyLimit: boolean;
}

/**
 * Hours-of-Service tracking from trip records. This is a simplified daily
 * rollup, not a full ELD-certified engine (no sleeper-berth splits, 30-minute
 * break rule, or 60/70-hour 7/8-day windows) - treat as a starting point for
 * compliance tooling, not a substitute for a certified ELD.
 */
@Injectable()
export class HosTrackerProcessor {
  constructor(
    @InjectRepository(Trip) private readonly trips: Repository<Trip>,
    @InjectRepository(DriverAssignment) private readonly assignments: Repository<DriverAssignment>,
  ) {}

  async statusForToday(driverId: string): Promise<HosStatus> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const assignments = await this.assignments.find({ where: { driverId } });
    const vehicleIds = assignments.map((a) => a.vehicleId);

    const todaysTrips = vehicleIds.length
      ? await this.trips
          .createQueryBuilder('t')
          .where('t.vehicle_id IN (:...vehicleIds)', { vehicleIds })
          .andWhere('t.start_time >= :startOfDay', { startOfDay })
          .getMany()
      : [];

    const drivingHoursToday = todaysTrips.reduce((sum, t) => sum + (Number(t.movingDuration) || 0) / 3600, 0);
    const dutyHoursToday = todaysTrips.reduce((sum, t) => sum + (Number(t.duration) || 0) / 3600, 0);

    return {
      drivingHoursToday,
      dutyHoursToday,
      violatesDrivingLimit: drivingHoursToday > MAX_DRIVING_HOURS_PER_DAY,
      violatesDutyLimit: dutyHoursToday > MAX_DUTY_HOURS_PER_DAY,
    };
  }
}
