import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EvState } from './entities/ev-state.entity';
import { ChargingSession, ChargingSessionStatus } from './entities/charging-session.entity';
import { ChargeSchedule } from './entities/charge-schedule.entity';
import { EnergyConsumptionStat } from './entities/energy-consumption-stat.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { SmartChargingScheduler } from './engines/smart-charging.scheduler';
import { EnergyMetricsEngine } from './engines/energy-metrics.engine';
import { CreateChargeScheduleDto } from './dto/create-charge-schedule.dto';
import { StartChargingSessionDto } from './dto/start-charging-session.dto';
import { DigitalTwinGateway } from '../twin/digital-twin.gateway';

const DEFAULT_CHARGER_POWER_KW = 7.2; // typical level-2 AC home charger

@Injectable()
export class EnergyService {
  constructor(
    @InjectRepository(EvState) private readonly evStates: Repository<EvState>,
    @InjectRepository(ChargingSession) private readonly sessions: Repository<ChargingSession>,
    @InjectRepository(ChargeSchedule) private readonly schedules: Repository<ChargeSchedule>,
    @InjectRepository(EnergyConsumptionStat) private readonly stats: Repository<EnergyConsumptionStat>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    private readonly scheduler: SmartChargingScheduler,
    private readonly metrics: EnergyMetricsEngine,
    private readonly twinGateway: DigitalTwinGateway,
  ) {}

  async getEvState(vehicleId: string): Promise<EvState> {
    const state = await this.evStates.findOne({ where: { vehicleId }, order: { timestamp: 'DESC' } });
    if (!state) throw new NotFoundException(`No EV state recorded for vehicle ${vehicleId}`);
    return state;
  }

  recordEvState(vehicleId: string, deviceId: string | undefined, data: Partial<EvState>): Promise<EvState> {
    return this.evStates.save(
      this.evStates.create({ vehicleId, deviceId, timestamp: new Date(), ...data }),
    );
  }

  listChargingSessions(vehicleId: string, limit = 50) {
    return this.sessions.find({ where: { vehicleId }, order: { startTime: 'DESC' }, take: limit });
  }

  async startChargingSession(vehicleId: string, organizationId: string, dto: StartChargingSessionDto) {
    const session = await this.sessions.save(
      this.sessions.create({
        organizationId,
        vehicleId,
        deviceId: dto.deviceId,
        startTime: new Date(),
        startSoc: dto.startSoc,
        chargingType: dto.chargingType,
        chargerLocation: dto.chargerLocation,
        status: ChargingSessionStatus.CHARGING,
      }),
    );
    this.twinGateway.server?.to(`org:${organizationId}`).emit('chargingSessionStarted', session);
    return session;
  }

  async endChargingSession(
    sessionId: string,
    data: { endSoc?: number; energyAddedKwh?: number; cost?: number; status?: ChargingSessionStatus },
  ) {
    const session = await this.sessions.findOne({ where: { id: sessionId } });
    if (!session) throw new NotFoundException(`Charging session ${sessionId} not found`);

    await this.sessions.update(sessionId, {
      endTime: new Date(),
      endSoc: data.endSoc,
      energyAddedKwh: data.energyAddedKwh,
      cost: data.cost,
      status: data.status ?? ChargingSessionStatus.COMPLETED,
    });

    const updated = await this.sessions.findOneOrFail({ where: { id: sessionId } });
    this.twinGateway.server?.to(`org:${session.organizationId}`).emit('chargingSessionEnded', updated);
    return updated;
  }

  async createChargeSchedule(vehicleId: string, organizationId: string, dto: CreateChargeScheduleDto) {
    const vehicle = await this.vehicles.findOneOrFail({ where: { id: vehicleId } });
    const currentState = await this.evStates
      .findOne({ where: { vehicleId }, order: { timestamp: 'DESC' } })
      .catch(() => null);

    const plan = this.scheduler.plan({
      currentSoc: currentState?.soc ?? 50,
      targetSoc: dto.targetSoc,
      departureTime: new Date(dto.departureTime),
      batteryCapacityKwh: dto.batteryCapacityKwh ?? Number(vehicle.tankCapacity ?? 60), // tankCapacity doubles as battery kWh for EVs in this schema
      chargerPowerKw: dto.chargerPowerKw ?? DEFAULT_CHARGER_POWER_KW,
      electricityPriceSchedule: dto.electricityPriceSchedule ?? [],
    });

    return this.schedules.save(
      this.schedules.create({
        organizationId,
        vehicleId,
        targetSoc: dto.targetSoc,
        departureTime: new Date(dto.departureTime),
        recommendedStartTime: plan.recommendedStartTime,
        recommendedEndTime: plan.recommendedEndTime,
        estimatedCost: plan.estimatedCost,
        estimatedSohImpact: plan.estimatedSohImpactPct,
        recommendedChargeLimitPct: plan.recommendedChargeLimitPct,
        electricityPriceSchedule: dto.electricityPriceSchedule,
        status: 'planned',
      }),
    );
  }

  async energyReport(vehicleId: string) {
    const [sessions, latestStat] = await Promise.all([
      this.sessions.find({ where: { vehicleId }, order: { startTime: 'DESC' }, take: 30 }),
      this.stats.findOne({ where: { vehicleId }, order: { periodStart: 'DESC' } }),
    ]);

    const totalEnergyKwh = sessions.reduce((sum, s) => sum + Number(s.energyAddedKwh ?? 0), 0);
    const totalCost = sessions.reduce((sum, s) => sum + Number(s.cost ?? 0), 0);

    return {
      vehicleId,
      last30SessionsEnergyKwh: totalEnergyKwh,
      last30SessionsCost: totalCost,
      latestPeriodStats: latestStat ?? null,
    };
  }

  async batteryHealth(organizationId?: string) {
    const qb = this.evStates
      .createQueryBuilder('e')
      .select('e.vehicle_id', 'vehicleId')
      .addSelect('MAX(e.soh)', 'soh')
      .addSelect('MAX(e.timestamp)', 'lastReportedAt')
      .groupBy('e.vehicle_id');

    if (organizationId) {
      qb.innerJoin('vehicles', 'v', 'v.id = e.vehicle_id').andWhere('v.organization_id = :organizationId', {
        organizationId,
      });
    }

    return qb.getRawMany();
  }
}
