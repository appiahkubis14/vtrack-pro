import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { Device } from '../devices/entities/device.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { Alert } from '../alerts/entities/alert.entity';
import { Trip } from '../trips/entities/trip.entity';
import { DeviceStatus, AlertSeverity } from '../../common/constants/alerts.constant';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(Alert) private readonly alerts: Repository<Alert>,
    @InjectRepository(Trip) private readonly trips: Repository<Trip>,
  ) {}

  async overview(organizationId?: string) {
    const deviceWhere = organizationId ? { organizationId } : {};

    const onlineQb = this.devices.createQueryBuilder('d').where('d.status != :offline', {
      offline: DeviceStatus.OFFLINE,
    });
    if (organizationId) onlineQb.andWhere('d.organization_id = :organizationId', { organizationId });

    const [totalVehicles, totalDevices, onlineDevices, openAlerts] = await Promise.all([
      this.vehicles.count({ where: deviceWhere }),
      this.devices.count({ where: deviceWhere }),
      onlineQb.getCount(),
      this.alerts.count({ where: { ...deviceWhere, isResolved: false } }),
    ]);

    return { totalVehicles, totalDevices, onlineDevices, offlineDevices: totalDevices - onlineDevices, openAlerts };
  }

  async realTime(organizationId?: string) {
    const qb = this.devices.createQueryBuilder('d');
    if (organizationId) qb.where('d.organization_id = :organizationId', { organizationId });
    const devices = await qb.getMany();

    const byStatus = devices.reduce<Record<string, number>>((acc, d) => {
      acc[d.status] = (acc[d.status] ?? 0) + 1;
      return acc;
    }, {});

    return { asOf: new Date().toISOString(), deviceCount: devices.length, byStatus };
  }

  async fuel(organizationId?: string) {
    const qb = this.trips.createQueryBuilder('t');
    if (organizationId) {
      qb.innerJoin('vehicles', 'v', 'v.id = t.vehicle_id').andWhere('v.organization_id = :organizationId', {
        organizationId,
      });
    }
    const { totalFuel, totalDistance } = await qb
      .select('COALESCE(SUM(t.fuel_consumed), 0)', 'totalFuel')
      .addSelect('COALESCE(SUM(t.distance), 0)', 'totalDistance')
      .getRawOne();

    return {
      totalFuelLiters: Number(totalFuel),
      totalDistanceKm: Number(totalDistance),
      fleetKmPerLiter: Number(totalFuel) > 0 ? Number(totalDistance) / Number(totalFuel) : null,
    };
  }

  async alertsSummary(organizationId?: string) {
    const where = organizationId ? { organizationId } : {};
    const [total, critical, high, unresolved] = await Promise.all([
      this.alerts.count({ where }),
      this.alerts.count({ where: { ...where, severity: AlertSeverity.CRITICAL } }),
      this.alerts.count({ where: { ...where, severity: AlertSeverity.HIGH } }),
      this.alerts.count({ where: { ...where, isResolved: false } }),
    ]);
    return { total, critical, high, unresolved };
  }

  async performance(organizationId?: string) {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const qb = this.trips.createQueryBuilder('t').where('t.start_time >= :since', { since });
    if (organizationId) {
      qb.innerJoin('vehicles', 'v', 'v.id = t.vehicle_id').andWhere('v.organization_id = :organizationId', {
        organizationId,
      });
    }
    const stats = await qb
      .select('COUNT(*)', 'tripCount')
      .addSelect('COALESCE(AVG(t.average_speed), 0)', 'avgSpeed')
      .addSelect('COALESCE(SUM(t.distance), 0)', 'totalDistance')
      .getRawOne();

    return {
      periodDays: 30,
      tripCount: Number(stats.tripCount),
      avgSpeedKmh: Number(stats.avgSpeed),
      totalDistanceKm: Number(stats.totalDistance),
    };
  }

  async statistics(organizationId?: string) {
    const [overview, fuelStats, alertStats] = await Promise.all([
      this.overview(organizationId),
      this.fuel(organizationId),
      this.alertsSummary(organizationId),
    ]);
    return { ...overview, fuel: fuelStats, alerts: alertStats };
  }
}
