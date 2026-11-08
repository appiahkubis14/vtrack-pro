import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { pesewasTransformer } from '../../../common/money/money';

@Entity('ledger_accounts')
export class LedgerAccount {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'organization_id' }) organizationId: string;
  @Column() code: string;
  @Column({ name: 'owner_type', type: 'varchar' }) ownerType: 'company' | 'rider' | 'owner' | 'hub';
  @Column({ name: 'owner_id', type: 'uuid', nullable: true }) ownerId?: string | null;
  @Column() name: string;
  @Column({ name: 'normal_side', type: 'varchar' }) normalSide: 'debit' | 'credit';
  @Column({ default: 'GHS' }) currency: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}

@Entity('ledger_transactions')
export class LedgerTransaction {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'organization_id' }) organizationId: string;
  @Column() reference: string;
  @Column() kind: string;
  @Column({ type: 'text', nullable: true }) description?: string | null;
  @Column({ name: 'occurred_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' }) occurredAt: Date;
  @Column({ name: 'reverses_transaction_id', type: 'uuid', nullable: true }) reversesTransactionId?: string | null;
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy?: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}

@Entity('ledger_entries')
export class LedgerEntry {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'transaction_id' }) transactionId: string;
  @Column({ name: 'account_id' }) accountId: string;
  @Column({ type: 'varchar' }) direction: 'debit' | 'credit';
  @Column({ name: 'amount_pesewas', type: 'bigint', transformer: pesewasTransformer }) amountPesewas: number;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
