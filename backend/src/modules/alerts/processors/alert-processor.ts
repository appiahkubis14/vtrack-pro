import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { Device } from '../../devices/entities/device.entity';
import { ParsedPosition } from '../../devices/processors/protocol.interface';
import { AlertsService } from '../alerts.service';
import { AlertSeverity, AlertType, DeviceStatus } from '../../../common/constants/alerts.constant';

const DEFAULT_SPEED_LIMIT_KMH = 120;
const HARSH_BRAKING_KMH_PER_SEC = 8;

/**
 * Built-in checks that run on every ingested position, ahead of any
 * user-defined rules from the (not-yet-modeled) alert_rules table - see
 * AlertsService.createRule()/listRules() for that extension point.
 */
@Injectable()
export class AlertProcessor {
  private readonly logger = new Logger(AlertProcessor.name);
  private readonly lastSpeedByDevice = new Map<string, { speed: number; at: number }>();

  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    private readonly alertsService: AlertsService,
  ) {}

  @OnEvent('position.created')
  async onPosition(payload: { deviceId: string; position: ParsedPosition; status: DeviceStatus }) {
    const { deviceId, position } = payload;
    const device = await this.devices.findOne({ where: { id: deviceId } });
    if (!device) return;

    await this.checkSpeeding(device, position);
    await this.checkHarshBraking(device, position);
  }

  private async checkSpeeding(device: Device, position: ParsedPosition) {
    const limit = (device.config?.speedLimitKmh as number) ?? DEFAULT_SPEED_LIMIT_KMH;
    if ((position.speed ?? 0) <= limit) return;

    await this.alertsService.raise({
      organizationId: device.organizationId,
      deviceId: device.id,
      vehicleId: device.vehicleId,
      type: AlertType.SPEEDING,
      severity: AlertSeverity.HIGH,
      title: `Speeding: ${position.speed} km/h in a ${limit} km/h zone`,
      position: { latitude: position.latitude, longitude: position.longitude },
    });
  }

  private async checkHarshBraking(device: Device, position: ParsedPosition) {
    const previous = this.lastSpeedByDevice.get(device.id);
    this.lastSpeedByDevice.set(device.id, { speed: position.speed ?? 0, at: position.timestamp.getTime() });
    if (!previous) return;

    const dtSeconds = (position.timestamp.getTime() - previous.at) / 1000;
    if (dtSeconds <= 0 || dtSeconds > 15) return; // ignore gaps too large to be one continuous event

    const deceleration = (previous.speed - (position.speed ?? 0)) / dtSeconds;
    if (deceleration < HARSH_BRAKING_KMH_PER_SEC) return;

    await this.alertsService.raise({
      organizationId: device.organizationId,
      deviceId: device.id,
      vehicleId: device.vehicleId,
      type: AlertType.HARSH_BRAKING,
      severity: AlertSeverity.MEDIUM,
      title: `Harsh braking detected (${deceleration.toFixed(1)} km/h per second)`,
      position: { latitude: position.latitude, longitude: position.longitude },
    });
  }
}
