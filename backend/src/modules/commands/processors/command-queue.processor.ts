import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { RemoteCommand } from '../entities/remote-command.entity';
import { CommandStatus } from '../../../common/constants/alerts.constant';
import { CommandsGateway } from '../gateways/commands.gateway';
import { CommandsService } from '../commands.service';
import { SmsWakeupService } from '../engines/sms-wakeup.service';
import { DeviceTcpService } from '../../devices/tcp/device-tcp.service';
import { Device } from '../../devices/entities/device.entity';

export interface CommandJobData {
  commandId: string;
}

const ACK_TIMEOUT_MS = 2 * 60 * 1000; // if not acknowledged within this window, try the SMS fallback

/**
 * BullMQ worker for the 'device-commands' queue. Drives a command from
 * QUEUED through SENT, and schedules a delayed timeout-check job that
 * triggers the SMS wake-up fallback if the device never acknowledges -
 * implementing the spec's "commands must work even when devices are
 * offline or sleeping" requirement.
 */
@Processor('device-commands')
export class CommandQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(CommandQueueProcessor.name);

  constructor(
    @InjectRepository(RemoteCommand) private readonly commands: Repository<RemoteCommand>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    private readonly gateway: CommandsGateway,
    private readonly commandsService: CommandsService,
    private readonly smsWakeup: SmsWakeupService,
    private readonly tcpService: DeviceTcpService,
    @InjectQueue('device-commands') private readonly queue: Queue<CommandJobData & { checkTimeout?: boolean }>,
  ) {
    super();
  }

  async process(job: Job<CommandJobData & { checkTimeout?: boolean }>): Promise<void> {
    if (job.data.checkTimeout) {
      return this.handleTimeoutCheck(job.data.commandId);
    }
    return this.handleSend(job.data.commandId);
  }

  private async handleSend(commandId: string) {
    const command = await this.commands.findOne({ where: { id: commandId } });
    if (!command || command.status === CommandStatus.CANCELLED) return;

    const device = await this.devices.findOne({ where: { id: command.deviceId } });
    if (!device) return;

    const delivered = this.tcpService.trySendCommand(device.imei, command.command, command.parameters as any);

    if (delivered) {
      await this.commandsService.transition(commandId, CommandStatus.SENT, 'delivered to live TCP connection');
      await this.commands.update(commandId, { sentAt: new Date() });
    } else {
      await this.commandsService.transition(commandId, CommandStatus.WAITING_FOR_DEVICE, 'device not connected');
    }

    // Either way, schedule a timeout check - covers both "sent but never
    // acknowledged" and "device wasn't even connected to receive it".
    await this.queue.add(
      'timeout-check',
      { commandId, checkTimeout: true },
      { delay: ACK_TIMEOUT_MS },
    );
  }

  private async handleTimeoutCheck(commandId: string) {
    const command = await this.commands.findOne({ where: { id: commandId } });
    if (!command) return;

    if ([CommandStatus.ACKNOWLEDGED, CommandStatus.EXECUTED, CommandStatus.CANCELLED].includes(command.status as CommandStatus)) {
      return; // already resolved, nothing to do
    }

    if (command.status === CommandStatus.WAITING_FOR_DEVICE) {
      this.logger.log(`Command ${commandId} timed out waiting for device - triggering SMS wake-up`);
      const wakeup = await this.smsWakeup.trigger(commandId, command.deviceId);

      if (wakeup.triggered) {
        // Give the device a window to reconnect and re-attempt delivery.
        await this.queue.add('send', { commandId }, { delay: 30_000 });
      } else {
        await this.commandsService.transition(commandId, CommandStatus.TIMEOUT, wakeup.reason ?? 'SMS wake-up unavailable');
      }
      return;
    }

    if (command.status === CommandStatus.SENT) {
      await this.commandsService.transition(commandId, CommandStatus.TIMEOUT, 'no acknowledgement received');
    }
  }
}
