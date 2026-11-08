import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('device_sleep_events')
export class DeviceSleepEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'device_id' })
  deviceId: string;

  @Column({ nullable: true })
  reason?: string; // 'scheduled'|'low_battery'|'remote_command'|'power_profile_change'

  @Column({ name: 'power_profile_at_sleep', nullable: true })
  powerProfileAtSleep?: string;

  @Column({ type: 'timestamp' })
  timestamp: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
