import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('driver_scores')
export class DriverScore {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'driver_id' })
  driverId: string;

  @Column({ name: 'period_start', type: 'date' })
  periodStart: Date;

  @Column({ name: 'period_end', type: 'date' })
  periodEnd: Date;

  @Column({ name: 'overall_score' })
  overallScore: number;

  @Column({ name: 'speeding_score', nullable: true })
  speedingScore?: number;

  @Column({ name: 'braking_score', nullable: true })
  brakingScore?: number;

  @Column({ name: 'acceleration_score', nullable: true })
  accelerationScore?: number;

  @Column({ name: 'cornering_score', nullable: true })
  corneringScore?: number;

  @Column({ name: 'idling_score', nullable: true })
  idlingScore?: number;

  @Column({ name: 'fuel_efficiency_score', nullable: true })
  fuelEfficiencyScore?: number;

  @Column({ name: 'safety_score', nullable: true })
  safetyScore?: number;

  @Column({ type: 'jsonb', nullable: true })
  events?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  recommendations?: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
