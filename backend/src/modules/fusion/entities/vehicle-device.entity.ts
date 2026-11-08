import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { DeviceRole } from './device-role.constant';

@Entity('vehicle_devices')
export class VehicleDevice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'vehicle_id' })
  vehicleId: string;

  @Column({ name: 'device_id' })
  deviceId: string;

  @Column({ type: 'varchar', length: 50 })
  role: DeviceRole;

  @Column({ name: 'trust_level', default: 50 })
  trustLevel: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'installed_at', type: 'timestamp' })
  installedAt: Date;

  @Column({ name: 'removed_at', type: 'timestamp', nullable: true })
  removedAt?: Date;
}
