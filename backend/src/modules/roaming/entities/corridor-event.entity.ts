import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('corridor_events')
export class CorridorEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'corridor_id' })
  corridorId: string;

  @Column({ name: 'device_id', nullable: true })
  deviceId?: string;

  @Column({ name: 'event_type' })
  eventType: string; // deviation|long_stop|unauthorized_country|corridor_completed

  @Column({ nullable: true })
  country?: string;

  @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true })
  latitude?: number;

  @Column({ type: 'decimal', precision: 11, scale: 8, nullable: true })
  longitude?: number;

  @Column({ type: 'jsonb', nullable: true })
  details?: Record<string, unknown>;

  @Column({ type: 'timestamp' })
  timestamp: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
