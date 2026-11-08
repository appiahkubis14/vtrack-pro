import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { pesewasTransformer } from '../../../common/money/money';

@Entity('rider_assignments')
export class RiderAssignment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'organization_id' }) organizationId: string;
  @Column({ name: 'rider_id' }) riderId: string;
  @Column({ name: 'vehicle_id' }) vehicleId: string;
  @Column({ name: 'hub_id' }) hubId: string;
  @Column({ name: 'start_date', type: 'date' }) startDate: string;
  @Column({ name: 'end_date', type: 'date', nullable: true }) endDate?: string | null;
  @Column({ name: 'daily_target_pesewas', type: 'bigint', transformer: pesewasTransformer, default: 0 }) dailyTargetPesewas: number;
  @Column({ name: 'daily_remittance_pesewas', type: 'bigint', transformer: pesewasTransformer, default: 0 }) dailyRemittancePesewas: number;
  @Column({ name: 'service_fee_pesewas', type: 'bigint', transformer: pesewasTransformer, default: 0 }) serviceFeePesewas: number;
  @Column({ type: 'varchar', default: 'active' }) status: 'active' | 'ended';
  @Column({ name: 'ended_reason', type: 'varchar', nullable: true }) endedReason?: string | null;
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy?: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
