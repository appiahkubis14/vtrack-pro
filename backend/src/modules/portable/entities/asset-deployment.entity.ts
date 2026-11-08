import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum DeploymentStatus {
  ACTIVE = 'active',
  RETURNED = 'returned',
  OVERDUE = 'overdue',
  LOST = 'lost',
}

@Entity('asset_deployments')
export class AssetDeployment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'portable_asset_id' })
  portableAssetId: string;

  @Column({ name: 'deployment_purpose', nullable: true })
  deploymentPurpose?: string;

  @Column({ name: 'deployment_location', nullable: true })
  deploymentLocation?: string;

  @Column({ name: 'responsible_user_id', nullable: true })
  responsibleUserId?: string;

  /** Who actually clicked "deploy" - distinct from responsibleUserId (who's accountable for the asset day-to-day). Required for the self-approval check on covert deployments. */
  @Column({ name: 'requested_by', nullable: true })
  requestedBy?: string;

  @Column({ name: 'deployed_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  deployedAt: Date;

  @Column({ name: 'expected_return_date', type: 'timestamp', nullable: true })
  expectedReturnDate?: Date;

  @Column({ name: 'actual_return_date', type: 'timestamp', nullable: true })
  actualReturnDate?: Date;

  @Column({ name: 'return_condition', nullable: true })
  returnCondition?: 'good' | 'damaged' | 'lost' | 'not_returned';

  @Column({ name: 'deployment_notes', type: 'text', nullable: true })
  deploymentNotes?: string;

  @Column({ name: 'recovery_checklist', type: 'jsonb', nullable: true })
  recoveryChecklist?: Record<string, boolean>;

  @Column({ name: 'is_covert', default: false })
  isCovert: boolean;

  @Column({ name: 'covert_justification', type: 'text', nullable: true })
  covertJustification?: string;

  @Column({ name: 'covert_approved_by', nullable: true })
  covertApprovedBy?: string;

  @Column({ name: 'covert_approved_at', type: 'timestamp', nullable: true })
  covertApprovedAt?: Date;

  @Column({ type: 'varchar', length: 20, default: DeploymentStatus.ACTIVE })
  status: DeploymentStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
