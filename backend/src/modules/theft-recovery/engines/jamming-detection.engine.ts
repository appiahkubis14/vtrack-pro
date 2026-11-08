import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { Device } from '../../devices/entities/device.entity';
import { ParsedPosition } from '../../devices/processors/protocol.interface';
import { AlertsService } from '../../alerts/alerts.service';
import { AlertSeverity, AlertType } from '../../../common/constants/alerts.constant';
import { RealtimeEventsGateway } from '../../realtime/realtime-events.gateway';
import { ServerEvents } from '../../../common/constants/websocket-events.constant';

const CONSECUTIVE_ZERO_FIX_THRESHOLD = 3;

@Injectable()
export class JammingDetectionEngine {
  private readonly logger = new Logger(JammingDetectionEngine.name);
  private readonly consecutiveZeroFix = new Map<string, number>();
  private readonly alreadyAlerted = new Set<string>();

  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    private readonly alertsService: AlertsService,
    private readonly realtimeGateway: RealtimeEventsGateway,
  ) {}

  @OnEvent('position.created')
  async onPosition(payload: { deviceId: string; position: ParsedPosition }) {
    const satellites = payload.position.satellites;
    if (satellites === undefined) return;

    if (satellites > 0) {
      this.consecutiveZeroFix.delete(payload.deviceId);
      this.alreadyAlerted.delete(payload.deviceId);
      return;
    }

    const count = (this.consecutiveZeroFix.get(payload.deviceId) ?? 0) + 1;
    this.consecutiveZeroFix.set(payload.deviceId, count);

    if (count >= CONSECUTIVE_ZERO_FIX_THRESHOLD && !this.alreadyAlerted.has(payload.deviceId)) {
      this.alreadyAlerted.add(payload.deviceId);
      await this.raiseJammingAlert(payload.deviceId, count);
    }
  }

  private async raiseJammingAlert(deviceId: string, consecutiveCount: number) {
    const device = await this.devices.findOne({ where: { id: deviceId } });
    if (!device) return;

    this.logger.warn(`Possible GPS jamming on device ${deviceId}: ${consecutiveCount} consecutive zero-satellite reports`);

    await this.alertsService.raise({
      organizationId: device.organizationId,
      deviceId,
      vehicleId: device.vehicleId,
      type: AlertType.GPS_JAMMING,
      severity: AlertSeverity.HIGH,
      title: `Possible GPS jamming: ${device.name ?? device.imei} has reported zero satellites for ${consecutiveCount} consecutive fixes while still communicating`,
      metadata: { consecutiveZeroFixCount: consecutiveCount },
    });

    this.realtimeGateway.emit(device.organizationId, ServerEvents.GPS_JAMMING_DETECTED, {
      deviceId,
      vehicleId: device.vehicleId,
      consecutiveZeroFixCount: consecutiveCount,
    });
  }
}
