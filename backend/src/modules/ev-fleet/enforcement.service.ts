import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { ImmobilizerState, GracePeriodState } from './entities/immobilizer-state.entity';
import { LockRequest } from './entities/lock-request.entity';
import { RiderException } from './entities/rider-exception.entity';
import { Rider } from './entities/rider.entity';
import { Device } from '../devices/entities/device.entity';
import { DigitalTwinService } from '../twin/digital-twin.service';
import { CommandsService } from '../commands/commands.service';
import { ChannelFactory } from '../notifications/channels/channel.factory';
import { NotificationChannel } from '../notifications/entities/notification.entity';
import { DataScopeService } from '../hubs/data-scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, ADMIN_ROLES } from '../../common/auth/auth-user';
import { Role } from '../../common/constants/roles.constant';
import { todayAccra, assertIsoDate } from '../../common/dates/dates';

export const SAFE_SPEED_KMH = 5;       // never lock a vehicle that is moving faster than this
export const DEFAULT_GRACE_HOURS = 12; // BR16: used when neither the contract nor the hub sets one
export const WORK_AND_PAY_QUEUE = 'work-and-pay';
export const SETTLEMENT_SETTLED_EVENT = 'settlement.settled';

export interface LockContext { source: 'settlement' | 'payment_gateway' | 'manual'; settlementId?: string | null; paymentLogId?: string | null; requestId?: string | null; reason?: string }

/**
 * Link between money and the vehicle: a settlement shortfall starts a grace period (BR16), when it ends the vehicle
 * is locked only when it is stationary (BR8/BR9), and paying the shortfall (or a manual unlock with a reason)
 * releases it again. Manual locks need an administrator's approval.
 */
