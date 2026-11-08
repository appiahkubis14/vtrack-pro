import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum ChargingSessionStatus {
  SCHEDULED = 'scheduled',
  CHARGING = 'charging',
  COMPLETED = 'completed',
  INTERRUPTED = 'interrupted',
  FAILED = 'failed',
}

@Entity('charging_sessions')
export class ChargingSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'vehicle_id' })
  vehicleId: string;

  @Column({ name: 'device_id', nullable: true })
  deviceId?: string;

  @Column({ name: 'start_time', type: 'timestamp' })
  startTime: Date;

  @Column({ name: 'end_time', type: 'timestamp', nullable: true })
  endTime?: Date;

  @Column({ name: 'start_soc', type: 'decimal', precision: 5, scale: 2, nullable: true })
  startSoc?: number;

  @Column({ name: 'end_soc', type: 'decimal', precision: 5, scale: 2, nullable: true })
  endSoc?: number;

  @Column({ name: 'start_odometer', type: 'decimal', precision: 12, scale: 2, nullable: true })
  startOdometer?: number;

  @Column({ name: 'end_odometer', type: 'decimal', precision: 12, scale: 2, nullable: true })
  endOdometer?: number;

  @Column({ name: 'energy_added_kwh', type: 'decimal', precision: 10, scale: 3, nullable: true })
  energyAddedKwh?: number;

  @Column({ name: 'energy_consumed_kwh', type: 'decimal', precision: 10, scale: 3, nullable: true })
  energyConsumedKwh?: number;

  @Column({ name: 'charging_type', type: 'varchar', length: 10, nullable: true })
  chargingType?: 'AC' | 'DC';

  @Column({ name: 'charger_location', nullable: true })
  chargerLocation?: string;

  @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true })
  latitude?: number;

  @Column({ type: 'decimal', precision: 11, scale: 8, nullable: true })
  longitude?: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  cost?: number;

  @Column({ default: 'USD' })
  currency: string;

  @Column({ name: 'grid_price', type: 'decimal', precision: 8, scale: 4, nullable: true })
  gridPrice?: number;

  @Column({ name: 'charging_curve_json', type: 'jsonb', nullable: true })
  chargingCurve?: Array<{ t: string; powerKw: number; soc: number }>;

  @Column({ name: 'temperature_json', type: 'jsonb', nullable: true })
  temperatureJson?: Record<string, unknown>;

  @Column({ name: 'faults_json', type: 'jsonb', nullable: true })
  faultsJson?: Record<string, unknown>;

  @Column({ type: 'varchar', length: 20, default: ChargingSessionStatus.SCHEDULED })
  status: ChargingSessionStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
