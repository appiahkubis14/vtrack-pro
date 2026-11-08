import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Between, Repository } from 'typeorm';
import { Position } from '../devices/entities/position.entity';
import { Device } from '../devices/entities/device.entity';
import { DevicesGateway } from '../devices/gateways/devices.gateway';
import { DeviceTcpService } from '../devices/tcp/device-tcp.service';
import { PositionProcessor, PreviousPositionState } from './processors/position.processor';
import { ParsedPosition } from '../devices/processors/protocol.interface';
import { DeviceStatus } from '../../common/constants/alerts.constant';

@Injectable()
export class PositionsService implements OnModuleInit {
  private readonly logger = new Logger(PositionsService.name);

  /** In-memory last-known state per device, used only for the IDLE/MOVING/PARKED heuristic.
   *  Fine for a single instance; move to Redis (keyed by deviceId) before scaling horizontally. */
  private readonly lastState = new Map<string, PreviousPositionState>();

  constructor(
    @InjectRepository(Position, 'timescale') private readonly positions: Repository<Position>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    private readonly gateway: DevicesGateway,
    private readonly tcpService: DeviceTcpService,
    private readonly processor: PositionProcessor,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit() {
    // Bridges the raw TCP layer (which only knows a device's IMEI) to
    // ingestion (which keys everything off the device's internal UUID).
    this.tcpService.onFix = (imei, parsed) => {
      this.ingestFromImei(imei, parsed).catch((err) =>
        this.logger.warn(`Failed to ingest fix for IMEI ${imei}: ${err.message}`),
      );
    };
  }

  async ingestFromImei(imei: string, parsed: ParsedPosition): Promise<Position | null> {
    const device = await this.devices.findOne({ where: { imei } });
    if (!device) {
      this.logger.warn(`Dropped position from unregistered IMEI ${imei}`);
      return null;
    }
    return this.ingest(device.id, parsed);
  }

  /**
   * Entry point for every parsed GPS fix, regardless of which protocol/port it
   * arrived on. Persists the fix, updates the device's live status, broadcasts
   * to subscribed dashboards, and emits `position.created` so the geofence
   * checker, trip detector, fuel processor, and alert engine can react without
   * this service knowing about any of them.
   */
  async ingest(deviceId: string, parsed: ParsedPosition): Promise<Position> {
    const previous = this.lastState.get(deviceId);
    const status = this.processor.classify(parsed, previous);

    this.lastState.set(deviceId, {
      speed: parsed.speed,
      ignition: parsed.ignition,
      timestamp: parsed.timestamp,
      stoppedSinceMs:
        status === DeviceStatus.PARKED || status === DeviceStatus.IDLE
          ? (previous?.stoppedSinceMs ?? 0) + (parsed.timestamp.getTime() - (previous?.timestamp.getTime() ?? parsed.timestamp.getTime()))
          : 0,
    });

    const saved = await this.positions.save(
      this.positions.create({
        deviceId,
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        altitude: parsed.altitude,
        speed: parsed.speed,
        heading: parsed.heading,
        ignition: parsed.ignition ?? false,
        fuelLevel: parsed.fuelLevel,
        satellites: parsed.satellites,
        eventType: parsed.eventType,
        obdData: parsed.obd,
        sensors: parsed.sensors,
        timestamp: parsed.timestamp,
      }),
    );

    await this.devices.update(deviceId, {
      status,
      lastPositionId: saved.id,
      lastCommunicationAt: parsed.timestamp,
      ...(parsed.battery !== undefined ? { batteryLevel: parsed.battery } : {}),
      ...(parsed.gsmSignal !== undefined ? { signalStrength: parsed.gsmSignal } : {}),
    });

    this.gateway.broadcastPosition(deviceId, parsed);
    this.gateway.broadcastDeviceStatus(deviceId, status);
    this.events.emit('position.created', { deviceId, position: saved, status });

    return saved;
  }

  findAll(query: { deviceId?: string; limit?: number } = {}) {
    return this.positions.find({
      where: query.deviceId ? { deviceId: query.deviceId } : {},
      order: { timestamp: 'DESC' },
      take: query.limit ?? 100,
    });
  }

  findOne(id: string) {
    return this.positions.findOne({ where: { id } });
  }

  async latest(deviceId?: string) {
    if (deviceId) {
      return this.positions.findOne({ where: { deviceId }, order: { timestamp: 'DESC' } });
    }
    // Latest position per device - for the live fleet map. Raw query since
    // TypeORM's query builder for "distinct on" is awkward across drivers.
    return this.positions.query(
      `SELECT DISTINCT ON (device_id) * FROM positions ORDER BY device_id, timestamp DESC`,
    );
  }

  history(deviceId: string, from: Date, to: Date) {
    return this.positions.find({
      where: { deviceId, timestamp: Between(from, to) },
      order: { timestamp: 'ASC' },
    });
  }

  async exportHistory(deviceId: string, from: Date, to: Date) {
    const rows = await this.history(deviceId, from, to);
    // TODO: pipe through reports/generators/excel.generator.ts or csv writer.
    return { format: 'json', count: rows.length, rows };
  }
}
