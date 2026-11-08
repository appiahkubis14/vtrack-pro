import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { Cron } from '@nestjs/schedule';
import { Rider } from '../entities/rider.entity';
import { PaymentLog, PaymentStatus } from '../entities/payment-log.entity';
import { ImmobilizerState, GracePeriodState } from '../entities/immobilizer-state.entity';
import { DigitalTwinService } from '../../twin/digital-twin.service';
import { ConfigService } from '@nestjs/config';
import { CommandsService } from '../../commands/commands.service';
import { Device } from '../../devices/entities/device.entity';
import { ChannelFactory } from '../../notifications/channels/channel.factory';
import { NotificationChannel } from '../../notifications/entities/notification.entity';
import { EnforcementService } from '../enforcement.service';
import { PaymentGatewayService } from './payment-gateway.service';

const SAFE_SPEED_THRESHOLD_KMH = 5; // stricter than the theft-recovery threshold - a "work and pay" immobilize is routine, not an emergency, so there's no reason to accept any wiggle room on "moving"
const WORK_AND_PAY_QUEUE = 'work-and-pay';

interface DebitCheckJobData {
  riderId: string;
}

interface SafetyRetryJobData {
  vehicleId: string;
}

@Injectable()
export class WorkAndPayScheduler {
  private readonly logger = new Logger(WorkAndPayScheduler.name);

  constructor(
    @InjectRepository(Rider) private readonly riders: Repository<Rider>,
    @InjectQueue(WORK_AND_PAY_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * Fires at 6pm daily (Africa/Accra). Fans out one job per rider rather
   * than processing the whole fleet in a single job - a stuck/slow payment
   * gateway call for one rider must never delay another rider's debit
   * attempt, and BullMQ's per-job retry/backoff only works cleanly at this
   * granularity.
   */
  @Cron('0 18 * * *', { timeZone: 'Africa/Accra' })
  async triggerDailyDebits() {
    const activeRiders = await this.riders.find({ where: { isActive: true } });
    this.logger.log(`Queuing Work & Pay debit checks for ${activeRiders.length} active riders`);

    for (const rider of activeRiders) {
      await this.queue.add(
        'debit-check',
        { riderId: rider.id } as DebitCheckJobData,
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 }, // network to a mobile money aggregator over Ghanaian mobile data needs generous retry spacing, not a tight loop
          removeOnComplete: true,
          removeOnFail: false, // keep failed debit jobs visible in the queue dashboard - a silently-vanished failed payment is a real financial/operational risk
        },
      );
    }
  }
}

@Injectable()
@Processor(WORK_AND_PAY_QUEUE)
export class WorkAndPayProcessor extends WorkerHost {
  private readonly logger = new Logger(WorkAndPayProcessor.name);

  constructor(
    @InjectRepository(Rider) private readonly riders: Repository<Rider>,
    @InjectRepository(PaymentLog) private readonly paymentLogs: Repository<PaymentLog>,
    @InjectRepository(ImmobilizerState) private readonly immobilizerStates: Repository<ImmobilizerState>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectQueue(WORK_AND_PAY_QUEUE) private readonly queue: Queue,
    private readonly twinService: DigitalTwinService,
    private readonly commandsService: CommandsService,
    private readonly channelFactory: ChannelFactory,
    private readonly paymentGateway: PaymentGatewayService,
    private readonly config: ConfigService,
    private readonly enforcement: EnforcementService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case 'debit-check':
        return this.processDebitCheck(job.data as DebitCheckJobData);
      case 'safety-retry-immobilize':
        return this.processSafetyRetry(job.data as SafetyRetryJobData);
      default:
        this.logger.warn(`Unknown job name in work-and-pay queue: ${job.name}`);
    }
  }

  private async processDebitCheck({ riderId }: DebitCheckJobData): Promise<void> {
    const rider = await this.riders.findOne({ where: { id: riderId } });
    if (!rider?.assignedVehicleId) return;

    const cycleDate = new Date().toISOString().slice(0, 10);

    // Idempotency: if today's cycle already has a successful payment logged
    // (e.g. this job is a BullMQ retry after a transient failure the
    // gateway actually processed on its end), don't double-charge the rider.
    const existing = await this.paymentLogs.findOne({
      where: { riderId, workAndPayCycleDate: cycleDate as any, status: PaymentStatus.SUCCESS },
    });
    if (existing) {
      this.logger.log(`Rider ${riderId} already paid for ${cycleDate} - skipping`);
      return;
    }

    const paymentLog = await this.paymentLogs.save(
      this.paymentLogs.create({
        riderId,
        organizationId: rider.organizationId,
        amount: rider.dailyTargetAmount,
        provider: 'mtn_momo' as any, // TODO: read the rider's actual registered provider once that field exists - hardcoded for the Phase 1 sandbox integration
        status: PaymentStatus.PENDING,
        workAndPayCycleDate: cycleDate as any,
      }),
    );

    let result: { success: boolean; reference?: string; failureReason?: string };
    try {
      result = await this.paymentGateway.requestDebit(rider.phone, Number(rider.dailyTargetAmount));
    } catch (err) {
      result = { success: false, failureReason: (err as Error).message };
    }

    if (result.success) {
      await this.paymentLogs.update(paymentLog.id, {
        status: PaymentStatus.SUCCESS,
        aggregatorReference: result.reference,
        resolvedAt: new Date(),
      });
      await this.clearGracePeriod(rider.assignedVehicleId);
      return;
    }

    await this.paymentLogs.update(paymentLog.id, {
      status: PaymentStatus.FAILED,
      failureReason: result.failureReason,
      resolvedAt: new Date(),
    });

    await this.startGracePeriod(rider, paymentLog.id);
  }

  private async startGracePeriod(rider: Rider, paymentLogId: string): Promise<void> {
    await this.enforcement.startGrace(rider.id, { source: 'payment_gateway', paymentLogId }, 'Daily debit failed');
  }

  private async clearGracePeriod(vehicleId: string): Promise<void> {
    const st = await this.immobilizerStates.findOne({ where: { vehicleId } });
    if (st && st.state !== GracePeriodState.NONE && st.triggerSource !== 'settlement') {
      const rider = await this.riders.findOne({ where: { id: st.riderId } });
      await this.enforcement.release(rider?.organizationId ?? '', vehicleId, 'Payment received', null, 'payment_gateway');
    }
  }

  /** The grace period ended. The enforcement service decides: exception, moving vehicle (retry), or lock. */
  private async processSafetyRetry({ vehicleId }: SafetyRetryJobData): Promise<void> {
    const res = await this.enforcement.onGraceExpired(vehicleId);
    this.logger.log(`Grace expiry for ${vehicleId}: ${JSON.stringify(res)}`);
  }
}
