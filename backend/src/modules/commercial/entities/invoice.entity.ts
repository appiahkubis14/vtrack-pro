import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', nullable: true })
  orderId?: string;

  @Column({ name: 'invoice_number', unique: true })
  invoiceNumber: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @Column({ nullable: true })
  currency?: string;

  @Column({ default: 'unpaid' })
  status: 'unpaid' | 'paid' | 'overdue' | 'void';

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate?: Date;

  @Column({ name: 'paid_at', type: 'timestamp', nullable: true })
  paidAt?: Date;

  @Column({ name: 'payment_method_note', nullable: true })
  paymentMethodNote?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
