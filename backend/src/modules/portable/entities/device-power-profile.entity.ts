import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('device_power_profiles')
export class DevicePowerProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ name: 'report_interval_seconds', nullable: true })
  reportIntervalSeconds?: number;

  @Column({ name: 'wake_trigger', nullable: true })
  wakeTrigger?: string;

  @Column({ name: 'estimated_battery_days_2000mah', type: 'decimal', precision: 6, scale: 1, nullable: true })
  estimatedBatteryDays2000mah?: number;

  @Column({ type: 'text', nullable: true })
  description?: string;
}
