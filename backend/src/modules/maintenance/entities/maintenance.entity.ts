import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum MaintenanceStatus {
  SCHEDULED = 'scheduled',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum MaintenancePriority {
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

@Entity('maintenance')
export class Maintenance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'vehicle_id' })
  vehicleId: string;

  @Column({ name: 'service_type' })
  serviceType: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'varchar', length: 20, default: MaintenancePriority.MEDIUM })
  priority: MaintenancePriority;

  @Column({ type: 'varchar', length: 20, default: MaintenanceStatus.SCHEDULED })
  status: MaintenanceStatus;

  @Column({ name: 'scheduled_date', type: 'date', nullable: true })
  scheduledDate?: Date;

  @Column({ name: 'completed_date', type: 'date', nullable: true })
  completedDate?: Date;

  @Column({ name: 'odometer_at_service', type: 'decimal', precision: 12, scale: 2, nullable: true })
  odometerAtService?: number;

  @Column({ name: 'engine_hours_at_service', type: 'decimal', precision: 10, scale: 2, nullable: true })
  engineHoursAtService?: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  cost?: number;

  @Column({ name: 'parts_cost', type: 'decimal', precision: 12, scale: 2, nullable: true })
  partsCost?: number;

  @Column({ name: 'labor_cost', type: 'decimal', precision: 12, scale: 2, nullable: true })
  laborCost?: number;

  @Column({ name: 'vendor_name', nullable: true })
  vendorName?: string;

  @Column({ name: 'vendor_phone', nullable: true })
  vendorPhone?: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ type: 'text', array: true, nullable: true })
  attachments?: string[];

  @Column({ name: 'created_by', nullable: true })
  createdBy?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
