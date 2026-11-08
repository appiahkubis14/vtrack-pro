import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';

@Entity('vehicles')
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'plate_number', unique: true })
  plateNumber: string;

  @Column({ nullable: true, unique: true })
  vin?: string;

  @Column({ nullable: true })
  make?: string;

  @Column({ nullable: true })
  model?: string;

  @Column({ nullable: true })
  year?: number;

  @Column({ nullable: true })
  color?: string;

  @Column({ name: 'fuel_type', nullable: true })
  fuelType?: string;

  @Column({ nullable: true })
  transmission?: string;

  @Column({ name: 'engine_capacity', type: 'decimal', precision: 6, scale: 2, nullable: true })
  engineCapacity?: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  odometer: number;

  @Column({ name: 'registration_number', nullable: true })
  registrationNumber?: string;

  @Column({ name: 'registration_expiry', type: 'date', nullable: true })
  registrationExpiry?: Date;

  @Column({ name: 'insurance_policy', nullable: true })
  insurancePolicy?: string;

  @Column({ name: 'insurance_expiry', type: 'date', nullable: true })
  insuranceExpiry?: Date;

  @Column({ name: 'inspection_due_date', type: 'date', nullable: true })
  inspectionDueDate?: Date;

  @Column({ name: 'tank_capacity', type: 'decimal', precision: 8, scale: 2, nullable: true })
  tankCapacity?: number;

  @Column({ name: 'image_urls', type: 'text', array: true, nullable: true })
  imageUrls?: string[];

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date;

  // --- business layer (migration 026) ---
  @Column({ name: 'vehicle_model_id', type: 'uuid', nullable: true }) vehicleModelId?: string | null;
  @Column({ name: 'consignment_line_id', type: 'uuid', nullable: true }) consignmentLineId?: string | null;
  @Column({ name: 'chassis_no', type: 'varchar', nullable: true }) chassisNo?: string | null;
  @Column({ name: 'motor_no', type: 'varchar', nullable: true }) motorNo?: string | null;
  @Column({ name: 'owner_id', type: 'uuid', nullable: true }) ownerId?: string | null;
  @Column({ name: 'hub_id', type: 'uuid', nullable: true }) hubId?: string | null;
  @Column({ name: 'map_icon', type: 'varchar', length: 12, nullable: true }) mapIcon?: string | null;
  @Column({ name: 'lifecycle_status', type: 'varchar', default: 'in_stock' }) lifecycleStatus: string;
}
