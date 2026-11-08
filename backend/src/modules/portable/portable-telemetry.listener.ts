import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BatteryIntelligenceEngine } from './engines/battery-intelligence.engine';
import { WakeSleepEngine } from './engines/wake-sleep.engine';
import { PortableAsset } from './entities/portable-asset.entity';
import { Device } from '../devices/entities/device.entity';
import { ParsedPosition } from '../devices/processors/protocol.interface';
import { RealtimeEventsGateway } from '../realtime/realtime-events.gateway';
import { ServerEvents } from '../../common/constants/websocket-events.constant';

@Injectable()
export class PortableTelemetryListener {
  constructor(
    private readonly batteryEngine: BatteryIntelligenceEngine,
    private readonly wakeSleepEngine: WakeSleepEngine,
    @InjectRepository(PortableAsset) private readonly assets: Repository<PortableAsset>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    private readonly realtimeGateway: RealtimeEventsGateway,
  ) {}

  @OnEvent('position.created')
  async onPosition(payload: { deviceId: string; position: ParsedPosition }) {
    await this.wakeSleepEngine.onPosition(payload.deviceId, payload.position.timestamp);

    if (payload.position.battery === undefined) return;
    await this.batteryEngine.recordAndCheck(payload.deviceId, payload.position.battery);

    const asset = await this.assets.findOne({ where: { deviceId: payload.deviceId } });
    const device = await this.devices.findOne({ where: { id: payload.deviceId } });
    if (asset && device) {
      this.realtimeGateway.emit(device.organizationId, ServerEvents.PORTABLE_BATTERY_UPDATE, {
        deviceId: payload.deviceId,
        assetId: asset.id,
        batteryPercent: payload.position.battery,
      });
    }
  }
}
