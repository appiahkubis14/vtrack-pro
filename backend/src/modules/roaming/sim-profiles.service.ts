import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SimProfile } from './entities/sim-profile.entity';
import { SimAssignmentHistory } from './entities/sim-assignment-history.entity';
import { RoamingEvent } from './entities/roaming-event.entity';
import { Device } from '../devices/entities/device.entity';
import { AlertsService } from '../alerts/alerts.service';
import { AlertSeverity, AlertType } from '../../common/constants/alerts.constant';
import { RealtimeEventsGateway } from '../realtime/realtime-events.gateway';
import { ServerEvents } from '../../common/constants/websocket-events.constant';

const DATA_CAP_WARNING_THRESHOLD = 0.8; // warn at 80% of cap

@Injectable()
export class SimProfilesService {
  private readonly logger = new Logger(SimProfilesService.name);

  constructor(
    @InjectRepository(SimProfile) private readonly simProfiles: Repository<SimProfile>,
    @InjectRepository(SimAssignmentHistory) private readonly assignmentHistory: Repository<SimAssignmentHistory>,
    @InjectRepository(RoamingEvent) private readonly roamingEvents: Repository<RoamingEvent>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    private readonly alertsService: AlertsService,
    private readonly realtimeGateway: RealtimeEventsGateway,
  ) {}

  findAll(query: { organizationId?: string; status?: string } = {}) {
    return this.simProfiles.find({
      where: {
        ...(query.organizationId ? { organizationId: query.organizationId } : {}),
        ...(query.status ? { status: query.status as any } : {}),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string) {
    const sim = await this.simProfiles.findOne({ where: { id } });
    if (!sim) throw new NotFoundException(`SIM profile ${id} not found`);
    return sim;
  }

  async create(body: Partial<SimProfile> & { organizationId: string }) {
    const sim = await this.simProfiles.save(this.simProfiles.create({ ...body, activatedAt: new Date() }));
    if (sim.deviceId) {
      await this.assignmentHistory.save(this.assignmentHistory.create({ simProfileId: sim.id, deviceId: sim.deviceId }));
    }
    return sim;
  }

  async update(id: string, body: Partial<SimProfile>) {
    const existing = await this.findOne(id);

    if (body.deviceId && existing.deviceId && body.deviceId !== existing.deviceId) {
      await this.assignmentHistory.update(
        { simProfileId: id, deviceId: existing.deviceId },
        { unassignedAt: new Date(), unassignmentReason: 'manual_reassignment' },
      );
    }

    await this.simProfiles.update(id, body as any);
    return this.findOne(id);
  }

  /**
   * Called when a device's actual reported ICCID doesn't match its
   * last-known assigned SIM - a real SIM swap, potentially indicating theft
   * or unauthorized tampering (a stolen tracker being neutralized by
   * swapping its SIM is a known theft-recovery evasion tactic).
   */
  async detectSwapFromDevice(deviceId: string, reportedIccid: string): Promise<void> {
    const currentSim = await this.simProfiles.findOne({ where: { deviceId } });
    if (currentSim?.iccid === reportedIccid) return; // no change

    const device = await this.devices.findOne({ where: { id: deviceId } });
    if (!device) return;

    this.logger.warn(`SIM swap detected on device ${deviceId}: expected ${currentSim?.iccid ?? 'none'}, got ${reportedIccid}`);

    if (currentSim) {
      await this.simProfiles.update(currentSim.id, { status: 'swapped' });
      await this.assignmentHistory.update(
        { simProfileId: currentSim.id, deviceId },
        { unassignedAt: new Date(), unassignmentReason: 'sim_swap' },
      );
    }

    await this.alertsService.raise({
      organizationId: device.organizationId,
      deviceId,
      vehicleId: device.vehicleId,
      type: AlertType.SIM_SWAP,
      severity: AlertSeverity.CRITICAL,
      title: `SIM swap detected on ${device.name ?? device.imei}`,
      metadata: { previousIccid: currentSim?.iccid, newIccid: reportedIccid },
    });

    this.realtimeGateway.emit(device.organizationId, ServerEvents.SIM_SWAP_DETECTED, {
      deviceId,
      previousIccid: currentSim?.iccid,
      newIccid: reportedIccid,
    });
  }

  async recordDataUsage(simProfileId: string, additionalMb: number, detectedCountry?: string, provider?: string) {
    const sim = await this.findOne(simProfileId);
    const newTotal = Number(sim.dataUsedMb) + additionalMb;
    await this.simProfiles.update(simProfileId, { dataUsedMb: newTotal });

    if (!sim.dataCapMb) return;

    const usageFraction = newTotal / sim.dataCapMb;
    const device = sim.deviceId ? await this.devices.findOne({ where: { id: sim.deviceId } }) : null;
    if (!device) return;

    if (usageFraction >= 1) {
      await this.roamingEvents.save(
        this.roamingEvents.create({
          simProfileId,
          deviceId: sim.deviceId,
          eventType: 'data_cap_exceeded',
          detectedCountry,
          networkProvider: provider,
          dataUsedMb: newTotal,
          timestamp: new Date(),
        }),
      );
      await this.alertsService.raise({
        organizationId: device.organizationId,
        deviceId: sim.deviceId,
        vehicleId: device.vehicleId,
        type: AlertType.DEVICE_OFFLINE,
        severity: AlertSeverity.HIGH,
        title: `Data cap exceeded on ${device.name ?? device.imei}: ${newTotal.toFixed(0)}/${sim.dataCapMb}MB`,
      });
    } else if (usageFraction >= DATA_CAP_WARNING_THRESHOLD) {
      await this.roamingEvents.save(
        this.roamingEvents.create({
          simProfileId,
          deviceId: sim.deviceId,
          eventType: 'data_cap_warning',
          detectedCountry,
          networkProvider: provider,
          dataUsedMb: newTotal,
          timestamp: new Date(),
        }),
      );
    }
  }

  listRoamingEvents(query: { simProfileId?: string; deviceId?: string; limit?: number } = {}) {
    return this.roamingEvents.find({
      where: {
        ...(query.simProfileId ? { simProfileId: query.simProfileId } : {}),
        ...(query.deviceId ? { deviceId: query.deviceId } : {}),
      },
      order: { timestamp: 'DESC' },
      take: query.limit ?? 100,
    });
  }
}
