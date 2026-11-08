import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('wake_events')
export class WakeEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'device_id' })
  deviceId: string;

  @Column({ name: 'trigger_type' })
  triggerType: string; // 'accelerometer'|'geofence_entry'|'geofence_exit'|'scheduled'|'remote_command'

  @Column({ name: 'trigger_metadata', type: 'jsonb', nullable: true })
  triggerMetadata?: Record<string, unknown>;

  @Column({ type: 'timestamp' })
  timestamp: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
