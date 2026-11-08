import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { WakeEvent } from '../entities/wake-event.entity';
import { DeviceSleepEvent } from '../entities/device-sleep-event.entity';
import { PortableAsset } from '../entities/portable-asset.entity';
import { Device } from '../../devices/entities/device.entity';
import { RealtimeEventsGateway } from '../../realtime/realtime-events.gateway';
import { ServerEvents } from '../../../common/constants/websocket-events.constant';

const PROFILE_INTERVAL_SECONDS: Record<string, number> = {
  continuous: 1,
  interval_10s: 10,
  interval_30s: 30,
  interval_1m: 60,
  interval_5m: 300,
  interval_15m: 900,
  heartbeat_1h: 3600,
  heartbeat_6h: 21600,
  heartbeat_24h: 86400,
};

// Report-gap engines (motion_triggered, geofence_triggered, sos_only,
// deep_sleep) have no fixed expected interval, so wake/sleep inference only
// applies to the timer-driven profiles above.
const INFERRED_WAKE_GAP_MULTIPLIER = 2;
const INFERRED_SLEEP_GAP_MULTIPLIER = 3;

@Injectable()
export class WakeSleepEngine {
  private readonly logger = new Logger(WakeSleepEngine.name);
  private readonly lastPositionAt = new Map<string, Date>();

  constructor(
    @InjectRepository(WakeEvent) private readonly wakeEvents: Repository<WakeEvent>,
    @InjectRepository(DeviceSleepEvent) private readonly sleepEvents: Repository<DeviceSleepEvent>,
    @InjectRepository(PortableAsset) private readonly assets: Repository<PortableAsset>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    private readonly realtimeGateway: RealtimeEventsGateway,
  ) {}

  /** Called on every position for a device - infers a wake event if the gap since the last one exceeds the profile's expected interval. */
  async onPosition(deviceId: string, timestamp: Date): Promise<void> {
    const asset = await this.assets.findOne({ where: { deviceId } });
    if (!asset) return;

    const expectedInterval = PROFILE_INTERVAL_SECONDS[asset.currentPowerProfile];
    const lastSeen = this.lastPositionAt.get(deviceId);
    this.lastPositionAt.set(deviceId, timestamp);

    if (!expectedInterval || !lastSeen) return;

    const gapSeconds = (timestamp.getTime() - lastSeen.getTime()) / 1000;
    if (gapSeconds > expectedInterval * INFERRED_WAKE_GAP_MULTIPLIER) {
      const device = await this.devices.findOne({ where: { id: deviceId } });
      if (!device) return;

      await this.wakeEvents.save(
        this.wakeEvents.create({
          deviceId,
          triggerType: 'scheduled',
          triggerMetadata: { inferredFromGapSeconds: Math.round(gapSeconds), powerProfile: asset.currentPowerProfile },
          timestamp,
        }),
      );

      this.realtimeGateway.emit(device.organizationId, ServerEvents.PORTABLE_DEVICE_WOKE, {
        deviceId,
        assetId: asset.id,
        gapSeconds: Math.round(gapSeconds),
      });
    }
  }

  /** Scheduled sweep: flags any portable asset's device gone silent longer than its profile would predict as now presumed asleep. */
  async sweepForSleepingDevices(): Promise<void> {
    const assets = await this.assets.find({ where: {} });

    for (const asset of assets) {
      if (!asset.deviceId) continue;
      const expectedInterval = PROFILE_INTERVAL_SECONDS[asset.currentPowerProfile];
      if (!expectedInterval) continue;

      const device = await this.devices.findOne({ where: { id: asset.deviceId } });
      if (!device?.lastCommunicationAt) continue;

      const silenceSeconds = (Date.now() - device.lastCommunicationAt.getTime()) / 1000;
      if (silenceSeconds < expectedInterval * INFERRED_SLEEP_GAP_MULTIPLIER) continue;

      const alreadyLogged = await this.sleepEvents.findOne({
        where: { deviceId: asset.deviceId, timestamp: LessThan(device.lastCommunicationAt) },
      });
      if (alreadyLogged) continue;

      await this.sleepEvents.save(
        this.sleepEvents.create({
          deviceId: asset.deviceId,
          reason: 'scheduled',
          powerProfileAtSleep: asset.currentPowerProfile,
          timestamp: new Date(),
        }),
      );

      this.realtimeGateway.emit(device.organizationId, ServerEvents.PORTABLE_DEVICE_SLEEPING, {
        deviceId: asset.deviceId,
        assetId: asset.id,
        silenceSeconds: Math.round(silenceSeconds),
      });
    }
  }
}
