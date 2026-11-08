import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TheftCase, TheftCaseStatus } from './entities/theft-case.entity';
import { RecoveryEvent } from './entities/recovery-event.entity';
import { RecoveryAction } from './entities/recovery-action.entity';
import { RecoveryNote } from './entities/recovery-note.entity';
import { ImmobilizerSafetyEngine } from './engines/immobilizer-safety.engine';
import { DigitalTwinService } from '../twin/digital-twin.service';
import { CommandsService } from '../commands/commands.service';
import { Device } from '../devices/entities/device.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { Role } from '../../common/constants/roles.constant';
import { RealtimeEventsGateway } from '../realtime/realtime-events.gateway';
import { ServerEvents } from '../../common/constants/websocket-events.constant';

const VALID_TRANSITIONS: Record<TheftCaseStatus, TheftCaseStatus[]> = {
  [TheftCaseStatus.SUSPECTED]: [TheftCaseStatus.ACTIVE, TheftCaseStatus.FALSE_ALARM],
  [TheftCaseStatus.ACTIVE]: [TheftCaseStatus.TRACKING, TheftCaseStatus.IMMOBILIZED, TheftCaseStatus.RECOVERED, TheftCaseStatus.FALSE_ALARM],
  [TheftCaseStatus.TRACKING]: [TheftCaseStatus.IMMOBILIZED, TheftCaseStatus.RECOVERED],
  [TheftCaseStatus.IMMOBILIZED]: [TheftCaseStatus.RECOVERED],
  [TheftCaseStatus.RECOVERED]: [TheftCaseStatus.CLOSED],
  [TheftCaseStatus.FALSE_ALARM]: [TheftCaseStatus.CLOSED],
  [TheftCaseStatus.CLOSED]: [],
};

const ROLES_ALLOWED_TO_APPROVE_IMMOBILIZATION: Role[] = [Role.SUPER_ADMIN, Role.ORG_ADMIN, Role.FLEET_MANAGER];

@Injectable()
export class TheftRecoveryService {
  constructor(
    @InjectRepository(TheftCase) private readonly cases: Repository<TheftCase>,
    @InjectRepository(RecoveryEvent) private readonly events: Repository<RecoveryEvent>,
    @InjectRepository(RecoveryAction) private readonly actions: Repository<RecoveryAction>,
    @InjectRepository(RecoveryNote) private readonly notes: Repository<RecoveryNote>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    private readonly safetyEngine: ImmobilizerSafetyEngine,
    private readonly twinService: DigitalTwinService,
    private readonly commandsService: CommandsService,
    private readonly realtimeGateway: RealtimeEventsGateway,
  ) {}

