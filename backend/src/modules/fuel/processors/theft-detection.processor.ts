import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device } from '../../devices/entities/device.entity';
import { ParsedPosition } from '../../devices/processors/protocol.interface';
import { AlertsService } from '../../alerts/alerts.service';
import { AlertSeverity, AlertType } from '../../../common/constants/alerts.constant';

const RAPID_DROP_PERCENT = 10; // fuel-level percentage points
const RAPID_DROP_WINDOW_MS = 5 * 60 * 1000; // within 5 minutes
const REFUEL_JUMP_PERCENT = 8; // a sudden increase this large = refueling, not sensor noise

interface FuelState {
  level: number;
  at: number;
}

@Injectable()
export class TheftDetectionProcessor {
  private readonly logger = new Logger(TheftDetectionProcessor.name);
  private readonly lastLevelByDevice = new Map<string, FuelState>();

  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    private readonly alertsService: AlertsService,
  ) {}

  @OnEvent('position.created')
  async onPosition(payload: { deviceId: string; position: ParsedPosition }) {
    const { deviceId, position } = payload;
    if (position.fuelLevel === undefined) return;

    const previous = this.lastLevelByDevice.get(deviceId);
    this.lastLevelByDevice.set(deviceId, { level: position.fuelLevel, at: position.timestamp.getTime() });
    if (!previous) return;

    const delta = position.fuelLevel - previous.level;
    const dtMs = position.timestamp.getTime() - previous.at;

    if (delta >= REFUEL_JUMP_PERCENT) {
      await this.raise(deviceId, AlertType.REFUELING_DETECTED, AlertSeverity.LOW, position, delta);
      return;
    }

    if (-delta >= RAPID_DROP_PERCENT && dtMs <= RAPID_DROP_WINDOW_MS) {
      const isMoving = (position.speed ?? 0) > 2;
      await this.raise(
        deviceId,
        isMoving ? AlertType.RAPID_FUEL_DROP : AlertType.FUEL_THEFT,
        isMoving ? AlertSeverity.MEDIUM : AlertSeverity.CRITICAL,
        position,
        delta,
      );
    }
  }

  private async raise(
    deviceId: string,
    type: AlertType,
    severity: AlertSeverity,
    position: ParsedPosition,
    deltaPercent: number,
  ) {
    const device = await this.devices.findOne({ where: { id: deviceId } });
    if (!device) return;

    await this.alertsService.raise({
      organizationId: device.organizationId,
      deviceId,
      vehicleId: device.vehicleId,
      type,
      severity,
      title: `Fuel level changed by ${deltaPercent.toFixed(1)}% (${type})`,
      position: { latitude: position.latitude, longitude: position.longitude },
      metadata: { deltaPercent },
    });
  }
}
