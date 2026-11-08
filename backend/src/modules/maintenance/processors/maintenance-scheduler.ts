import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LessThanOrEqual, Repository } from 'typeorm';
import { Vehicle } from '../../vehicles/entities/vehicle.entity';
import { Maintenance, MaintenanceStatus } from '../entities/maintenance.entity';

const MILEAGE_INTERVALS_KM: Record<string, number> = {
  oil_change: 8000,
  tire_rotation: 10000,
  brake_service: 25000,
  inspection: 12000,
};

/**
 * Nightly sweep: for each active vehicle, check odometer-based service
 * intervals against its last completed maintenance of that type, and
 * auto-schedule the next one if due. Calendar/engine-hours-based rules
 * follow the same pattern - add a branch per rule type as needed.
 */
@Injectable()
export class MaintenanceSchedulerProcessor {
  private readonly logger = new Logger(MaintenanceSchedulerProcessor.name);

  constructor(
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(Maintenance) private readonly maintenance: Repository<Maintenance>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async sweepMileageIntervals() {
    const vehicles = await this.vehicles.find({ where: { isActive: true } });
    let scheduled = 0;

    for (const vehicle of vehicles) {
      for (const [serviceType, intervalKm] of Object.entries(MILEAGE_INTERVALS_KM)) {
        const last = await this.maintenance.findOne({
          where: { vehicleId: vehicle.id, serviceType, status: MaintenanceStatus.COMPLETED },
          order: { completedDate: 'DESC' },
        });
        const lastOdometer = last?.odometerAtService ?? 0;
        const due = Number(vehicle.odometer) - Number(lastOdometer) >= intervalKm;
        if (!due) continue;

        const alreadyScheduled = await this.maintenance.findOne({
          where: { vehicleId: vehicle.id, serviceType, status: MaintenanceStatus.SCHEDULED },
        });
        if (alreadyScheduled) continue;

        await this.maintenance.save(
          this.maintenance.create({
            organizationId: vehicle.organizationId,
            vehicleId: vehicle.id,
            serviceType,
            status: MaintenanceStatus.SCHEDULED,
            scheduledDate: new Date(),
            notes: `Auto-scheduled: ${intervalKm}km interval reached`,
          }),
        );
        scheduled++;
      }
    }

    if (scheduled) this.logger.log(`Auto-scheduled ${scheduled} maintenance record(s)`);
  }
}
