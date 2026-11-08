import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum QuoteStatus {
  DRAFT = 'draft',
  PENDING_APPROVAL = 'pending_approval',
  SENT = 'sent',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
  CONVERTED_TO_ORDER = 'converted_to_order',
}

@Entity('quotes')
export class Quote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'quote_number', unique: true })
  quoteNumber: string;

  @Column({ name: 'lead_id', nullable: true })
  leadId?: string;

  @Column({ name: 'customer_id', nullable: true })
  customerId?: string;

  @Column({ name: 'organization_id', nullable: true })
  organizationId?: string;

  @Column({ name: 'created_by', nullable: true })
  createdBy?: string;

  @Column()
  currency: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  subtotal: number;

  @Column({ name: 'discount_total', type: 'decimal', precision: 12, scale: 2, default: 0 })
  discountTotal: number;

  @Column({ name: 'tax_total', type: 'decimal', precision: 12, scale: 2, default: 0 })
  taxTotal: number;

  @Column({ name: 'grand_total', type: 'decimal', precision: 12, scale: 2, default: 0 })
  grandTotal: number;

  @Column({ name: 'validity_days', default: 30 })
  validityDays: number;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt?: Date;

  @Column({ name: 'terms_and_conditions', type: 'text', nullable: true })
  termsAndConditions?: string;

  @Column({ name: 'payment_schedule', type: 'text', nullable: true })
  paymentSchedule?: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ type: 'varchar', length: 20, default: QuoteStatus.DRAFT })
  status: QuoteStatus;

  @Column({ name: 'approved_by', nullable: true })
  approvedBy?: string;

  @Column({ name: 'approved_at', type: 'timestamp', nullable: true })
  approvedAt?: Date;

  @Column({ name: 'sent_at', type: 'timestamp', nullable: true })
  sentAt?: Date;

  @Column({ name: 'accepted_at', type: 'timestamp', nullable: true })
  acceptedAt?: Date;

  @Column({ name: 'rejected_at', type: 'timestamp', nullable: true })
  rejectedAt?: Date;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason?: string;

  @Column({ name: 'pdf_url', nullable: true })
  pdfUrl?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
