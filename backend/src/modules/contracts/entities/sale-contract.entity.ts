import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { pesewasTransformer } from '../../../common/money/money';
import { ContractStatus } from '../../../common/lifecycle/transitions';

@Entity('sale_contracts')
export class SaleContract {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'organization_id' }) organizationId: string;
  @Column({ name: 'contract_no' }) contractNo: string;
  @Column({ name: 'owner_id' }) ownerId: string;
  @Column({ name: 'grace_period_hours', type: 'int', nullable: true }) gracePeriodHours?: number | null;
  @Column({ name: 'vehicle_id' }) vehicleId: string;
  @Column({ type: 'varchar' }) mode: 'outright' | 'lease' | 'work_and_pay';
  @Column({ name: 'price_pesewas', type: 'bigint', transformer: pesewasTransformer }) pricePesewas: number;
  @Column({ name: 'deposit_pesewas', type: 'bigint', transformer: pesewasTransformer, default: 0 }) depositPesewas: number;
  @Column({ name: 'term_weeks', type: 'int', nullable: true }) termWeeks?: number | null;
  @Column({ name: 'daily_amount_pesewas', type: 'bigint', transformer: pesewasTransformer, nullable: true }) dailyAmountPesewas?: number | null;
  @Column({ name: 'start_date', type: 'date' }) startDate: string;
  @Column({ type: 'varchar', default: ContractStatus.DRAFT }) status: ContractStatus;
  @Column({ name: 'default_after_arrears_days', default: 14 }) defaultAfterArrearsDays: number;
  @Column({ name: 'approved_by', type: 'uuid', nullable: true }) approvedBy?: string | null;
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy?: string | null;
  @Column({ name: 'activated_at', type: 'timestamp', nullable: true }) activatedAt?: Date | null;
  @Column({ name: 'closed_at', type: 'timestamp', nullable: true }) closedAt?: Date | null;
  @Column({ type: 'text', nullable: true }) notes?: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}

@Entity('installments')
export class Installment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'contract_id' }) contractId: string;
  @Column({ name: 'due_date', type: 'date' }) dueDate: string;
  @Column({ name: 'amount_pesewas', type: 'bigint', transformer: pesewasTransformer }) amountPesewas: number;
  @Column({ name: 'paid_pesewas', type: 'bigint', transformer: pesewasTransformer, default: 0 }) paidPesewas: number;
  @Column({ name: 'paid_at', type: 'timestamp', nullable: true }) paidAt?: Date | null;
}
