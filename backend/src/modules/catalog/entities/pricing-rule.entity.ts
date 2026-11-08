import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('pricing_rules')
export class PricingRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id' })
  productId: string;

  @Column({ name: 'variant_id', nullable: true })
  variantId?: string;

  /** NULL = public default pricing; set = negotiated pricing for that org only. */
  @Column({ name: 'organization_id', nullable: true })
  organizationId?: string;

  @Column()
  currency: string;

  @Column({ name: 'hardware_price', type: 'decimal', precision: 10, scale: 2, default: 0 })
  hardwarePrice: number;

  @Column({ name: 'monthly_subscription_price', type: 'decimal', precision: 10, scale: 2, default: 0 })
  monthlySubscriptionPrice: number;

  @Column({ name: 'annual_subscription_price', type: 'decimal', precision: 10, scale: 2, default: 0 })
  annualSubscriptionPrice: number;

  @Column({ name: 'installation_fee', type: 'decimal', precision: 10, scale: 2, default: 0 })
  installationFee: number;

  @Column({ name: 'maintenance_fee', type: 'decimal', precision: 10, scale: 2, default: 0 })
  maintenanceFee: number;

  @Column({ name: 'sim_data_fee', type: 'decimal', precision: 10, scale: 2, default: 0 })
  simDataFee: number;

  @Column({ name: 'roaming_fee', type: 'decimal', precision: 10, scale: 2, default: 0 })
  roamingFee: number;

  @Column({ name: 'is_trial_pricing', default: false })
  isTrialPricing: boolean;

  @Column({ name: 'trial_days', nullable: true })
  trialDays?: number;

  @Column({ name: 'valid_from', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  validFrom: Date;

  @Column({ name: 'valid_until', type: 'timestamp', nullable: true })
  validUntil?: Date;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
