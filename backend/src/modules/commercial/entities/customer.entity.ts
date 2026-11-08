import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('customers')
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'lead_id', nullable: true })
  leadId?: string;

  @Column({ name: 'organization_id', nullable: true })
  organizationId?: string;

  @Column({ name: 'billing_name' })
  billingName: string;

  @Column({ name: 'billing_email', nullable: true })
  billingEmail?: string;

  @Column({ name: 'billing_phone', nullable: true })
  billingPhone?: string;

  @Column({ name: 'billing_address', type: 'text', nullable: true })
  billingAddress?: string;

  @Column({ name: 'tax_id', nullable: true })
  taxId?: string;

  @Column({ nullable: true })
  country?: string;

  @Column({ name: 'preferred_currency', default: 'GHS' })
  preferredCurrency: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
