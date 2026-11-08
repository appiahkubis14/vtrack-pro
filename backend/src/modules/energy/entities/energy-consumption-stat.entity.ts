import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('energy_consumption_stats')
export class EnergyConsumptionStat {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'vehicle_id' })
  vehicleId: string;

  @Column({ name: 'period_start', type: 'date' })
  periodStart: Date;

  @Column({ name: 'period_end', type: 'date' })
  periodEnd: Date;

  @Column({ name: 'kwh_per_100km', type: 'decimal', precision: 8, scale: 3, nullable: true })
  kwhPer100Km?: number;

  @Column({ name: 'miles_per_kwh', type: 'decimal', precision: 8, scale: 3, nullable: true })
  milesPerKwh?: number;

  @Column({ name: 'energy_cost_total', type: 'decimal', precision: 10, scale: 2, nullable: true })
  energyCostTotal?: number;

  @Column({ name: 'idle_energy_kwh', type: 'decimal', precision: 8, scale: 3, nullable: true })
  idleEnergyKwh?: number;

  @Column({ name: 'hvac_energy_kwh', type: 'decimal', precision: 8, scale: 3, nullable: true })
  hvacEnergyKwh?: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
