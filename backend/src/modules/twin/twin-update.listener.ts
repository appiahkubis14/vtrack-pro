import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { Device } from '../devices/entities/device.entity';
import { ParsedPosition } from '../devices/processors/protocol.interface';
import { DeviceStatus } from '../../common/constants/alerts.constant';
import { DigitalTwinService } from './digital-twin.service';

@Injectable()
export class TwinUpdateListener {
  private readonly logger = new Logger(TwinUpdateListener.name);

  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    private readonly twin: DigitalTwinService,
  ) {}

  @OnEvent('position.created')
  async onPosition(payload: { deviceId: string; position: ParsedPosition; status: DeviceStatus }) {
    const device = await this.devices.findOne({ where: { id: payload.deviceId } });
    if (!device?.vehicleId) return;

    await this.twin.patch(device.vehicleId, device.organizationId, {
      position: {
        latitude: payload.position.latitude,
        longitude: payload.position.longitude,
        speed: payload.position.speed ?? 0,
        heading: payload.position.heading ?? 0,
        accuracy: payload.position.satellites, // proxy until a real HDOP/accuracy field lands here
      },
      status: payload.status.toLowerCase() as any,
      ignition: payload.position.ignition ?? false,
      fuelLevel: payload.position.fuelLevel,
      deviceHealth: {
        online: true,
        lastCommunicationAt: payload.position.timestamp.toISOString(),
        signalStrength: payload.position.gsmSignal,
        batteryLevel: payload.position.battery,
      },
    });
  }
}
