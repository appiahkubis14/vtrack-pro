import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BatteryTelemetry } from '../entities/battery-telemetry.entity';
import { PortableAsset } from '../entities/portable-asset.entity';
import { Device } from '../../devices/entities/device.entity';
import { AlertsService } from '../../alerts/alerts.service';
import { AlertSeverity, AlertType } from '../../../common/constants/alerts.constant';

const LOW_BATTERY_THRESHOLD = 20;
const CRITICAL_BATTERY_THRESHOLD = 5;
// A drop faster than this within the lookback window is "unexpected" for a
// battery-powered tracker sitting in a low-power profile - real drain from
// normal reporting is much slower. Doesn't apply to 'continuous' profile
// devices, which legitimately burn faster.
const UNEXPECTED_DRAIN_PERCENT_PER_HOUR = 5;

const RATED_DAYS_AT_100_PERCENT: Record<string, number> = {
  continuous: 1.5,
  interval_10s: 4,
  interval_30s: 10,
  interval_1m: 20,
  interval_5m: 45,
  interval_15m: 90,
  heartbeat_1h: 180,
  heartbeat_6h: 365,
  heartbeat_24h: 720,
  motion_triggered: 200,
  geofence_triggered: 250,
  sos_only: 400,
  deep_sleep: 600,
};

@Injectable()
export class BatteryIntelligenceEngine {
  private readonly logger = new Logger(BatteryIntelligenceEngine.name);
  private readonly lastAlertLevel = new Map<string, 'none' | 'low' | 'critical'>();

  constructor(
    @InjectRepository(BatteryTelemetry) private readonly telemetry: Repository<BatteryTelemetry>,
    @InjectRepository(PortableAsset) private readonly assets: Repository<PortableAsset>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    private readonly alertsService: AlertsService,
  ) {}

  /**
   * Called whenever a device reports battery telemetry (wired from the GPS
   * ingestion pipeline's ParsedPosition.battery field, or a dedicated
   * battery-report packet for devices that send them separately).
   */
  async recordAndCheck(deviceId: string, batteryPercent: number, voltage?: number, isCharging = false): Promise<void> {
    const asset = await this.assets.findOne({ where: { deviceId } });
    const now = new Date();

    const recent = await this.telemetry.find({ where: { deviceId }, order: { timestamp: 'DESC' }, take: 1 });
    const previous = recent[0];

    const estimatedDays = this.estimateRemainingDays(batteryPercent, asset?.currentPowerProfile);

    await this.telemetry.save(
      this.telemetry.create({
        deviceId,
        batteryPercent,
        batteryVoltage: voltage,
        isCharging,
        estimatedDaysRemaining: estimatedDays,
        powerProfile: asset?.currentPowerProfile,
        timestamp: now,
      }),
    );

    if (isCharging) {
      this.lastAlertLevel.set(deviceId, 'none'); // charging clears any pending low/critical state
      return;
    }

    await this.checkThresholds(deviceId, batteryPercent, asset);
    if (previous) {
      await this.checkUnexpectedDrain(deviceId, asset, Number(previous.batteryPercent), previous.timestamp, batteryPercent, now);
    }
  }

  private async checkThresholds(deviceId: string, batteryPercent: number, asset: PortableAsset | null) {
    const lastLevel = this.lastAlertLevel.get(deviceId) ?? 'none';
    const device = await this.devices.findOne({ where: { id: deviceId } });
    if (!device) return;

    if (batteryPercent <= CRITICAL_BATTERY_THRESHOLD && lastLevel !== 'critical') {
      this.lastAlertLevel.set(deviceId, 'critical');
      await this.alertsService.raise({
        organizationId: device.organizationId,
        deviceId,
        vehicleId: device.vehicleId,
        type: AlertType.LOW_BATTERY,
        severity: AlertSeverity.CRITICAL,
        title: `Critical battery: ${asset?.assetName ?? device.name ?? device.imei} at ${batteryPercent}%`,
      });
    } else if (batteryPercent <= LOW_BATTERY_THRESHOLD && lastLevel === 'none') {
      this.lastAlertLevel.set(deviceId, 'low');
      await this.alertsService.raise({
        organizationId: device.organizationId,
        deviceId,
        vehicleId: device.vehicleId,
        type: AlertType.LOW_BATTERY,
        severity: AlertSeverity.MEDIUM,
        title: `Low battery: ${asset?.assetName ?? device.name ?? device.imei} at ${batteryPercent}%`,
      });
    } else if (batteryPercent > LOW_BATTERY_THRESHOLD) {
      this.lastAlertLevel.set(deviceId, 'none');
    }
  }

  private async checkUnexpectedDrain(
    deviceId: string,
    asset: PortableAsset | null,
    previousPercent: number,
    previousTime: Date,
    currentPercent: number,
    currentTime: Date,
  ) {
    if (asset?.currentPowerProfile === 'continuous') return; // fast drain is expected on this profile

    const hoursDelta = (currentTime.getTime() - previousTime.getTime()) / 3_600_000;
    if (hoursDelta <= 0) return;

    const dropPercent = previousPercent - currentPercent;
    const dropRatePerHour = dropPercent / hoursDelta;

    if (dropRatePerHour >= UNEXPECTED_DRAIN_PERCENT_PER_HOUR) {
      const device = await this.devices.findOne({ where: { id: deviceId } });
      if (!device) return;
      this.logger.warn(
        `Unexpected battery drain on device ${deviceId}: ${dropRatePerHour.toFixed(1)}%/hr on profile "${asset?.currentPowerProfile}"`,
      );
      await this.alertsService.raise({
        organizationId: device.organizationId,
        deviceId,
        vehicleId: device.vehicleId,
        type: AlertType.LOW_BATTERY,
        severity: AlertSeverity.HIGH,
        title: `Unexpected battery drain on ${asset?.assetName ?? device.imei}: ${dropRatePerHour.toFixed(1)}%/hour (unusual for "${asset?.currentPowerProfile}" profile)`,
      });
    }
  }

  /** Rough linear estimate against the profile's rated runway at 100% - a real device would report a firmware estimate instead. */
  private estimateRemainingDays(batteryPercent: number, powerProfile?: string): number | undefined {
    if (!powerProfile || !(powerProfile in RATED_DAYS_AT_100_PERCENT)) return undefined;
    return Math.round((RATED_DAYS_AT_100_PERCENT[powerProfile] * batteryPercent) / 100 * 10) / 10;
  }
}
