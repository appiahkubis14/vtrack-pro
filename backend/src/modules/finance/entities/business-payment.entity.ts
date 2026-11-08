import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { pesewasTransformer } from '../../../common/money/money';

export type PaymentPurpose = 'deposit' | 'installment' | 'charge' | 'payout' | 'hub_deposit';

/** Every cash movement with a purpose, a payer/payee and a unique reference (BR6). */
@Entity('business_payments')
export class BusinessPayment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'organization_id' }) organizationId: string;
  @Column({ type: 'varchar' }) purpose: PaymentPurpose;
  @Column({ type: 'varchar' }) direction: 'in' | 'out';
  @Column({ name: 'amount_pesewas', type: 'bigint', transformer: pesewasTransformer }) amountPesewas: number;
  @Column({ type: 'varchar' }) method: 'cash' | 'momo' | 'bank';
  @Column({ name: 'party_type', type: 'varchar', nullable: true }) partyType?: 'owner' | 'rider' | 'hub' | 'company' | null;
  @Column({ name: 'party_id', type: 'uuid', nullable: true }) partyId?: string | null;
  @Column({ name: 'party_name', type: 'varchar', nullable: true }) partyName?: string | null;
  @Column({ name: 'contract_id', type: 'uuid', nullable: true }) contractId?: string | null;
  @Column({ name: 'charge_event_id', type: 'uuid', nullable: true }) chargeEventId?: string | null;
  @Column({ name: 'hub_id', type: 'uuid', nullable: true }) hubId?: string | null;
  @Column() reference: string;
  @Column({ name: 'ledger_transaction_id', type: 'uuid', nullable: true }) ledgerTransactionId?: string | null;
  @Column({ type: 'text', nullable: true }) note?: string | null;
  @Column({ name: 'recorded_by', type: 'uuid', nullable: true }) recordedBy?: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
