import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('roaming_events')
export class RoamingEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'sim_profile_id' })
  simProfileId: string;

  @Column({ name: 'device_id', nullable: true })
  deviceId?: string;

  @Column({ name: 'event_type' })
  eventType: string; // roaming_started|roaming_ended|data_cap_warning|data_cap_exceeded|unexpected_country

  @Column({ name: 'detected_country', nullable: true })
  detectedCountry?: string;

  @Column({ name: 'network_provider', nullable: true })
  networkProvider?: string;

  @Column({ name: 'data_used_mb', type: 'decimal', precision: 10, scale: 2, nullable: true })
  dataUsedMb?: number;

  @Column({ type: 'timestamp' })
  timestamp: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
