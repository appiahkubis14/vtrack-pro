import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum SubscriptionTier {
  BASIC = 'basic',
  PROFESSIONAL = 'professional',
  ENTERPRISE = 'enterprise',
}

@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  slug: string;

  @Column({ name: 'subscription_tier', type: 'varchar', length: 50, default: SubscriptionTier.BASIC })
  subscriptionTier: SubscriptionTier;

  @Column({ type: 'jsonb', default: {} })
  settings: Record<string, unknown>;

  @Column({ name: 'logo_url', nullable: true })
  logoUrl?: string;

  @Column({ nullable: true })
  website?: string;

  @Column({ nullable: true })
  phone?: string;

  @Column({ nullable: true })
  address?: string;

  @Column({ nullable: true })
  city?: string;

  @Column({ nullable: true })
  state?: string;

  @Column({ nullable: true })
  country?: string;

  @Column({ name: 'postal_code', nullable: true })
  postalCode?: string;

  @Column({ default: 'UTC' })
  timezone: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'trial_ends_at', type: 'timestamp', nullable: true })
  trialEndsAt?: Date;

  // --- Module 8: tenant commercial settings ---
  @Column({ name: 'primary_color', nullable: true })
  primaryColor?: string;

  @Column({ name: 'language_default', default: 'en' })
  languageDefault: string;

  @Column({ name: 'catalog_visibility', default: 'full' })
  catalogVisibility: 'full' | 'restricted' | 'hidden';

  @Column({ name: 'device_limit', nullable: true })
  deviceLimit?: number;

  @Column({ name: 'user_limit', nullable: true })
  userLimit?: number;

  @Column({ name: 'billing_status', default: 'trial' })
  billingStatus: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled';

  @Column({ name: 'payment_method_type', nullable: true })
  paymentMethodType?: string;

  @Column({ name: 'payment_method_reference', nullable: true })
  paymentMethodReference?: string;

  @Column({ name: 'tax_id', nullable: true })
  taxId?: string;

  @Column({ name: 'data_retention_tier', default: 'standard' })
  dataRetentionTier: 'standard' | 'extended' | 'minimal';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date;
}
