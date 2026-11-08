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
import { Vehicle } from '../../vehicles/entities/vehicle.entity';
import { DeviceStatus } from '../../../common/constants/alerts.constant';

export enum DeviceProtocol {
  GT06 = 'gt06',
  TK103 = 'tk103',
  TELTONIKA = 'teltonika',
  GL300 = 'gl300',
  MEITRACK = 'meitrack',
  XEXUN = 'xexun',
  CUSTOM = 'custom',
}

@Entity('devices')
export class Device {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'vehicle_id', nullable: true })
  vehicleId?: string;

  @ManyToOne(() => Vehicle, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle?: Vehicle;

  @Column({ unique: true })
  imei: string;

  @Column({ nullable: true })
  name?: string;

  @Column({ type: 'varchar', length: 50 })
  protocol: DeviceProtocol;

  @Column({ nullable: true })
  model?: string;

  @Column({ name: 'firmware_version', nullable: true })
  firmwareVersion?: string;

  @Column({ name: 'sim_number', nullable: true })
  simNumber?: string;

  @Column({ name: 'sim_provider', nullable: true })
  simProvider?: string;

  @Column({ type: 'varchar', length: 20, default: DeviceStatus.OFFLINE })
  status: DeviceStatus;

  @Column({ name: 'battery_level', default: 0 })
  batteryLevel: number;

  @Column({ name: 'signal_strength', default: 0 })
  signalStrength: number;

  @Column({ name: 'last_position_id', nullable: true })
  lastPositionId?: string;

  @Column({ name: 'last_communication_at', type: 'timestamp', nullable: true })
  lastCommunicationAt?: Date;

  @Column({ type: 'jsonb', default: {} })
  config: Record<string, unknown>;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date;
}
