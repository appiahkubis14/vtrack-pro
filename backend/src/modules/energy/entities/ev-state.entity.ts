import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('ev_states')
export class EvState {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'vehicle_id' })
  vehicleId: string;

  @Column({ name: 'device_id', nullable: true })
  deviceId?: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  soc?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  soh?: number;

  @Column({ default: false })
  charging: boolean;

  @Column({ name: 'plugged_in', default: false })
  pluggedIn: boolean;

  @Column({ name: 'charge_type', type: 'varchar', length: 10, nullable: true })
  chargeType?: 'AC' | 'DC';

  @Column({ name: 'battery_temperature', type: 'decimal', precision: 5, scale: 2, nullable: true })
  batteryTemperature?: number;

  @Column({ name: 'estimated_range_km', type: 'decimal', precision: 8, scale: 2, nullable: true })
  estimatedRangeKm?: number;

  @Column({ name: 'charging_power_kw', type: 'decimal', precision: 6, scale: 2, nullable: true })
  chargingPowerKw?: number;

  @Column({ name: 'charging_voltage', type: 'decimal', precision: 6, scale: 2, nullable: true })
  chargingVoltage?: number;

  @Column({ name: 'charging_current', type: 'decimal', precision: 6, scale: 2, nullable: true })
  chargingCurrent?: number;

  @Column({ name: 'cell_imbalance_mv', type: 'decimal', precision: 6, scale: 2, nullable: true })
  cellImbalanceMv?: number;

  @Column({ name: 'fault_codes', type: 'text', array: true, nullable: true })
  faultCodes?: string[];

  @Column({ name: 'v2g_capable', default: false })
  v2gCapable: boolean;

  @Column({ name: 'discharge_power_kw', type: 'decimal', precision: 6, scale: 2, nullable: true })
  dischargePowerKw?: number;

  @Column({ name: 'grid_export_enabled', default: false })
  gridExportEnabled: boolean;

  @Column({ name: 'grid_export_price', type: 'decimal', precision: 8, scale: 4, nullable: true })
  gridExportPrice?: number;

  @Column({ name: 'energy_exported_kwh', type: 'decimal', precision: 10, scale: 3, nullable: true })
  energyExportedKwh?: number;

  @Column({ name: 'grid_services_enrollment', type: 'jsonb', nullable: true })
  gridServicesEnrollment?: Record<string, unknown>;

  @Column({ type: 'timestamp' })
  timestamp: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
