import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('battery_telemetry')
export class BatteryTelemetry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'device_id' })
  deviceId: string;

  @Column({ name: 'battery_percent', type: 'decimal', precision: 5, scale: 2, nullable: true })
  batteryPercent?: number;

  @Column({ name: 'battery_voltage', type: 'decimal', precision: 5, scale: 2, nullable: true })
  batteryVoltage?: number;

  @Column({ name: 'is_charging', default: false })
  isCharging: boolean;

  @Column({ name: 'estimated_days_remaining', type: 'decimal', precision: 6, scale: 1, nullable: true })
  estimatedDaysRemaining?: number;

  @Column({ name: 'power_profile', nullable: true })
  powerProfile?: string;

  @Column({ type: 'timestamp' })
  timestamp: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
