import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { Trip } from '../entities/trip.entity';
import { Device } from '../../devices/entities/device.entity';
import { ParsedPosition } from '../../devices/processors/protocol.interface';

const STOP_DWELL_MS = 3 * 60 * 1000; // ignition off / stationary for 3 min ends a trip

interface OpenTrip {
  tripId: string;
  startedAt: Date;
  lastMovementAt: Date;
}

/**
 * Ignition+movement based trip segmentation. A trip starts on the first
 * moving fix after ignition-on, and closes after STOP_DWELL_MS of no
 * movement / ignition-off. Distance/duration/fuel rollups happen in
 * trip-analyzer.processor.ts once a trip closes (listen for 'trip.ended').
 */
@Injectable()
export class TripDetectionProcessor {
  private readonly logger = new Logger(TripDetectionProcessor.name);
  private readonly openTrips = new Map<string, OpenTrip>();

  constructor(
    @InjectRepository(Trip) private readonly trips: Repository<Trip>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
  ) {}

  @OnEvent('position.created')
  async onPosition(payload: { deviceId: string; position: ParsedPosition }) {
    const { deviceId, position } = payload;
    const isMoving = (position.speed ?? 0) > 3;
    const open = this.openTrips.get(deviceId);

    if (isMoving && !open) {
      await this.startTrip(deviceId, position);
    } else if (isMoving && open) {
      open.lastMovementAt = position.timestamp;
    } else if (!isMoving && open) {
      const idleMs = position.timestamp.getTime() - open.lastMovementAt.getTime();
      if (idleMs >= STOP_DWELL_MS) {
        await this.endTrip(deviceId, position);
      }
    }
  }

  private async startTrip(deviceId: string, position: ParsedPosition) {
    const device = await this.devices.findOne({ where: { id: deviceId } });
    if (!device?.vehicleId) return;

    const trip = await this.trips.save(
      this.trips.create({
        deviceId,
        vehicleId: device.vehicleId,
        startTime: position.timestamp,
        startLocation: { latitude: position.latitude, longitude: position.longitude },
      }),
    );
    this.openTrips.set(deviceId, { tripId: trip.id, startedAt: position.timestamp, lastMovementAt: position.timestamp });
  }

  private async endTrip(deviceId: string, position: ParsedPosition) {
    const open = this.openTrips.get(deviceId);
    if (!open) return;
    this.openTrips.delete(deviceId);

    await this.trips.update(open.tripId, {
      endTime: position.timestamp,
      endLocation: { latitude: position.latitude, longitude: position.longitude },
    });
    // trip-analyzer.processor.ts (listening for the same close condition, or
    // triggered via POST /trips/analyze) fills in distance/avgSpeed/fuel/score.
  }
}
