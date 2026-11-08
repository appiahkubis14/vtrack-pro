import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum TheftCaseStatus {
  SUSPECTED = 'suspected',
  ACTIVE = 'active',
  TRACKING = 'tracking',
  IMMOBILIZED = 'immobilized',
  RECOVERED = 'recovered',
  FALSE_ALARM = 'false_alarm',
  CLOSED = 'closed',
}

@Entity('theft_cases')
export class TheftCase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'vehicle_id' })
  vehicleId: string;

  @Column({ name: 'device_id', nullable: true })
  deviceId?: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ type: 'varchar', length: 20, default: TheftCaseStatus.SUSPECTED })
  status: TheftCaseStatus;

  @Column({ name: 'reported_by', nullable: true })
  reportedBy?: string;

  @Column({ name: 'reported_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  reportedAt: Date;

  @Column({ name: 'last_known_latitude', type: 'decimal', precision: 10, scale: 8, nullable: true })
  lastKnownLatitude?: number;

  @Column({ name: 'last_known_longitude', type: 'decimal', precision: 11, scale: 8, nullable: true })
  lastKnownLongitude?: number;

  @Column({ name: 'last_known_at', type: 'timestamp', nullable: true })
  lastKnownAt?: Date;

  @Column({ name: 'assigned_team_id', nullable: true })
  assignedTeamId?: string;

  @Column({ name: 'police_reference', nullable: true })
  policeReference?: string;

  @Column({ name: 'high_frequency_mode_enabled', default: false })
  highFrequencyModeEnabled: boolean;

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  resolvedAt?: Date;

  @Column({ name: 'resolution_notes', type: 'text', nullable: true })
  resolutionNotes?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
