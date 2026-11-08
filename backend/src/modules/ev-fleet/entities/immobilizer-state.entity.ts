import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum GracePeriodState {
  NONE = 'none',                     // paid up, no action pending
  PAYMENT_FAILED = 'payment_failed', // debit failed, grace period clock started
  WARNING_SENT = 'warning_sent',     // SMS/WhatsApp warning dispatched
  IMMOBILIZE_QUEUED = 'immobilize_queued', // grace expired, waiting for a safe (stationary) moment to send the command
  IMMOBILIZED = 'immobilized',
}

/**
 * One row per vehicle - the current state of the Work & Pay safety machine.
 * Deliberately separate from the existing `theft_cases`/`recovery_actions`
 * tables even though the underlying immobilize command plumbing is shared -
 * this is a routine commercial state machine, not a security incident, and
 * conflating the two would make theft-recovery reporting noisy with
 * everyday non-payment events.
 */
@Entity('immobilizer_state')
export class ImmobilizerState {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'vehicle_id', unique: true })
  vehicleId: string;

  @Column({ name: 'rider_id' })
  riderId: string;

  @Column({ type: 'varchar', length: 20, default: GracePeriodState.NONE })
  state: GracePeriodState;

  @Column({ name: 'payment_log_id', nullable: true })
  paymentLogId?: string; // the failed payment that started this cycle, if any

  @Column({ name: 'grace_period_started_at', type: 'timestamp', nullable: true })
  gracePeriodStartedAt?: Date;

  @Column({ name: 'grace_period_hours', default: 12 })
  gracePeriodHours: number;

  @Column({ name: 'warning_sent_at', type: 'timestamp', nullable: true })
  warningSentAt?: Date;

  @Column({ name: 'last_safety_check_speed_kmh', type: 'decimal', precision: 6, scale: 2, nullable: true })
  lastSafetyCheckSpeedKmh?: number;

  @Column({ name: 'immobilized_at', type: 'timestamp', nullable: true })
  immobilizedAt?: Date;

  @Column({ name: 'command_id', nullable: true })
  commandId?: string; // FK to the existing remote_commands table once dispatched

  @Column({ name: 'unlocked_at', type: 'timestamp', nullable: true }) unlockedAt?: Date | null;
  @Column({ name: 'unlock_reason', type: 'text', nullable: true }) unlockReason?: string | null;
  @Column({ name: 'unlocked_by', type: 'uuid', nullable: true }) unlockedBy?: string | null;
  @Column({ name: 'trigger_source', type: 'varchar', nullable: true }) triggerSource?: string | null;
  @Column({ name: 'settlement_id', type: 'uuid', nullable: true }) settlementId?: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
