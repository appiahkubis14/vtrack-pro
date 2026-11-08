import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { TelemetryField } from './device-role.constant';

@Entity('device_telemetry_sources')
export class DeviceTelemetrySource {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'vehicle_id' })
  vehicleId: string;

  @Column({ type: 'varchar', length: 50 })
  field: TelemetryField;

  @Column({ name: 'device_id' })
  deviceId: string;

  @Column({ default: 0 })
  priority: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
