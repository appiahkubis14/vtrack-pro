import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export interface SafetyCheckResult {
  speedKmh: number;
  safeToImmobilize: boolean;
  reason: string;
}

@Entity('recovery_actions')
export class RecoveryAction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'theft_case_id' })
  theftCaseId: string;

  @Column({ name: 'action_type' })
  actionType: 'immobilize_request' | 'immobilize_execute' | 'high_freq_enable' | 'covert_recovery_enable';

  @Column({ name: 'requested_by', nullable: true })
  requestedBy?: string;

  @Column({ name: 'approved_by', nullable: true })
  approvedBy?: string;

  @Column({ default: 'pending' })
  status: 'pending' | 'approved' | 'denied' | 'executed' | 'failed';

  @Column({ name: 'safety_check_result', type: 'jsonb', nullable: true })
  safetyCheckResult?: SafetyCheckResult;

  @Column({ name: 'command_id', nullable: true })
  commandId?: string;

  @Column({ name: 'requested_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  requestedAt: Date;

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  resolvedAt?: Date;
}
