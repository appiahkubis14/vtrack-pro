import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('geofence_device_states')
export class GeofenceDeviceState {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'geofence_id' })
  geofenceId: string;

  @Column({ name: 'device_id' })
  deviceId: string;

  @Column({ name: 'candidate_state', type: 'varchar', length: 10 })
  candidateState: 'in' | 'out';

  @Column({ name: 'confirmed_state', type: 'varchar', length: 10, default: 'out' })
  confirmedState: 'in' | 'out';

  @Column({ name: 'candidate_since', type: 'timestamp', nullable: true })
  candidateSince?: Date;

  @Column({ name: 'last_alert_at', type: 'timestamp', nullable: true })
  lastAlertAt?: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
