import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { pesewasTransformer } from '../../../common/money/money';

const P = { type: 'bigint' as const, transformer: pesewasTransformer, default: 0 };

@Entity('daily_settlements')
export class DailySettlement {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'organization_id' }) organizationId: string;
  @Column({ name: 'hub_id' }) hubId: string;
  @Column({ name: 'rider_id' }) riderId: string;
  @Column({ name: 'vehicle_id' }) vehicleId: string;
  @Column({ name: 'owner_id', type: 'uuid', nullable: true }) ownerId?: string | null;
  @Column({ name: 'settlement_date', type: 'date' }) settlementDate: string;
  @Column({ default: 1 }) version: number;
  @Column({ name: 'is_current', default: true }) isCurrent: boolean;
  @Column({ name: 'gross_collected_pesewas', ...P }) grossCollectedPesewas: number;
  @Column({ name: 'charge_fee_pesewas', ...P }) chargeFeePesewas: number;
  @Column({ name: 'remittance_due_pesewas', ...P }) remittanceDuePesewas: number;
  @Column({ name: 'remittance_paid_pesewas', ...P }) remittancePaidPesewas: number;
  @Column({ name: 'service_fee_pesewas', ...P }) serviceFeePesewas: number;
  @Column({ name: 'chop_pesewas', ...P }) chopPesewas: number;
  @Column({ name: 'shortfall_pesewas', ...P }) shortfallPesewas: number;
  @Column({ name: 'net_to_owner_pesewas', ...P }) netToOwnerPesewas: number;
  @Column({ type: 'varchar', default: 'calculated' }) status: 'open' | 'calculated' | 'settled' | 'shortfall' | 'closed';
  @Column({ name: 'ledger_transaction_id', type: 'uuid', nullable: true }) ledgerTransactionId?: string | null;
  @Column({ name: 'calculated_by', type: 'uuid', nullable: true }) calculatedBy?: string | null;
  @Column({ name: 'closed_by', type: 'uuid', nullable: true }) closedBy?: string | null;
  @Column({ name: 'closed_at', type: 'timestamp', nullable: true }) closedAt?: Date | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
