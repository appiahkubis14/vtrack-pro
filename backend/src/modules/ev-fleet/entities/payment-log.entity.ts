import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum PaymentStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
  TIMEOUT = 'timeout',
}

export enum PaymentProvider {
  MTN_MOMO = 'mtn_momo',
  TELECEL_CASH = 'telecel_cash', // Vodafone Cash rebranded to Telecel Cash following Telecel Group's Feb 2024 completion of the Vodafone Ghana rebrand
  AIRTELTIGO_MONEY = 'airteltigo_money',
}

@Entity('payment_logs')
export class PaymentLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'rider_id' })
  riderId: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'varchar', length: 20 })
  provider: PaymentProvider;

  @Column({ type: 'varchar', length: 20, default: PaymentStatus.PENDING })
  status: PaymentStatus;

  /** The aggregator's own transaction reference (Hubtel/Paystack) - needed to reconcile webhook callbacks against the request that triggered them. */
  @Column({ name: 'aggregator_reference', nullable: true, unique: true })
  aggregatorReference?: string;

  @Column({ name: 'failure_reason', nullable: true })
  failureReason?: string;

  @Column({ name: 'attempted_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  attemptedAt: Date;

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  resolvedAt?: Date;

  @Column({ name: 'work_and_pay_cycle_date', type: 'date' })
  workAndPayCycleDate: Date; // which day's 6pm debit this belongs to - allows querying "did rider X pay today" cleanly

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
