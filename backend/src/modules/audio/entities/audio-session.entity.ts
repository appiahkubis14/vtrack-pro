import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum AudioSessionType {
  LIVE_MONITORING = 'live_monitoring',
  SCHEDULED_RECORDING = 'scheduled_recording',
  VOICE_ACTIVATED = 'voice_activated',
  SOS_TRIGGERED = 'sos_triggered',
  INCIDENT_TRIGGERED = 'incident_triggered',
  MANUAL_REQUEST = 'manual_request',
}

export enum AudioSessionStatus {
  REQUESTED = 'requested',
  POLICY_DENIED = 'policy_denied',
  CONSENT_MISSING = 'consent_missing',
  RECORDING = 'recording',
  COMPLETED = 'completed',
  FAILED = 'failed',
  DELETED = 'deleted',
}

@Entity('audio_sessions')
export class AudioSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'device_id', nullable: true })
  deviceId?: string;

  @Column({ name: 'vehicle_id', nullable: true })
  vehicleId?: string;

  @Column({ name: 'driver_id', nullable: true })
  driverId?: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'session_type', type: 'varchar', length: 30 })
  sessionType: AudioSessionType;

  @Column({ name: 'trigger_type', nullable: true })
  triggerType?: string;

  @Column({ name: 'start_time', type: 'timestamp', nullable: true })
  startTime?: Date;

  @Column({ name: 'end_time', type: 'timestamp', nullable: true })
  endTime?: Date;

  @Column({ name: 'duration_seconds', nullable: true })
  durationSeconds?: number;

  @Column({ name: 'audio_format', default: 'opus' })
  audioFormat: string;

  @Column({ name: 'file_size_bytes', type: 'bigint', nullable: true })
  fileSizeBytes?: number;

  @Column({ name: 'storage_location', nullable: true })
  storageLocation?: string;

  @Column({ name: 'encryption_key_id', nullable: true })
  encryptionKeyId?: string;

  @Column({ name: 'transcription_enabled', default: false })
  transcriptionEnabled: boolean;

  @Column({ name: 'transcript_status', nullable: true })
  transcriptStatus?: string;

  @Column({ name: 'consent_id', nullable: true })
  consentId?: string;

  @Column({ name: 'legal_basis', nullable: true })
  legalBasis?: string;

  @Column({ type: 'varchar', length: 20, default: AudioSessionStatus.REQUESTED })
  status: AudioSessionStatus;

  @Column({ name: 'denial_reason', type: 'text', nullable: true })
  denialReason?: string;

  @Column({ name: 'created_by', nullable: true })
  createdBy?: string;

  @Column({ name: 'approved_by', nullable: true })
  approvedBy?: string;

  @Column({ name: 'approved_at', type: 'timestamp', nullable: true })
  approvedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
