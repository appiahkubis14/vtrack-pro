import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audio_consents')
export class AudioConsent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'driver_id', nullable: true })
  driverId?: string;

  @Column({ name: 'vehicle_id', nullable: true })
  vehicleId?: string;

  @Column({ name: 'consent_type', default: 'driver' })
  consentType: 'driver' | 'passenger_notice_acknowledged';

  @Column({ name: 'legal_basis', nullable: true })
  legalBasis?: string;

  @Column({ name: 'granted_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  grantedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt?: Date;

  @Column({ name: 'withdrawn_at', type: 'timestamp', nullable: true })
  withdrawnAt?: Date;

  @Column({ name: 'withdrawal_reason', type: 'text', nullable: true })
  withdrawalReason?: string;

  @Column({ name: 'consent_document_url', nullable: true })
  consentDocumentUrl?: string;

  @Column({ name: 'recorded_by', nullable: true })
  recordedBy?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