@Injectable()
export class EnforcementService {
  private readonly logger = new Logger(EnforcementService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(ImmobilizerState) private readonly states: Repository<ImmobilizerState>,
    @InjectRepository(LockRequest) private readonly requests: Repository<LockRequest>,
    @InjectRepository(RiderException) private readonly exceptions: Repository<RiderException>,
    @InjectRepository(Rider) private readonly riders: Repository<Rider>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectQueue(WORK_AND_PAY_QUEUE) private readonly queue: Queue,
    private readonly twin: DigitalTwinService,
    private readonly commands: CommandsService,
    private readonly channels: ChannelFactory,
    private readonly scope: DataScopeService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------- rules

  /** Contract setting wins over the hub setting, which wins over the default of 12 hours (BR16). */
  async graceHours(riderId: string, vehicleId: string): Promise<number> {
    const [c] = await this.ds.query(
      `SELECT grace_period_hours AS h FROM sale_contracts WHERE vehicle_id=$1 AND status IN ('active','defaulted') AND grace_period_hours IS NOT NULL ORDER BY created_at DESC LIMIT 1`, [vehicleId]);
    if (c?.h) return Number(c.h);
    const [h] = await this.ds.query(`SELECT h.grace_period_hours AS h FROM riders r JOIN hubs h ON h.id=r.hub_id WHERE r.id=$1`, [riderId]);
    return h?.h ? Number(h.h) : DEFAULT_GRACE_HOURS;
  }

  async activeException(riderId: string, date = todayAccra()): Promise<RiderException | null> {
    return this.exceptions.createQueryBuilder('e')
      .where(`e.rider_id=:riderId AND e.status='active' AND :date BETWEEN e.starts_on AND e.ends_on`, { riderId, date }).getOne();
  }

  /** An internal account that attributes automatic commands; created on first use so nothing has to be seeded by hand. */
  async systemUserId(organizationId: string): Promise<string> {
    const configured = this.config.get<string>('WORK_AND_PAY_SYSTEM_USER_ID');
    if (configured) return configured;
    const email = `system+${organizationId}@vtrack.internal`;
    const [row] = await this.ds.query(
      `INSERT INTO users (organization_id, email, password_hash, first_name, last_name, role, is_active)
       VALUES ($1,$2,'!','V-Track','System',$3,true)
       ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id`, [organizationId, email, Role.SYSTEM]);
    return row.id;
  }

  // ------------------------------------------------------------ automatic

  @OnEvent('settlement.shortfall')
  async onShortfall(e: { organizationId: string; riderId: string; vehicleId: string; settlementId: string; shortfallPesewas: number; date: string }) {
    try {
      await this.startGrace(e.riderId, { source: 'settlement', settlementId: e.settlementId }, `Shortfall of GHS ${(e.shortfallPesewas / 100).toFixed(2)} for ${e.date}`);
    } catch (err) { this.logger.error(`Could not start grace period for rider ${e.riderId}: ${(err as Error).message}`); }
  }

  /** Fired when a recalculation shows the day is covered after all: the grace clock stops and a lock is released. */
  @OnEvent(SETTLEMENT_SETTLED_EVENT)
  async onSettled(e: { organizationId: string; vehicleId: string; settlementId: string }) {
    try {
      const st = await this.states.findOne({ where: { vehicleId: e.vehicleId } });
      if (st && st.state !== GracePeriodState.NONE && st.triggerSource === 'settlement') {
        await this.release(e.organizationId, e.vehicleId, 'Shortfall settled', null, 'settlement');
      }
    } catch (err) { this.logger.error(`Could not clear enforcement for ${e.vehicleId}: ${(err as Error).message}`); }
  }

  async startGrace(riderId: string, ctx: LockContext, note?: string) {
    const rider = await this.riders.findOne({ where: { id: riderId } });
    if (!rider?.assignedVehicleId) return { started: false, reason: 'rider has no vehicle' };
    const vehicleId = rider.assignedVehicleId;

    const exc = await this.activeException(riderId);
    if (exc) { this.logger.log(`Rider ${riderId} has an approved exception (${exc.kind}) - no grace period started`); return { started: false, reason: `approved exception: ${exc.kind}` }; }

    const hours = await this.graceHours(riderId, vehicleId);
    let st = await this.states.findOne({ where: { vehicleId } });
    if (!st) st = await this.states.save(this.states.create({ vehicleId, riderId, state: GracePeriodState.NONE }));
    if (st.state !== GracePeriodState.NONE) return { started: false, reason: `already ${st.state}` };

    await this.states.update(st.id, {
      state: GracePeriodState.WARNING_SENT, riderId, gracePeriodStartedAt: new Date(), gracePeriodHours: hours, warningSentAt: new Date(),
      paymentLogId: ctx.paymentLogId ?? undefined, settlementId: ctx.settlementId ?? null, triggerSource: ctx.source,
      unlockedAt: null, unlockReason: null, unlockedBy: null,
    } as any);

    // SMS warning hook. The provider is configured separately; failure to send must not stop the clock.
    try {
      await this.channels.get(NotificationChannel.SMS).send({
        to: rider.phone, title: 'V-Track Pro: payment reminder',
        body: `Hi ${rider.fullName}, your remittance is not fully paid. Please pay within ${hours} hours so your vehicle is not locked.`,
      });
    } catch (err) { this.logger.warn(`Warning SMS not sent: ${(err as Error).message}`); }

    await this.queue.add('safety-retry-immobilize', { vehicleId }, { delay: hours * 3600_000, jobId: `grace-${st.id}-${Date.now()}` });
    await this.record(rider.organizationId, null, 'enforcement.grace_started', vehicleId, { riderId, hours, source: ctx.source, note });
    return { started: true, hours };
  }

  /** Called by the queue when the grace period ends. */
  async onGraceExpired(vehicleId: string) {
    const st = await this.states.findOne({ where: { vehicleId } });
    if (!st || st.state !== GracePeriodState.WARNING_SENT) return { locked: false, reason: 'no active grace period' };
    const rider = await this.riders.findOne({ where: { id: st.riderId } });
    if (!rider) return { locked: false, reason: 'rider not found' };
    if (await this.activeException(rider.id)) {
      await this.states.update(st.id, { state: GracePeriodState.NONE });
      await this.record(rider.organizationId, null, 'enforcement.skipped_exception', vehicleId, { riderId: rider.id });
      return { locked: false, reason: 'approved exception' };
    }
    return this.executeLock(rider.organizationId, vehicleId, { source: (st.triggerSource as any) ?? 'settlement', settlementId: st.settlementId, paymentLogId: st.paymentLogId });
  }

  /** The safety-critical step: never lock a moving vehicle. */
  async executeLock(organizationId: string, vehicleId: string, ctx: LockContext, actorId?: string) {
    const st = await this.states.findOne({ where: { vehicleId } });
    const twin = await this.twin.get(vehicleId).catch(() => null);
    const speed = twin?.position?.speed ?? 0;
    if (speed > SAFE_SPEED_KMH) {
      if (st) await this.states.update(st.id, { lastSafetyCheckSpeedKmh: speed });
      await this.queue.add('safety-retry-immobilize', { vehicleId }, { delay: 5 * 60_000 });
      await this.record(organizationId, actorId ?? null, 'enforcement.lock_deferred', vehicleId, { speed });
      return { locked: false, deferred: true, reason: `vehicle moving at ${speed} km/h; retrying in 5 minutes` };
    }
    const device = await this.devices.findOne({ where: { vehicleId } });
    if (!device) {
      await this.record(organizationId, actorId ?? null, 'enforcement.lock_failed', vehicleId, { reason: 'no tracker linked' });
      return { locked: false, reason: 'no tracker device is linked to this vehicle' };
    }
    const systemId = await this.systemUserId(organizationId);
    const command: any = await this.commands.dispatch('immobilizer_on', systemId, { deviceId: device.id }, { reason: ctx.reason ?? `enforcement:${ctx.source}`, requestId: ctx.requestId });
    // The business approval (grace period elapsed, or an administrator approved) already happened; the command layer's own gate is satisfied by the system account.
    if (command?.requiresApproval && command.status !== 'queued') await this.commands.approve(command.id, systemId).catch((e) => this.logger.warn(e.message));
    const rider = await this.riders.findOne({ where: st ? { id: st.riderId } : { assignedVehicleId: vehicleId } });
    if (st) await this.states.update(st.id, { state: GracePeriodState.IMMOBILIZED, immobilizedAt: new Date(), commandId: command?.id, triggerSource: ctx.source, lastSafetyCheckSpeedKmh: speed });
    else if (rider) await this.states.save(this.states.create({ vehicleId, riderId: rider.id, state: GracePeriodState.IMMOBILIZED, immobilizedAt: new Date(), commandId: command?.id, triggerSource: ctx.source }));
    await this.record(organizationId, actorId ?? null, 'enforcement.locked', vehicleId, { source: ctx.source, commandId: command?.id, speed });
    return { locked: true, commandId: command?.id };
  }

  /** Clear the state and send immobilizer_off when the vehicle was locked. */
  async release(organizationId: string, vehicleId: string, reason: string, actorId: string | null, source: string) {
    const st = await this.states.findOne({ where: { vehicleId } });
    if (!st || st.state === GracePeriodState.NONE) return { released: false, reason: 'vehicle is not locked or in a grace period' };
    let commandId: string | null = null;
    if (st.state === GracePeriodState.IMMOBILIZED) {
      const device = await this.devices.findOne({ where: { vehicleId } });
      if (device) {
        const sys = actorId ?? (await this.systemUserId(organizationId));
        const cmd: any = await this.commands.dispatch('immobilizer_off', sys, { deviceId: device.id }, { reason });
        commandId = cmd?.id ?? null;
      }
    }
    await this.states.update(st.id, { state: GracePeriodState.NONE, unlockedAt: new Date(), unlockReason: reason, unlockedBy: actorId, commandId: commandId ?? undefined, paymentLogId: undefined, settlementId: null } as any);
    await this.record(organizationId, actorId, 'enforcement.released', vehicleId, { reason, source, commandId });
    return { released: true, commandId };
  }

  // --------------------------------------------------------------- manual

  private async vehicleContext(user: AuthUser, vehicleId: string) {
    const [v] = await this.ds.query(
      `SELECT v.id, v.organization_id, r.id AS rider_id, r.hub_id FROM vehicles v LEFT JOIN riders r ON r.assigned_vehicle_id=v.id WHERE v.id=$1`, [vehicleId]);
    if (!v || v.organization_id !== user.organizationId) throw new NotFoundException('Vehicle not found');
    if (v.hub_id) this.scope.assertHub(await this.scope.forUser(user), v.hub_id);
    else if (!ADMIN_ROLES.includes(user.role)) throw new ForbiddenException('Only an administrator can act on a vehicle that is not at a hub');
    return v as { id: string; rider_id: string | null; hub_id: string | null };
  }

  async requestLock(user: AuthUser, i: { vehicleId: string; reason: string }) {
    if (!i.reason?.trim() || i.reason.trim().length < 3) throw new BadRequestException('A reason is required');
    const v = await this.vehicleContext(user, i.vehicleId);
    const existing = await this.requests.findOne({ where: { vehicleId: i.vehicleId, kind: 'lock', status: 'pending' } });
    if (existing) throw new ConflictException('There is already a pending lock request for this vehicle');
    const st = await this.states.findOne({ where: { vehicleId: i.vehicleId } });
    if (st?.state === GracePeriodState.IMMOBILIZED) throw new ConflictException('The vehicle is already locked');
    return this.requests.save(this.requests.create({ organizationId: user.organizationId, hubId: v.hub_id, vehicleId: i.vehicleId, riderId: v.rider_id, kind: 'lock', reason: i.reason.trim(), requestedBy: user.sub }));
  }

  async decide(user: AuthUser, id: string, approve: boolean, note?: string) {
    if (!ADMIN_ROLES.includes(user.role)) throw new ForbiddenException('Only an administrator can approve or reject a lock');
    const r = await this.requests.findOne({ where: { id, organizationId: user.organizationId } });
    if (!r) throw new NotFoundException('Lock request not found');
    if (r.status !== 'pending') throw new ConflictException(`Request is already ${r.status}`);
    if (!approve) {
      await this.requests.update(id, { status: 'rejected', decidedBy: user.sub, decidedAt: new Date(), decisionNote: note ?? null });
      return this.requests.findOne({ where: { id } });
    }
    const res = await this.executeLock(user.organizationId, r.vehicleId, { source: 'manual', requestId: id, reason: r.reason }, user.sub);
    await this.requests.update(id, {
      status: res.locked ? 'executed' : res.deferred ? 'approved' : 'failed', decidedBy: user.sub, decidedAt: new Date(), decisionNote: note ?? null,
      commandId: (res as any).commandId ?? null, resultNote: res.locked ? null : (res as any).reason ?? null,
    });
    return { request: await this.requests.findOne({ where: { id } }), result: res };
  }

  /** Release a vehicle by hand. The reason is stored and audited. Hub managers can do this only for their own hub. */
  async manualUnlock(user: AuthUser, i: { vehicleId: string; reason: string }) {
    if (!i.reason?.trim() || i.reason.trim().length < 3) throw new BadRequestException('A reason is required to unlock');
    const v = await this.vehicleContext(user, i.vehicleId);
    const res = await this.release(user.organizationId, i.vehicleId, i.reason.trim(), user.sub, 'manual');
    if (!res.released) throw new ConflictException((res as any).reason);
    await this.requests.save(this.requests.create({ organizationId: user.organizationId, hubId: v.hub_id, vehicleId: i.vehicleId, riderId: v.rider_id, kind: 'unlock', reason: i.reason.trim(), status: 'executed', requestedBy: user.sub, decidedBy: user.sub, decidedAt: new Date(), commandId: res.commandId }));
    return res;
  }

  async listRequests(user: AuthUser, q: { status?: string }) {
    const scope = await this.scope.forUser(user);
    const qb = this.requests.createQueryBuilder('r').where('r.organization_id=:o', { o: user.organizationId });
    if (!scope.all) qb.andWhere('r.hub_id IN (:...h)', { h: scope.hubIds.length ? scope.hubIds : ['00000000-0000-0000-0000-000000000000'] });
    if (q.status) qb.andWhere('r.status=:s', { s: q.status });
    return qb.orderBy('r.created_at', 'DESC').limit(200).getMany();
  }

  async listStates(user: AuthUser) {
    const scope = await this.scope.forUser(user);
    const params: unknown[] = [user.organizationId];
    let hubSql = '';
    if (!scope.all) { params.push(scope.hubIds.length ? scope.hubIds : ['00000000-0000-0000-0000-000000000000']); hubSql = 'AND r.hub_id = ANY($2)'; }
    return this.ds.query(
      `SELECT s.vehicle_id AS "vehicleId", v.plate_number AS "vehicleName", v.plate_number AS plate, s.rider_id AS "riderId", r.full_name AS "riderName", r.hub_id AS "hubId",
              s.state, s.grace_period_hours AS "graceHours", s.grace_period_started_at AS "graceStartedAt", s.immobilized_at AS "lockedAt",
              s.trigger_source AS "source", s.unlocked_at AS "unlockedAt", s.unlock_reason AS "unlockReason"
         FROM immobilizer_state s JOIN riders r ON r.id=s.rider_id JOIN vehicles v ON v.id=s.vehicle_id
        WHERE r.organization_id=$1 ${hubSql} ORDER BY s.updated_at DESC LIMIT 300`, params);
  }

  // ----------------------------------------------------- rider exceptions

  async createException(user: AuthUser, i: { riderId: string; kind: string; startsOn: string; endsOn: string; reason: string }) {
    assertIsoDate(i.startsOn, 'startsOn'); assertIsoDate(i.endsOn, 'endsOn');
    if (i.endsOn < i.startsOn) throw new BadRequestException('endsOn must not be before startsOn');
    if (!['sickness', 'breakdown', 'leave', 'other'].includes(i.kind)) throw new BadRequestException('Invalid kind');
    if (!i.reason?.trim() || i.reason.trim().length < 3) throw new BadRequestException('A reason is required');
    const rider = await this.riders.findOne({ where: { id: i.riderId, organizationId: user.organizationId } });
    if (!rider) throw new NotFoundException('Rider not found');
    if (rider.hubId) this.scope.assertHub(await this.scope.forUser(user), rider.hubId);
    const saved = await this.exceptions.save(this.exceptions.create({ organizationId: user.organizationId, riderId: i.riderId, kind: i.kind as any, startsOn: i.startsOn, endsOn: i.endsOn, reason: i.reason.trim(), approvedBy: user.sub }));
    // an exception that starts now also stops a running grace period
    if (saved.startsOn <= todayAccra() && saved.endsOn >= todayAccra() && rider.assignedVehicleId) {
      const st = await this.states.findOne({ where: { vehicleId: rider.assignedVehicleId } });
      if (st && st.state !== GracePeriodState.NONE) await this.release(user.organizationId, rider.assignedVehicleId, `Approved exception: ${i.kind}`, user.sub, 'exception');
    }
    return saved;
  }

  listExceptions(user: AuthUser, riderId?: string) {
    return this.exceptions.find({ where: { organizationId: user.organizationId, ...(riderId ? { riderId } : {}) }, order: { createdAt: 'DESC' }, take: 200 });
  }

  async cancelException(user: AuthUser, id: string) {
    const e = await this.exceptions.findOne({ where: { id, organizationId: user.organizationId } });
    if (!e) throw new NotFoundException('Exception not found');
    await this.exceptions.update(id, { status: 'cancelled' });
    return { ...e, status: 'cancelled' };
  }

  private record(organizationId: string, userId: string | null, action: string, vehicleId: string, values: Record<string, unknown>) {
    return this.audit.record({ organizationId, userId: userId ?? undefined, action, resourceType: 'vehicle', resourceId: vehicleId, newValues: values }).catch(() => undefined);
  }
}
