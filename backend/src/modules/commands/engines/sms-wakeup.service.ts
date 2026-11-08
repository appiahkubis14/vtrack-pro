import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SmsWakeupLog } from '../entities/sms-wakeup-log.entity';
import { Device } from '../../devices/entities/device.entity';
import { SmsChannel } from '../../notifications/channels/sms.channel';

// Vendor-specific wake-up strings - GT06 clones commonly accept a plain
// "reset#" or "wake#" SMS command; confirm against your specific firmware
// before relying on this in production. TK103 variants differ per factory
// (see the caveat in tk103.processor.ts) - the string below is a common one,
// not universal.
const WAKEUP_STRINGS: Record<string, string> = {
  gt06: 'wake#',
  tk103: '**,imei:{imei},B;',
};

const MAX_WAKEUPS_PER_DEVICE_PER_DAY = 5; // cost control - SMS isn't free at fleet scale

@Injectable()
export class SmsWakeupService {
  private readonly logger = new Logger(SmsWakeupService.name);

  constructor(
    @InjectRepository(SmsWakeupLog) private readonly logs: Repository<SmsWakeupLog>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    private readonly smsChannel: SmsChannel,
  ) {}

  async trigger(commandId: string, deviceId: string): Promise<{ triggered: boolean; reason?: string }> {
    const device = await this.devices.findOne({ where: { id: deviceId } });
    if (!device?.simNumber) {
      return { triggered: false, reason: 'Device has no SIM number on file' };
    }

    const sentToday = await this.logs
      .createQueryBuilder('l')
      .where('l.device_id = :deviceId', { deviceId })
      .andWhere("l.sent_at >= now() - interval '1 day'")
      .getCount();

    if (sentToday >= MAX_WAKEUPS_PER_DEVICE_PER_DAY) {
      this.logger.warn(`SMS wake-up rate limit hit for device ${deviceId} (${sentToday} today)`);
      return { triggered: false, reason: 'Daily SMS wake-up limit reached for this device' };
    }

    const template = WAKEUP_STRINGS[device.protocol] ?? 'wake#';
    const wakeupString = template.replace('{imei}', device.imei);

    const result = await this.smsChannel.send({
      to: device.simNumber,
      title: 'Device wake-up',
      body: wakeupString,
    });

    await this.logs.save(
      this.logs.create({
        commandId,
        deviceId,
        phoneNumber: device.simNumber,
        wakeupString,
        status: result.success ? 'sent' : 'failed',
        sentAt: new Date(),
      }),
    );

    return { triggered: result.success, reason: result.error };
  }

  /** Call when the device's next TCP check-in arrives after a wake-up was sent, to close the loop. */
  async markReconnected(deviceId: string) {
    const recent = await this.logs.findOne({
      where: { deviceId, status: 'sent' },
      order: { sentAt: 'DESC' },
    });
    if (!recent || recent.reconnectedAt) return;
    await this.logs.update(recent.id, { status: 'reconnected', reconnectedAt: new Date() });
  }
}
