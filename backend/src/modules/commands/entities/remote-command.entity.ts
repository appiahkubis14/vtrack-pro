import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { CommandStatus } from '../../../common/constants/alerts.constant';

export enum CommandPriority {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

@Entity('remote_commands')
export class RemoteCommand {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'device_id' })
  deviceId: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar', length: 50 })
  command: string;

  @Column({ type: 'jsonb', nullable: true })
  parameters?: Record<string, unknown>;

  @Column({ type: 'varchar', length: 20, default: CommandPriority.MEDIUM })
  priority: CommandPriority;

  @Column({ type: 'varchar', length: 20, default: CommandStatus.CREATED })
  status: CommandStatus;

  @Column({ type: 'jsonb', nullable: true })
  response?: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  error?: string;

  @Column({ name: 'scheduled_for', type: 'timestamp', nullable: true })
  scheduledFor?: Date;

  @Column({ name: 'sent_at', type: 'timestamp', nullable: true })
  sentAt?: Date;

  @Column({ name: 'delivered_at', type: 'timestamp', nullable: true })
  deliveredAt?: Date;

  @Column({ name: 'executed_at', type: 'timestamp', nullable: true })
  executedAt?: Date;

  @Column({ name: 'response_time', nullable: true })
  responseTime?: number;

  @Column({ name: 'retry_count', default: 0 })
  retryCount: number;

  @Column({ name: 'max_retries', default: 3 })
  maxRetries: number;

  @Column({ name: 'approved_by', nullable: true })
  approvedBy?: string;

  @Column({ name: 'approved_at', type: 'timestamp', nullable: true })
  approvedAt?: Date;

  @Column({ name: 'requires_approval', default: false })
  requiresApproval: boolean;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt?: Date;

  @Column({ name: 'cancelled_at', type: 'timestamp', nullable: true })
  cancelledAt?: Date;

  @Column({ name: 'cancelled_by', nullable: true })
  cancelledBy?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
