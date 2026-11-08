import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { AlertSeverity, AlertType } from '../../../common/constants/alerts.constant';

@Entity('alerts')
export class Alert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'device_id', nullable: true })
  deviceId?: string;

  @Column({ name: 'vehicle_id', nullable: true })
  vehicleId?: string;

  @Column({ name: 'driver_id', nullable: true })
  driverId?: string;

  @Column({ name: 'geofence_id', nullable: true })
  geofenceId?: string;

  @Column({ type: 'varchar', length: 50 })
  type: AlertType;

  @Column({ type: 'varchar', length: 20 })
  severity: AlertSeverity;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'jsonb', nullable: true })
  position?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @Column({ name: 'is_acknowledged', default: false })
  isAcknowledged: boolean;

  @Column({ name: 'acknowledged_by', nullable: true })
  acknowledgedBy?: string;

  @Column({ name: 'acknowledged_at', type: 'timestamp', nullable: true })
  acknowledgedAt?: Date;

  @Column({ name: 'is_resolved', default: false })
  isResolved: boolean;

  @Column({ name: 'resolved_by', nullable: true })
  resolvedBy?: string;

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  resolvedAt?: Date;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
