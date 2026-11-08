import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { RemoteCommand } from './entities/remote-command.entity';
import { DeviceCommandLog } from './entities/device-command-log.entity';
import { DevicesService } from '../devices/devices.service';
import { DeviceTargetDto } from './dto/send-command.dto';
import { CommandStatus } from '../../common/constants/alerts.constant';
import { assertTransition, isTerminal } from './engines/command-state-machine';
import { CommandsGateway } from './gateways/commands.gateway';
import { CommandJobData } from './processors/command-queue.processor';

// High-risk commands require explicit approval before they're queued -
// per the spec's "MFA/approval for critical commands" requirement. MFA
// itself isn't implemented here (would hang off the existing 2FA flow in
// AuthService); approval is enforced as a required extra API call.
const HIGH_RISK_COMMANDS = new Set([
  'immobilizer_on',
  'engine_stop',
  'fuel_cutoff',
  'device_reboot',
  'firmware_update',
  'ev_charge_stop',
]);

const DEFAULT_COMMAND_TTL_MS = 10 * 60 * 1000; // commands expire if never delivered

@Injectable()
export class CommandsService {
  private readonly logger = new Logger(CommandsService.name);

  constructor(
    @InjectRepository(RemoteCommand) private readonly commands: Repository<RemoteCommand>,
    @InjectRepository(DeviceCommandLog) private readonly commandLogs: Repository<DeviceCommandLog>,
    private readonly devicesService: DevicesService,
    private readonly gateway: CommandsGateway,
    @InjectQueue('device-commands') private readonly queue: Queue<CommandJobData>,
  ) {}

  async dispatch(commandName: string, userId: string, dto: DeviceTargetDto, parameters?: Record<string, unknown>) {
    const targets = dto.deviceIds ?? (dto.deviceId ? [dto.deviceId] : []);
    if (targets.length === 0) throw new BadRequestException('Provide deviceId or deviceIds');

    const requiresApproval = HIGH_RISK_COMMANDS.has(commandName);
    const results = await Promise.all(
      targets.map((deviceId) => this.create(deviceId, userId, commandName, parameters, dto.scheduledFor, requiresApproval)),
    );

    return targets.length === 1 ? results[0] : results;
  }

  private async create(
    deviceId: string,
    userId: string,
    commandName: string,
    parameters: Record<string, unknown> | undefined,
    scheduledFor: string | undefined,
    requiresApproval: boolean,
  ) {
    const device = await this.devicesService.findOne(deviceId);

    const command = await this.commands.save(
      this.commands.create({
        organizationId: device.organizationId,
        deviceId,
        userId,
        command: commandName,
        parameters,
        scheduledFor: scheduledFor ? new Date(scheduledFor) : undefined,
        requiresApproval,
        expiresAt: new Date(Date.now() + DEFAULT_COMMAND_TTL_MS),
        status: CommandStatus.CREATED,
      }),
    );
    await this.logTransition(command.id, undefined, CommandStatus.CREATED);

    if (!requiresApproval) {
      await this.transition(command.id, CommandStatus.QUEUED, 'auto-approved (low risk)');
      await this.enqueue(command.id, scheduledFor);
    }

    return this.commands.findOne({ where: { id: command.id } });
  }

  async approve(commandId: string, approverId: string) {
    const command = await this.findOrThrow(commandId);
    await this.transition(commandId, CommandStatus.APPROVED, `approved by ${approverId}`);
    await this.commands.update(commandId, { approvedBy: approverId, approvedAt: new Date() } as any);
    await this.transition(commandId, CommandStatus.QUEUED, 'queued after approval');
    await this.enqueue(commandId, command.scheduledFor?.toISOString());
    return this.commands.findOne({ where: { id: commandId } });
  }

  async cancel(commandId: string, userId: string, reason?: string) {
    const command = await this.findOrThrow(commandId);
    if (isTerminal(command.status as CommandStatus)) {
      throw new BadRequestException(`Command ${commandId} is already in a terminal state (${command.status})`);
    }
    await this.transition(commandId, CommandStatus.CANCELLED, reason ?? `cancelled by ${userId}`);
    await this.commands.update(commandId, { cancelledBy: userId, cancelledAt: new Date() } as any);
    return this.commands.findOne({ where: { id: commandId } });
  }

  async stateHistory(commandId: string) {
    return this.commandLogs.find({ where: { commandId }, order: { createdAt: 'ASC' } });
  }

  async findOne(commandId: string) {
    return this.findOrThrow(commandId);
  }

  history(query: { deviceId?: string; userId?: string; limit?: number } = {}) {
    return this.commands.find({
      where: {
        ...(query.deviceId ? { deviceId: query.deviceId } : {}),
        ...(query.userId ? { userId: query.userId } : {}),
      },
      order: { createdAt: 'DESC' },
      take: query.limit ?? 50,
    });
  }

  /** Called by CommandQueueProcessor / DeviceTcpService as a command actually moves through delivery. */
  async transition(commandId: string, to: CommandStatus, reason?: string) {
    const command = await this.findOrThrow(commandId);
    const from = command.status as CommandStatus;
    assertTransition(from, to);

    await this.commands.update(commandId, { status: to });
    await this.logTransition(commandId, from, to, reason);
    this.gateway.broadcastStatus(commandId, command.deviceId, to);
    return to;
  }

  private async enqueue(commandId: string, scheduledFor?: string) {
    const delay = scheduledFor ? Math.max(0, new Date(scheduledFor).getTime() - Date.now()) : 0;
    await this.queue.add('send', { commandId }, { delay, attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
  }

  private async logTransition(commandId: string, from: CommandStatus | undefined, to: CommandStatus, reason?: string) {
    await this.commandLogs.save(this.commandLogs.create({ commandId, fromState: from, toState: to, reason }));
  }

  private async findOrThrow(commandId: string): Promise<RemoteCommand> {
    const command = await this.commands.findOne({ where: { id: commandId } });
    if (!command) throw new NotFoundException(`Command ${commandId} not found`);
    return command;
  }
}
