import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vehicle } from './entities/vehicle.entity';
import { Maintenance } from '../maintenance/entities/maintenance.entity';
import { AuthUser } from '../../common/auth/auth-user';
import { MapScopeService } from '../map/map-scope.service';

const FUELS = ['petrol', 'diesel', 'electric', 'hybrid', 'gas', 'lpg'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SORTS: Record<string, string> = { plate: 'v.plate_number', make: 'v.make', year: 'v.year', odometer: 'v.odometer', created: 'v.created_at' };

/** Everything here is limited to the caller's organization (and, for hub managers, their hubs); only listed fields can be written. */
@Injectable()
export class VehiclesService {
  constructor(
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(Maintenance) private readonly maintenance: Repository<Maintenance>,
    private readonly scope: MapScopeService,
  ) {}

  async findAll(user: AuthUser, q: { page?: string | number; limit?: string | number; search?: string; status?: string; fuelType?: string; hubId?: string; lifecycle?: string; sort?: string; dir?: string } = {}) {
    const page = Math.max(1, Number(q.page) || 1), limit = Math.min(500, Math.max(1, Number(q.limit) || 50));
    const qb = this.vehicles.createQueryBuilder('v').where('v.deleted_at IS NULL AND v.organization_id = :org', { org: user.organizationId });
    const s = await this.scope.hubScope(user);
    if (!s.all) { if (!s.hubIds.length) return { data: [], total: 0, page, limit }; qb.andWhere('v.hub_id IN (:...hubs)', { hubs: s.hubIds }); }
    const text = String(q.search ?? '').trim().slice(0, 80);
    if (text) qb.andWhere('(v.plate_number ILIKE :s OR v.make ILIKE :s OR v.model ILIKE :s OR v.vin ILIKE :s OR v.chassis_no ILIKE :s OR v.motor_no ILIKE :s)', { s: `%${text.replace(/[%_\\]/g, '\\$&')}%` });
    if (q.status === 'active') qb.andWhere('v.is_active = true'); else if (q.status === 'inactive') qb.andWhere('v.is_active = false');
    if (q.fuelType) qb.andWhere('v.fuel_type = :f', { f: String(q.fuelType) });
    if (q.hubId && UUID.test(String(q.hubId))) qb.andWhere('v.hub_id = :h', { h: q.hubId });
    if (q.lifecycle) qb.andWhere('v.lifecycle_status = :l', { l: String(q.lifecycle) });
    const col = SORTS[String(q.sort ?? 'created')] ?? SORTS.created;
    return qb.orderBy(col, String(q.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC').skip((page - 1) * limit).take(limit).getManyAndCount().then(([data, total]) => ({ data, total, page, limit }));
  }

  async findOne(user: AuthUser, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Vehicle not found');
    const v = await this.vehicles.findOne({ where: { id, organizationId: user.organizationId } });
    if (!v) throw new NotFoundException('Vehicle not found');
    const s = await this.scope.hubScope(user);
    if (!s.all && (!v.hubId || !s.hubIds.includes(v.hubId))) throw new NotFoundException('Vehicle not found');
    return v;
  }

  /** Validates and returns only the fields a person may set. `partial` skips the required-field check. */
  private async clean(user: AuthUser, b: any, partial: boolean): Promise<Partial<Vehicle>> {
    const out: any = {};
    const str = (k: string, max: number, label: string, upper = false) => {
      if (b[k] === undefined) return;
      const v = b[k] === null ? '' : String(b[k]).trim();
      if (v.length > max) throw new BadRequestException(`${label} is too long (most ${max} characters)`);
      out[k] = v === '' ? null : upper ? v.toUpperCase() : v;
    };
    if (!partial || b.plateNumber !== undefined) { const p = String(b?.plateNumber ?? '').trim().toUpperCase(); if (p.length < 2 || p.length > 20) throw new BadRequestException('Plate number must be 2 to 20 characters'); out.plateNumber = p; }
    str('make', 60, 'Make'); str('model', 60, 'Model'); str('color', 40, 'Colour'); str('vin', 40, 'VIN', true); str('chassisNo', 40, 'Chassis number', true); str('motorNo', 40, 'Motor number', true);
    str('registrationNumber', 40, 'Registration number'); str('insurancePolicy', 60, 'Insurance policy'); str('transmission', 30, 'Transmission');
    if (b.year !== undefined) { if (b.year === null || b.year === '') out.year = null; else { const y = Number(b.year); if (!Number.isInteger(y) || y < 1980 || y > 2100) throw new BadRequestException('Year must be between 1980 and 2100'); out.year = y; } }
    if (b.fuelType !== undefined) { if (b.fuelType === null || b.fuelType === '') out.fuelType = null; else { const f = String(b.fuelType).toLowerCase(); if (!FUELS.includes(f)) throw new BadRequestException(`Fuel type must be one of ${FUELS.join(', ')}`); out.fuelType = f; } }
    for (const [k, label, max] of [['odometer', 'Odometer', 5_000_000], ['engineCapacity', 'Engine capacity', 99999], ['tankCapacity', 'Tank capacity', 9999]] as const) {
      if (b[k] === undefined) continue; if (b[k] === null || b[k] === '') { if (k !== 'odometer') out[k] = null; continue; }
      const n = Number(b[k]); if (!Number.isFinite(n) || n < 0 || n > max) throw new BadRequestException(`${label} must be a number from 0 to ${max}`); out[k] = n;
    }
    for (const [k, label] of [['registrationExpiry', 'Registration expiry'], ['insuranceExpiry', 'Insurance expiry'], ['inspectionDueDate', 'Inspection due date']] as const) {
      if (b[k] === undefined) continue; if (b[k] === null || b[k] === '') { out[k] = null; continue; }
      if (!DATE.test(String(b[k])) || isNaN(Date.parse(String(b[k])))) throw new BadRequestException(`${label} must be a date like 2026-12-31`); out[k] = String(b[k]);
    }
    if (b.isActive !== undefined) out.isActive = b.isActive === true || b.isActive === 'true';
    if (b.hubId !== undefined) {
      if (b.hubId === null || b.hubId === '') out.hubId = null;
      else { if (!UUID.test(String(b.hubId))) throw new BadRequestException('Hub is not valid'); const [h] = await this.vehicles.manager.query(`SELECT id FROM hubs WHERE id=$1 AND organization_id=$2`, [b.hubId, user.organizationId]); if (!h) throw new BadRequestException('That hub does not exist'); out.hubId = b.hubId; }
    }
    if (b.ownerId !== undefined) {
      if (b.ownerId === null || b.ownerId === '') out.ownerId = null;
      else { if (!UUID.test(String(b.ownerId))) throw new BadRequestException('Owner is not valid'); const [o] = await this.vehicles.manager.query(`SELECT id FROM owners WHERE id=$1 AND organization_id=$2`, [b.ownerId, user.organizationId]); if (!o) throw new BadRequestException('That owner does not exist'); out.ownerId = b.ownerId; }
    }
    return out;
  }

  private async save<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException('That plate number, VIN, chassis or motor number is already used by another vehicle');
      throw e;
    }
  }

  async create(user: AuthUser, body: any) {
    const data = await this.clean(user, body ?? {}, false);
    const s = await this.scope.hubScope(user);
    if (!s.all) { if (!data.hubId || !s.hubIds.includes(data.hubId)) throw new BadRequestException('Choose one of your hubs for this vehicle'); }
    return this.save(() => this.vehicles.save(this.vehicles.create({ ...data, organizationId: user.organizationId } as any)));
  }

  async update(user: AuthUser, id: string, body: any) {
    const v = await this.findOne(user, id);
    if (v.lifecycleStatus === 'retired') throw new ConflictException('A retired vehicle cannot be edited');
    const data = await this.clean(user, body ?? {}, true);
    const s = await this.scope.hubScope(user);
    if (!s.all && data.hubId !== undefined && (!data.hubId || !s.hubIds.includes(data.hubId))) throw new BadRequestException('You can only move a vehicle to one of your own hubs');
    if (!Object.keys(data).length) throw new BadRequestException('Nothing to change');
    await this.save(() => this.vehicles.update({ id, organizationId: user.organizationId }, data as any));
    return this.findOne(user, id);
  }

  async remove(user: AuthUser, id: string) {
    await this.findOne(user, id);
    const [a] = await this.vehicles.manager.query(`SELECT 1 FROM rider_assignments WHERE vehicle_id=$1 AND status='active' LIMIT 1`, [id]);
    if (a) throw new ConflictException('This vehicle is assigned to a rider. End the assignment first.');
    await this.vehicles.softDelete({ id, organizationId: user.organizationId });
    return { success: true };
  }

  async listMaintenance(user: AuthUser, id: string) {
    await this.findOne(user, id);
    return this.maintenance.find({ where: { vehicleId: id, organizationId: user.organizationId }, order: { scheduledDate: 'DESC' } });
  }

  async scheduleMaintenance(user: AuthUser, id: string, body: any) {
    const vehicle = await this.findOne(user, id);
    const b = body ?? {};
    const type = String(b.serviceType ?? '').trim(); if (!type || type.length > 80) throw new BadRequestException('Service type is required (up to 80 characters)');
    if (b.scheduledDate && (!DATE.test(String(b.scheduledDate)) || isNaN(Date.parse(b.scheduledDate)))) throw new BadRequestException('Scheduled date must look like 2026-12-31');
    const record = this.maintenance.create({ serviceType: type, description: b.description ? String(b.description).slice(0, 1000) : undefined, scheduledDate: b.scheduledDate, vehicleId: id, organizationId: vehicle.organizationId } as any);
    return this.maintenance.save(record);
  }
}
