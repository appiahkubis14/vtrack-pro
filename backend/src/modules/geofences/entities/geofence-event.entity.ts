import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum GeofenceEventType {
  ENTRY = 'entry',
  EXIT = 'exit',
  DWELL = 'dwell',
}

@Entity('geofence_events')
export class GeofenceEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'geofence_id' })
  geofenceId: string;

  @Column({ name: 'device_id' })
  deviceId: string;

  @Column({ name: 'vehicle_id', nullable: true })
  vehicleId?: string;

  @Column({ name: 'event_type', type: 'varchar', length: 20 })
  eventType: GeofenceEventType;

  @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true })
  latitude?: number;

  @Column({ type: 'decimal', precision: 11, scale: 8, nullable: true })
  longitude?: number;

  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  speed?: number;

  @Column({ name: 'dwell_time', nullable: true })
  dwellTime?: number;

  @Column({ type: 'timestamp' })
  timestamp: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