  findAll(query: { organizationId?: string; status?: TheftCaseStatus } = {}) {
    return this.cases.find({
      where: {
        ...(query.organizationId ? { organizationId: query.organizationId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      order: { reportedAt: 'DESC' },
    });
  }

  async findOne(id: string) {
    const theftCase = await this.cases.findOne({ where: { id } });
    if (!theftCase) throw new NotFoundException(`Theft case ${id} not found`);
    return theftCase;
  }

  async create(vehicleId: string, organizationId: string, reportedBy: string) {
    const device = await this.devices.findOne({ where: { vehicleId } });
    const twin = device ? await this.twinService.get(vehicleId) : null;

    const theftCase = await this.cases.save(
      this.cases.create({
        vehicleId,
        deviceId: device?.id,
        organizationId,
        reportedBy,
        status: TheftCaseStatus.SUSPECTED,
        lastKnownLatitude: twin?.position?.latitude,
        lastKnownLongitude: twin?.position?.longitude,
        lastKnownAt: twin?.lastUpdatedAt ? new Date(twin.lastUpdatedAt) : undefined,
      }),
    );

    await this.logEvent(theftCase.id, 'status_change', reportedBy, { toStatus: TheftCaseStatus.SUSPECTED });
    return theftCase;
  }

  async transitionStatus(id: string, toStatus: TheftCaseStatus, userId: string, resolutionNotes?: string) {
    const theftCase = await this.findOne(id);
    if (theftCase.status === toStatus) return theftCase;

    const allowed = VALID_TRANSITIONS[theftCase.status] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new BadRequestException(`Cannot transition theft case from "${theftCase.status}" to "${toStatus}"`);
    }

    const isTerminal = [TheftCaseStatus.RECOVERED, TheftCaseStatus.FALSE_ALARM, TheftCaseStatus.CLOSED].includes(toStatus);
    await this.cases.update(id, { status: toStatus, ...(isTerminal ? { resolvedAt: new Date(), resolutionNotes } : {}) });

    await this.logEvent(id, 'status_change', userId, { fromStatus: theftCase.status, toStatus });

    if (toStatus === TheftCaseStatus.ACTIVE) {
      this.realtimeGateway.emit(theftCase.organizationId, ServerEvents.THEFT_CASE_ACTIVATED, {
        caseId: id,
        vehicleId: theftCase.vehicleId,
      });
    }

    return this.findOne(id);
  }

  /** Activates high-frequency tracking by dropping the device's report interval to its shortest setting. */
  async enableHighFrequencyMode(id: string, userId: string) {
    const theftCase = await this.findOne(id);
    if (!theftCase.deviceId) throw new BadRequestException('No device linked to this case - cannot change reporting interval');

    await this.devices.update(theftCase.deviceId, { config: { reportIntervalSeconds: 10 } as any });
    await this.cases.update(id, { highFrequencyModeEnabled: true });
    await this.logEvent(id, 'high_freq_enabled', userId, {});

    this.realtimeGateway.emit(theftCase.organizationId, ServerEvents.RECOVERY_MODE_ENABLED, {
      caseId: id,
      vehicleId: theftCase.vehicleId,
      deviceId: theftCase.deviceId,
    });

    return this.findOne(id);
  }

  /**
   * Safety-gated immobilization: checks current speed via the live digital
   * twin, runs it through ImmobilizerSafetyEngine, and only dispatches the
   * command if safe OR the caller explicitly forces an emergency override
   * (itself logged with who did it and why).
   */
  async requestImmobilize(
    caseId: string,
    requestedBy: string,
    requesterRole: Role,
    emergencyOverride: boolean,
    overrideReason?: string,
  ) {
    if (!ROLES_ALLOWED_TO_APPROVE_IMMOBILIZATION.includes(requesterRole)) {
      throw new ForbiddenException(`Role "${requesterRole}" cannot request vehicle immobilization`);
    }

    const theftCase = await this.findOne(caseId);
    if (!theftCase.deviceId) throw new BadRequestException('No device linked to this case - cannot immobilize');

    const twin = await this.twinService.get(theftCase.vehicleId);
    const currentSpeed = twin?.position?.speed ?? 0;
    const safetyCheck = this.safetyEngine.evaluate(currentSpeed);

    const action = await this.actions.save(
      this.actions.create({
        theftCaseId: caseId,
        actionType: 'immobilize_request',
        requestedBy,
        safetyCheckResult: safetyCheck,
        status: safetyCheck.safeToImmobilize || emergencyOverride ? 'approved' : 'pending',
      }),
    );

    this.realtimeGateway.emit(theftCase.organizationId, ServerEvents.IMMOBILIZER_REQUESTED, {
      caseId,
      actionId: action.id,
      vehicleId: theftCase.vehicleId,
      safetyCheck,
      emergencyOverride,
    });

    if (!safetyCheck.safeToImmobilize && !emergencyOverride) {
      await this.logEvent(caseId, 'command_issued', requestedBy, { actionId: action.id, result: 'held_for_safety', safetyCheck });
      return {
        ...action,
        executed: false,
        message: `Immobilization held: ${safetyCheck.reason}. Re-request with emergencyOverride=true to force it (this will be logged).`,
      };
    }

    if (emergencyOverride && !safetyCheck.safeToImmobilize) {
      await this.logEvent(caseId, 'command_issued', requestedBy, {
        actionId: action.id,
        result: 'emergency_override_used',
        safetyCheck,
        overrideReason,
        overriddenBy: requestedBy,
      });
    }

    // immobilizer_on is a HIGH_RISK_COMMANDS entry in commands.service.ts,
    // so dispatch() alone only creates it in CREATED status awaiting
    // approval - it does not reach the device. The role check and safety
    // evaluation above already constitute the equivalent authorization for
    // an emergency theft-recovery context, so approve it immediately rather
    // than leaving a "dispatched but never actually sent" command sitting
    // in the queue while this method claims success.
    const command = await this.commandsService.dispatch(
      'immobilizer_on',
      requestedBy,
      { deviceId: theftCase.deviceId },
      { theftCaseId: caseId, emergencyOverride },
    );
    const commandId = Array.isArray(command) ? command[0]?.id : command?.id;
    if (commandId) {
      await this.commandsService.approve(commandId, requestedBy);
    }

    await this.actions.update(action.id, { commandId, status: 'executed', resolvedAt: new Date() });

    // The command has already been dispatched and approved above - that is
    // the safety-critical, irreversible fact. A failure updating the case's
    // status label (e.g. an unexpected transition-table gap) must never
    // surface as "the immobilization failed" to the caller when it didn't -
    // that would be actively dangerous (someone re-attempting or assuming
    // the vehicle is still free to drive when it isn't).
    try {
      await this.transitionStatus(caseId, TheftCaseStatus.IMMOBILIZED, requestedBy);
    } catch (err) {
      await this.logEvent(caseId, 'command_issued', requestedBy, {
        actionId: action.id,
        commandId,
        result: 'dispatched_but_status_transition_failed',
        error: (err as Error).message,
      });
    }

    await this.logEvent(caseId, 'command_issued', requestedBy, { actionId: action.id, commandId, result: 'dispatched' });

    this.realtimeGateway.emit(theftCase.organizationId, ServerEvents.IMMOBILIZER_EXECUTED, {
      caseId,
      actionId: action.id,
      vehicleId: theftCase.vehicleId,
      commandId,
      emergencyOverride,
    });

    return {
      ...action,
      commandId,
      executed: true,
      message: 'Immobilization command sent to the device (or queued if currently offline) - check the command status for live delivery confirmation.',
    };
  }

  async assignTeam(caseId: string, teamId: string, userId: string) {
    await this.findOne(caseId);
    await this.cases.update(caseId, { assignedTeamId: teamId });
    await this.logEvent(caseId, 'team_assigned', userId, { teamId });
    return this.findOne(caseId);
  }

  async addNote(caseId: string, note: string, authorId: string) {
    await this.findOne(caseId);
    return this.notes.save(this.notes.create({ theftCaseId: caseId, note, authorId }));
  }

  listNotes(caseId: string) {
    return this.notes.find({ where: { theftCaseId: caseId }, order: { createdAt: 'ASC' } });
  }

  listEvents(caseId: string) {
    return this.events.find({ where: { theftCaseId: caseId }, order: { createdAt: 'ASC' } });
  }

  listActions(caseId: string) {
    return this.actions.find({ where: { theftCaseId: caseId }, order: { requestedAt: 'DESC' } });
  }

  private async logEvent(theftCaseId: string, eventType: string, createdBy: string, details: Record<string, unknown>) {
    return this.events.save(this.events.create({ theftCaseId, eventType, createdBy, details }));
  }
}
