import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum AudioPolicyStatus {
  DISABLED = 'disabled',
  ENABLED_WITH_CONSENT = 'enabled_with_consent',
  ENABLED_FOR_SOS_ONLY = 'enabled_for_sos_only',
  ENABLED_FOR_SECURITY_INCIDENTS = 'enabled_for_security_incidents',
  COVERT_REQUIRES_APPROVAL = 'covert_requires_approval',
  PROHIBITED_BY_JURISDICTION = 'prohibited_by_jurisdiction',
}

@Entity('audio_policies')
export class AudioPolicy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  /** NULL = organization-wide default across every country it operates in. */
  @Column({ nullable: true })
  country?: string;

  @Column({ type: 'varchar', length: 30, default: AudioPolicyStatus.DISABLED })
  status: AudioPolicyStatus;

  @Column({ name: 'retention_days', default: 90 })
  retentionDays: number;

  @Column({ name: 'requires_passenger_notice', default: true })
  requiresPassengerNotice: boolean;

  @Column({ name: 'set_by', nullable: true })
  setBy?: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
