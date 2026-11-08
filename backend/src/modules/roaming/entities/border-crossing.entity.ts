import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('border_crossings')
export class BorderCrossing {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'device_id' })
  deviceId: string;

  @Column({ name: 'vehicle_id', nullable: true })
  vehicleId?: string;

  @Column({ name: 'corridor_id', nullable: true })
  corridorId?: string;

  @Column({ name: 'crossing_type' })
  crossingType: 'entry' | 'exit';

  @Column({ name: 'from_country', nullable: true })
  fromCountry?: string;

  @Column({ name: 'to_country' })
  toCountry: string;

  @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true })
  latitude?: number;

  @Column({ type: 'decimal', precision: 11, scale: 8, nullable: true })
  longitude?: number;

  @Column({ name: 'crossed_at', type: 'timestamp' })
  crossedAt: Date;

  @Column({ name: 'dwell_time_minutes', nullable: true })
  dwellTimeMinutes?: number;

  @Column({ name: 'is_authorized', default: true })
  isAuthorized: boolean;

  @Column({ name: 'is_customs_stop', default: false })
  isCustomsStop: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
