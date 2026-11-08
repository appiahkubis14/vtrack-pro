import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('trips')
export class Trip {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'device_id' })
  deviceId: string;

  @Column({ name: 'driver_id', nullable: true })
  driverId?: string;

  @Column({ name: 'vehicle_id' })
  vehicleId: string;

  @Column({ name: 'start_position_id', nullable: true })
  startPositionId?: string;

  @Column({ name: 'end_position_id', nullable: true })
  endPositionId?: string;

  @Column({ name: 'start_time', type: 'timestamp' })
  startTime: Date;

  @Column({ name: 'end_time', type: 'timestamp', nullable: true })
  endTime?: Date;

  @Column({ name: 'start_location', type: 'jsonb', nullable: true })
  startLocation?: Record<string, unknown>;

  @Column({ name: 'end_location', type: 'jsonb', nullable: true })
  endLocation?: Record<string, unknown>;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  distance?: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  duration?: number;

  @Column({ name: 'moving_duration', type: 'decimal', precision: 12, scale: 2, nullable: true })
  movingDuration?: number;

  @Column({ name: 'stopped_duration', type: 'decimal', precision: 12, scale: 2, nullable: true })
  stoppedDuration?: number;

  @Column({ name: 'average_speed', type: 'decimal', precision: 8, scale: 2, nullable: true })
  averageSpeed?: number;

  @Column({ name: 'max_speed', type: 'decimal', precision: 8, scale: 2, nullable: true })
  maxSpeed?: number;

  @Column({ name: 'fuel_consumed', type: 'decimal', precision: 10, scale: 3, nullable: true })
  fuelConsumed?: number;

  @Column({ name: 'fuel_efficiency', type: 'decimal', precision: 8, scale: 3, nullable: true })
  fuelEfficiency?: number;

  @Column({ name: 'stop_count', default: 0 })
  stopCount: number;

  @Column({ type: 'jsonb', nullable: true })
  events?: Record<string, unknown>;

  @Column({ default: 0 })
  score: number;

  @Column({ name: 'route_geometry', type: 'text', nullable: true })
  routeGeometry?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
