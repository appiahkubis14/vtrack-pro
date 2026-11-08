import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('charge_schedules')
export class ChargeSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'vehicle_id' })
  vehicleId: string;

  @Column({ name: 'target_soc', type: 'decimal', precision: 5, scale: 2 })
  targetSoc: number;

  @Column({ name: 'departure_time', type: 'timestamp' })
  departureTime: Date;

  @Column({ name: 'recommended_start_time', type: 'timestamp', nullable: true })
  recommendedStartTime?: Date;

  @Column({ name: 'recommended_end_time', type: 'timestamp', nullable: true })
  recommendedEndTime?: Date;

  @Column({ name: 'estimated_cost', type: 'decimal', precision: 10, scale: 2, nullable: true })
  estimatedCost?: number;

  @Column({ name: 'estimated_soh_impact', type: 'decimal', precision: 6, scale: 4, nullable: true })
  estimatedSohImpact?: number;

  @Column({ name: 'recommended_charge_limit_pct', type: 'decimal', precision: 5, scale: 2, nullable: true })
  recommendedChargeLimitPct?: number;

  @Column({ name: 'electricity_price_schedule', type: 'jsonb', nullable: true })
  electricityPriceSchedule?: Array<{ hour: number; pricePerKwh: number }>;

  @Column({ type: 'varchar', length: 20, default: 'planned' })
  status: 'planned' | 'active' | 'completed' | 'cancelled';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
