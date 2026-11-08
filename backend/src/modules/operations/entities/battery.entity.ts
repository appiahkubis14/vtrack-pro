import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { pesewasTransformer } from '../../../common/money/money';

const num = { to: (v: any) => v, from: (v: any) => (v == null ? v : Number(v)) };

@Entity('batteries')
export class Battery {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'organization_id' }) organizationId: string;
  @Column({ name: 'serial_no' }) serialNo: string;
  @Column({ default: 72 }) voltage: number;
  @Column({ name: 'capacity_ah', default: 100 }) capacityAh: number;
  @Column({ name: 'gps_module_id', type: 'varchar', nullable: true }) gpsModuleId?: string | null;
  @Column({ type: 'varchar', default: 'available' }) status: 'available' | 'fitted' | 'charging' | 'faulty' | 'missing';
  @Column({ name: 'current_vehicle_id', type: 'uuid', nullable: true }) currentVehicleId?: string | null;
  @Column({ name: 'hub_id', type: 'uuid', nullable: true }) hubId?: string | null;
  @Column({ name: 'health_pct', type: 'decimal', precision: 5, scale: 2, nullable: true, transformer: num }) healthPct?: number | null;
  @Column({ name: 'cycle_count', default: 0 }) cycleCount: number;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}

@Entity('battery_swaps')
export class BatterySwap {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'organization_id' }) organizationId: string;
  @Column({ name: 'hub_id' }) hubId: string;
  @Column({ name: 'vehicle_id' }) vehicleId: string;
  @Column({ name: 'rider_id', type: 'uuid', nullable: true }) riderId?: string | null;
  @Column({ name: 'battery_out_id', type: 'uuid', nullable: true }) batteryOutId?: string | null;
  @Column({ name: 'battery_in_id', type: 'uuid', nullable: true }) batteryInId?: string | null;
  @Column({ name: 'swapped_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' }) swappedAt: Date;
  @Column({ name: 'recorded_by', type: 'uuid', nullable: true }) recordedBy?: string | null;
}

@Entity('charge_events')
export class ChargeEvent {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'organization_id' }) organizationId: string;
  @Column({ name: 'hub_id' }) hubId: string;
  @Column({ name: 'charge_point_id', type: 'uuid', nullable: true }) chargePointId?: string | null;
  @Column({ name: 'battery_id' }) batteryId: string;
  @Column({ name: 'rider_id', type: 'uuid', nullable: true }) riderId?: string | null;
  @Column({ type: 'decimal', precision: 8, scale: 3, nullable: true, transformer: num }) kwh?: number | null;
  @Column({ name: 'fee_pesewas', type: 'bigint', transformer: pesewasTransformer, default: 0 }) feePesewas: number;
  @Column({ name: 'started_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' }) startedAt: Date;
  @Column({ name: 'ended_at', type: 'timestamp', nullable: true }) endedAt?: Date | null;
  @Column({ name: 'charge_date', type: 'date', default: () => 'CURRENT_DATE' }) chargeDate: string;
  @Column({ type: 'varchar', default: 'open' }) status: 'open' | 'completed' | 'billed';
  @Column({ name: 'settlement_id', type: 'uuid', nullable: true }) settlementId?: string | null;
  @Column({ name: 'recorded_by', type: 'uuid', nullable: true }) recordedBy?: string | null;
}
