import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { Rider, RiderAuthMethod } from '../ev-fleet/entities/rider.entity';
import { RiderAssignment } from './entities/rider-assignment.entity';
import { Battery, BatterySwap, ChargeEvent } from './entities/battery.entity';
import { DailyCollection } from './entities/daily-collection.entity';
import { DataScope, DataScopeService } from '../hubs/data-scope.service';
import { VEHICLE_TRANSITIONS, VehicleLifecycle, assertTransition } from '../../common/lifecycle/transitions';
import { assertPesewas, pesewasToCedis } from '../../common/money/money';
import { assertIsoDate, todayAccra } from '../../common/dates/dates';
import { encryptField } from '../../common/crypto/field-crypto';
import { AuthUser } from '../../common/auth/auth-user';

export interface RiderInput {
  fullName?: string; phone?: string; nationalIdNumber?: string; hubId?: string | null; momoNumber?: string;
  guarantorName?: string; guarantorPhone?: string; status?: 'active' | 'suspended' | 'exited';
}
export interface AssignmentInput {
  riderId?: string; vehicleId?: string; startDate?: string;
  dailyTargetPesewas?: number; dailyRemittancePesewas?: number; serviceFeePesewas?: number;
}

@Injectable()
export class OperationsService {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly scope: DataScopeService) {}

  // ---------- riders ----------
  async listRiders(user: AuthUser, q: { hubId?: string }) {
    const scope = await this.scope.forUser(user);
    if (q.hubId) this.scope.assertHub(scope, q.hubId);
    const qb = this.ds.getRepository(Rider).createQueryBuilder('r').where('r.organization_id=:o', { o: user.organizationId });
    if (!scope.all) qb.andWhere('r.hub_id = ANY(:h)', { h: scope.hubIds });
    if (q.hubId) qb.andWhere('r.hub_id=:hub', { hub: q.hubId });
    return qb.orderBy('r.full_name', 'ASC').getMany();
  }

  async getRider(user: AuthUser, id: string) {
    const r = await this.ds.getRepository(Rider).findOne({ where: { id, organizationId: user.organizationId } });
    if (!r) throw new NotFoundException('Rider not found');
    if (r.hubId) this.scope.assertHub(await this.scope.forUser(user), r.hubId);
    else if (!(await this.scope.forUser(user)).all) throw new ForbiddenException('You do not have access to this rider');
    return r;
  }

  async createRider(user: AuthUser, i: RiderInput) {
    if (!i.fullName?.trim() || !i.phone?.trim()) throw new BadRequestException('A rider needs a full name and a phone number');
    if (!i.hubId) throw new BadRequestException('A rider must belong to a hub');
    const scope = await this.scope.forUser(user);
    this.scope.assertHub(scope, i.hubId);
    const [hub] = await this.ds.query(`SELECT id FROM hubs WHERE id=$1 AND organization_id=$2`, [i.hubId, user.organizationId]);
    if (!hub) throw new BadRequestException('Hub not found');
    const dup = await this.ds.getRepository(Rider).findOne({ where: { phone: i.phone.trim() } });
    if (dup) throw new ConflictException('A rider with this phone number already exists');
    const repo = this.ds.getRepository(Rider);
    return repo.save(repo.create({
      organizationId: user.organizationId, fullName: i.fullName.trim(), phone: i.phone.trim(), nationalIdNumber: i.nationalIdNumber,
      authMethod: RiderAuthMethod.BLUETOOTH_APP, dailyTargetAmount: 0, hubId: i.hubId,
      momoNumberEnc: i.momoNumber ? encryptField(i.momoNumber) : null,
      guarantorName: i.guarantorName ?? null, guarantorPhone: i.guarantorPhone ?? null, status: 'active',
    }));
  }

  async updateRider(user: AuthUser, id: string, i: RiderInput) {
    const r = await this.getRider(user, id);
    if (i.fullName !== undefined) r.fullName = i.fullName;
    if (i.phone !== undefined) r.phone = i.phone;
    if (i.nationalIdNumber !== undefined) r.nationalIdNumber = i.nationalIdNumber;
    if (i.guarantorName !== undefined) r.guarantorName = i.guarantorName;
    if (i.guarantorPhone !== undefined) r.guarantorPhone = i.guarantorPhone;
    if (i.momoNumber !== undefined) r.momoNumberEnc = i.momoNumber ? encryptField(i.momoNumber) : null;
    if (i.hubId !== undefined && i.hubId !== r.hubId) {
      this.scope.assertHub(await this.scope.forUser(user), i.hubId as string);
      r.hubId = i.hubId;
    }
    if (i.status !== undefined) {
      if (i.status !== 'active') {
        const [a] = await this.ds.query(`SELECT 1 FROM rider_assignments WHERE rider_id=$1 AND status='active'`, [id]);
        if (a) throw new ConflictException('End the rider\'s active assignment before suspending or exiting them');
      }
      r.status = i.status;
      r.isActive = i.status === 'active';
    }
    const saved = await this.ds.getRepository(Rider).save(r);
    delete (saved as any).momoNumberEnc;
    return saved;
  }

  // ---------- assignments ----------
  async listAssignments(user: AuthUser, q: { hubId?: string; status?: string }) {
    const scope = await this.scope.forUser(user);
    if (q.hubId) this.scope.assertHub(scope, q.hubId);
    const qb = this.ds.getRepository(RiderAssignment).createQueryBuilder('a').where('a.organization_id=:o', { o: user.organizationId });
    if (!scope.all) qb.andWhere('a.hub_id = ANY(:h)', { h: scope.hubIds });
    if (q.hubId) qb.andWhere('a.hub_id=:hub', { hub: q.hubId });
    if (q.status) qb.andWhere('a.status=:s', { s: q.status });
    return qb.orderBy('a.start_date', 'DESC').limit(500).getMany();
  }

  /**
   * Gives a rider a vehicle (rules BR1, BR2). The partial unique indexes make a double assignment impossible even under a
   * race; the checks here exist to give a readable message first. The rider's daily target is mirrored onto the rider row
   * because the existing Work-and-Pay processor reads it from there.
   */
  async assign(user: AuthUser, i: AssignmentInput) {
    if (!i.riderId || !i.vehicleId) throw new BadRequestException('An assignment needs riderId and vehicleId');
    const target = assertPesewas(i.dailyTargetPesewas ?? 0, 'dailyTargetPesewas', { min: 0 });
    const remit = assertPesewas(i.dailyRemittancePesewas ?? 0, 'dailyRemittancePesewas', { min: 0 });
    const fee = assertPesewas(i.serviceFeePesewas ?? 0, 'serviceFeePesewas', { min: 0 });
    const startDate = assertIsoDate(i.startDate ?? todayAccra(), 'startDate');
    const scope = await this.scope.forUser(user);

    try {
      return await this.ds.transaction(async (m) => {
        const [rider] = await m.query(`SELECT id, hub_id, status FROM riders WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [i.riderId, user.organizationId]);
        if (!rider) throw new BadRequestException('Rider not found');
        if (rider.status !== 'active') throw new ConflictException(`This rider is ${rider.status}`);
        if (!rider.hub_id) throw new ConflictException('The rider has no hub');
        this.scope.assertHub(scope, rider.hub_id);
        const [veh] = await m.query(`SELECT id, lifecycle_status, owner_id, hub_id FROM vehicles WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [i.vehicleId, user.organizationId]);
        if (!veh) throw new BadRequestException('Vehicle not found');
        if (veh.lifecycle_status !== VehicleLifecycle.SOLD) {
          throw new ConflictException(`Only a sold vehicle with no rider can be assigned (this one is "${veh.lifecycle_status}")`);
        }
        const [busyRider] = await m.query(`SELECT 1 FROM rider_assignments WHERE rider_id=$1 AND status='active'`, [i.riderId]);
        if (busyRider) throw new ConflictException('This rider already has an active assignment');

        assertTransition('Vehicle', VEHICLE_TRANSITIONS, veh.lifecycle_status, VehicleLifecycle.ASSIGNED);
        await m.query(`UPDATE vehicles SET lifecycle_status='assigned', hub_id=$1 WHERE id=$2`, [rider.hub_id, i.vehicleId]);
        const repo = m.getRepository(RiderAssignment);
        const a = await repo.save(repo.create({
          organizationId: user.organizationId, riderId: i.riderId, vehicleId: i.vehicleId, hubId: rider.hub_id, startDate,
          dailyTargetPesewas: target, dailyRemittancePesewas: remit, serviceFeePesewas: fee, createdBy: user.sub,
        }));
        await m.query(`UPDATE riders SET assigned_vehicle_id=$1, daily_target_amount=$2 WHERE id=$3`, [i.vehicleId, pesewasToCedis(remit), i.riderId]);
        return a;
      });
    } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException('That rider or vehicle already has an active assignment');
      throw e;
    }
  }

  /** Changes the daily amounts of a running assignment. Settlements already calculated keep the old amounts; new days use the new ones. */
  async updateAssignment(user: AuthUser, id: string, i: AssignmentInput) {
    const a = await this.ds.getRepository(RiderAssignment).findOne({ where: { id, organizationId: user.organizationId } });
    if (!a) throw new NotFoundException('Assignment not found');
    this.scope.assertHub(await this.scope.forUser(user), a.hubId);
    if (a.status !== 'active') throw new ConflictException('Only a running assignment can be changed');
    const target = i.dailyTargetPesewas !== undefined ? assertPesewas(i.dailyTargetPesewas, 'dailyTargetPesewas', { min: 0 }) : undefined;
    const remit = i.dailyRemittancePesewas !== undefined ? assertPesewas(i.dailyRemittancePesewas, 'dailyRemittancePesewas', { min: 0 }) : undefined;
    const fee = i.serviceFeePesewas !== undefined ? assertPesewas(i.serviceFeePesewas, 'serviceFeePesewas', { min: 0 }) : undefined;
    if (target === undefined && remit === undefined && fee === undefined) throw new BadRequestException('Nothing to change');
    await this.ds.transaction(async (m) => {
      await m.query(`UPDATE rider_assignments SET daily_target_pesewas=COALESCE($2, daily_target_pesewas), daily_remittance_pesewas=COALESCE($3, daily_remittance_pesewas), service_fee_pesewas=COALESCE($4, service_fee_pesewas) WHERE id=$1`, [id, target ?? null, remit ?? null, fee ?? null]);
      if (remit !== undefined) await m.query(`UPDATE riders SET daily_target_amount=$2 WHERE id=$1`, [a.riderId, pesewasToCedis(remit)]);
    });
    return this.ds.getRepository(RiderAssignment).findOneOrFail({ where: { id } });
  }

  async endAssignment(user: AuthUser, id: string, reason?: string) {
    return this.ds.transaction(async (m) => {
      const a = await m.getRepository(RiderAssignment).createQueryBuilder('a').setLock('pessimistic_write').where('a.id=:id AND a.organization_id=:o', { id, o: user.organizationId }).getOne();
      if (!a) throw new NotFoundException('Assignment not found');
      this.scope.assertHub(await this.scope.forUser(user), a.hubId);
      if (a.status === 'ended') throw new ConflictException('This assignment has already ended');
      await m.query(`UPDATE rider_assignments SET status='ended', end_date=CURRENT_DATE, ended_reason=$1 WHERE id=$2`, [reason ?? 'ended', id]);
      await m.query(`UPDATE riders SET assigned_vehicle_id=NULL, daily_target_amount=0 WHERE id=$1`, [a.riderId]);
      const [v] = await m.query(`SELECT lifecycle_status FROM vehicles WHERE id=$1 FOR UPDATE`, [a.vehicleId]);
      if (v.lifecycle_status === VehicleLifecycle.ASSIGNED) {
        await m.query(`UPDATE vehicles SET lifecycle_status='sold' WHERE id=$1`, [a.vehicleId]);
      } else if (v.lifecycle_status === VehicleLifecycle.ACTIVE) {
        await m.query(`UPDATE vehicles SET lifecycle_status='assigned' WHERE id=$1`, [a.vehicleId]);
        await m.query(`UPDATE vehicles SET lifecycle_status='sold' WHERE id=$1`, [a.vehicleId]);
      }
      return m.getRepository(RiderAssignment).findOneOrFail({ where: { id } });
    });
  }

  // ---------- batteries ----------
  async listBatteries(user: AuthUser, q: { hubId?: string; status?: string }) {
    const scope = await this.scope.forUser(user);
    if (q.hubId) this.scope.assertHub(scope, q.hubId);
    const qb = this.ds.getRepository(Battery).createQueryBuilder('b').where('b.organization_id=:o', { o: user.organizationId });
    if (!scope.all) qb.andWhere('b.hub_id = ANY(:h)', { h: scope.hubIds });
    if (q.hubId) qb.andWhere('b.hub_id=:hub', { hub: q.hubId });
    if (q.status) qb.andWhere('b.status=:s', { s: q.status });
    return qb.orderBy('b.serial_no', 'ASC').getMany();
  }

  async createBattery(user: AuthUser, i: { serialNo?: string; hubId?: string; gpsModuleId?: string; voltage?: number; capacityAh?: number }) {
    if (!i.serialNo?.trim()) throw new BadRequestException('A battery needs a serial number');
    if (i.hubId) this.scope.assertHub(await this.scope.forUser(user), i.hubId);
    const repo = this.ds.getRepository(Battery);
    const dup = await repo.findOne({ where: { organizationId: user.organizationId, serialNo: i.serialNo.trim() } });
    if (dup) throw new ConflictException('A battery with this serial number already exists');
    return repo.save(repo.create({ organizationId: user.organizationId, serialNo: i.serialNo.trim(), hubId: i.hubId ?? null, gpsModuleId: i.gpsModuleId ?? null, voltage: i.voltage ?? 72, capacityAh: i.capacityAh ?? 100 }));
  }

  /** Fit an available battery to a vehicle with no battery (first fit), at a hub. */
  async fit(user: AuthUser, batteryId: string, vehicleId: string) {
    return this.ds.transaction(async (m) => {
      const b = await this.lockBattery(m, user.organizationId, batteryId);
      if (b.status !== 'available' && b.status !== 'charging') throw new ConflictException(`Battery is "${b.status}" and cannot be fitted`);
      const [has] = await m.query(`SELECT 1 FROM batteries WHERE current_vehicle_id=$1`, [vehicleId]);
      if (has) throw new ConflictException('This vehicle already has a battery; record a swap instead');
      await m.query(`UPDATE batteries SET status='fitted', current_vehicle_id=$1 WHERE id=$2`, [vehicleId, batteryId]);
      return m.getRepository(Battery).findOneOrFail({ where: { id: batteryId } });
    }).catch((e) => { if (e?.code === '23505') throw new ConflictException('This vehicle already has a battery'); throw e; });
  }

  private async lockBattery(m: EntityManager, orgId: string, id: string): Promise<Battery> {
    const b = await m.getRepository(Battery).createQueryBuilder('b').setLock('pessimistic_write').where('b.id=:id AND b.organization_id=:o', { id, o: orgId }).getOne();
    if (!b) throw new NotFoundException(`Battery ${id} not found`);
    return b;
  }

  /**
   * A swap exchanges the battery on a vehicle for a charged one from the hub. Both moves happen in one transaction
   * so a battery can never be on two vehicles (rule BR3), and the removed battery goes back to the hub to charge.
   */
  async swap(user: AuthUser, i: { vehicleId?: string; batteryInId?: string; riderId?: string }) {
    if (!i.vehicleId || !i.batteryInId) throw new BadRequestException('A swap needs vehicleId and batteryInId');
    try {
      return await this.ds.transaction(async (m) => {
        const [veh] = await m.query(`SELECT id, hub_id FROM vehicles WHERE id=$1 AND organization_id=$2`, [i.vehicleId, user.organizationId]);
        if (!veh) throw new BadRequestException('Vehicle not found');
        if (!veh.hub_id) throw new ConflictException('This vehicle is not based at a hub');
        this.scope.assertHub(await this.scope.forUser(user), veh.hub_id);
        const incoming = await this.lockBattery(m, user.organizationId, i.batteryInId!);
        if (incoming.status !== 'available') throw new ConflictException(`The replacement battery is "${incoming.status}", not available`);
        if (incoming.hubId !== veh.hub_id) throw new ConflictException('The replacement battery is not at this vehicle\'s hub');
        const [out] = await m.query(`SELECT id FROM batteries WHERE current_vehicle_id=$1 FOR UPDATE`, [i.vehicleId]);
        if (out) await m.query(`UPDATE batteries SET status='charging', current_vehicle_id=NULL, hub_id=$1, cycle_count=cycle_count+1 WHERE id=$2`, [veh.hub_id, out.id]);
        await m.query(`UPDATE batteries SET status='fitted', current_vehicle_id=$1 WHERE id=$2`, [i.vehicleId, i.batteryInId]);
        const repo = m.getRepository(BatterySwap);
        return repo.save(repo.create({ organizationId: user.organizationId, hubId: veh.hub_id, vehicleId: i.vehicleId, riderId: i.riderId ?? null, batteryOutId: out?.id ?? null, batteryInId: i.batteryInId, recordedBy: user.sub }));
      });
    } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException('A battery is already fitted to this vehicle');
      throw e;
    }
  }

  async listSwaps(user: AuthUser, q: { hubId?: string }) {
    const scope = await this.scope.forUser(user);
    if (q.hubId) this.scope.assertHub(scope, q.hubId);
    const qb = this.ds.getRepository(BatterySwap).createQueryBuilder('s').where('s.organization_id=:o', { o: user.organizationId });
    if (!scope.all) qb.andWhere('s.hub_id = ANY(:h)', { h: scope.hubIds });
    if (q.hubId) qb.andWhere('s.hub_id=:hub', { hub: q.hubId });
    return qb.orderBy('s.swapped_at', 'DESC').limit(200).getMany();
  }

  // ---------- charging ----------
  async startCharge(user: AuthUser, i: { batteryId?: string; riderId?: string; chargePointId?: string }) {
    if (!i.batteryId) throw new BadRequestException('A charge needs batteryId');
    return this.ds.transaction(async (m) => {
      const b = await this.lockBattery(m, user.organizationId, i.batteryId!);
      if (!b.hubId) throw new ConflictException('The battery is not at a hub');
      this.scope.assertHub(await this.scope.forUser(user), b.hubId);
      const [open] = await m.query(`SELECT 1 FROM charge_events WHERE battery_id=$1 AND status='open'`, [b.id]);
      if (open) throw new ConflictException('This battery is already on charge');
      if (b.status === 'fitted') throw new ConflictException('Remove the battery from the vehicle (swap) before charging it');
      await m.query(`UPDATE batteries SET status='charging' WHERE id=$1`, [b.id]);
      const repo = m.getRepository(ChargeEvent);
      return repo.save(repo.create({ organizationId: user.organizationId, hubId: b.hubId!, batteryId: b.id, riderId: i.riderId ?? null, chargePointId: i.chargePointId ?? null, recordedBy: user.sub, chargeDate: todayAccra() }));
    });
  }

  /** Ends a charge and records the fee the rider owes for it; the fee is collected in the daily settlement. */
  async finishCharge(user: AuthUser, id: string, i: { kwh?: number; feePesewas?: number }) {
    const fee = assertPesewas(i.feePesewas ?? 0, 'feePesewas', { min: 0 });
    if (i.kwh !== undefined && (typeof i.kwh !== 'number' || i.kwh < 0)) throw new BadRequestException('kwh must be a non-negative number');
    return this.ds.transaction(async (m) => {
      const e = await m.getRepository(ChargeEvent).createQueryBuilder('e').setLock('pessimistic_write').where('e.id=:id AND e.organization_id=:o', { id, o: user.organizationId }).getOne();
      if (!e) throw new NotFoundException('Charge event not found');
      this.scope.assertHub(await this.scope.forUser(user), e.hubId);
      if (e.status !== 'open') throw new ConflictException('This charge has already been completed');
      await m.query(`UPDATE charge_events SET status='completed', ended_at=NOW(), kwh=$1, fee_pesewas=$2 WHERE id=$3`, [i.kwh ?? null, fee, id]);
      await m.query(`UPDATE batteries SET status='available' WHERE id=$1 AND status='charging'`, [e.batteryId]);
      return m.getRepository(ChargeEvent).findOneOrFail({ where: { id } });
    });
  }

  async listCharges(user: AuthUser, q: { hubId?: string; date?: string }) {
    const scope = await this.scope.forUser(user);
    if (q.hubId) this.scope.assertHub(scope, q.hubId);
    const qb = this.ds.getRepository(ChargeEvent).createQueryBuilder('e').where('e.organization_id=:o', { o: user.organizationId });
    if (!scope.all) qb.andWhere('e.hub_id = ANY(:h)', { h: scope.hubIds });
    if (q.hubId) qb.andWhere('e.hub_id=:hub', { hub: q.hubId });
    if (q.date) qb.andWhere('e.charge_date=:d', { d: assertIsoDate(q.date) });
    return qb.orderBy('e.started_at', 'DESC').limit(300).getMany();
  }

  // ---------- daily collections ----------
  /** Records fares taken from a rider. `reference` (receipt or MoMo id), when given, makes the entry safe to submit twice. */
  async recordCollection(user: AuthUser, i: { riderId?: string; amountPesewas?: number; date?: string; source?: 'cash' | 'momo' | 'other'; reference?: string }) {
    if (!i.riderId) throw new BadRequestException('A collection needs riderId');
    const amount = assertPesewas(i.amountPesewas, 'amountPesewas', { min: 1 });
    const date = assertIsoDate(i.date ?? todayAccra());
    return this.ds.transaction(async (m) => {
      const [a] = await m.query(
        `SELECT vehicle_id, hub_id FROM rider_assignments WHERE rider_id=$1 AND organization_id=$2 AND start_date <= $3 AND (end_date IS NULL OR end_date >= $3) ORDER BY start_date DESC LIMIT 1`,
        [i.riderId, user.organizationId, date]);
      if (!a) throw new ConflictException('This rider had no assigned vehicle on that date');
      this.scope.assertHub(await this.scope.forUser(user), a.hub_id);
      const [closed] = await m.query(`SELECT 1 FROM daily_settlements WHERE rider_id=$1 AND settlement_date=$2 AND is_current AND status='closed'`, [i.riderId, date]);
      if (closed) throw new ConflictException('That day is already closed; reopen is not allowed, record a correction through finance');
      if (i.reference) {
        const [dup] = await m.query(`SELECT id FROM daily_collections WHERE organization_id=$1 AND reference=$2`, [user.organizationId, i.reference]);
        if (dup) return { ...(await m.getRepository(DailyCollection).findOneOrFail({ where: { id: dup.id } })), duplicate: true };
      }
      const repo = m.getRepository(DailyCollection);
      return repo.save(repo.create({ organizationId: user.organizationId, hubId: a.hub_id, riderId: i.riderId!, vehicleId: a.vehicle_id, collectionDate: date, amountPesewas: amount, source: i.source ?? 'cash', reference: i.reference ?? null, recordedBy: user.sub }));
    });
  }

  async listCollections(user: AuthUser, q: { hubId?: string; date?: string; riderId?: string }) {
    const scope = await this.scope.forUser(user);
    if (q.hubId) this.scope.assertHub(scope, q.hubId);
    const qb = this.ds.getRepository(DailyCollection).createQueryBuilder('c').where('c.organization_id=:o', { o: user.organizationId });
    if (!scope.all) qb.andWhere('c.hub_id = ANY(:h)', { h: scope.hubIds });
    if (q.hubId) qb.andWhere('c.hub_id=:hub', { hub: q.hubId });
    if (q.riderId) qb.andWhere('c.rider_id=:r', { r: q.riderId });
    if (q.date) qb.andWhere('c.collection_date=:d', { d: assertIsoDate(q.date) });
    return qb.orderBy('c.created_at', 'DESC').limit(500).getMany();
  }
}
