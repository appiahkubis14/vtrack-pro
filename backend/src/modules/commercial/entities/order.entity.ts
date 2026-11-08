import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'quote_id', nullable: true })
  quoteId?: string;

  @Column({ name: 'customer_id', nullable: true })
  customerId?: string;

  @Column({ name: 'organization_id', nullable: true })
  organizationId?: string;

  @Column({ name: 'order_number', unique: true })
  orderNumber: string;

  @Column({ default: 'pending' })
  status: 'pending' | 'provisioning' | 'fulfilled' | 'cancelled';

  @Column({ name: 'total_amount', type: 'decimal', precision: 12, scale: 2, nullable: true })
  totalAmount?: number;

  @Column({ nullable: true })
  currency?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'fulfilled_at', type: 'timestamp', nullable: true })
  fulfilledAt?: Date;
}
