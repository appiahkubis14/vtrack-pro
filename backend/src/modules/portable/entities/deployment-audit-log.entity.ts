import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('deployment_audit_logs')
export class DeploymentAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'deployment_id', nullable: true })
  deploymentId?: string;

  @Column()
  action: string; // 'covert_requested'|'covert_approved'|'covert_denied'|'visibility_restricted'|'alert_redacted'

  @Column({ name: 'performed_by', nullable: true })
  performedBy?: string;

  @Column({ type: 'text', nullable: true })
  reason?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
