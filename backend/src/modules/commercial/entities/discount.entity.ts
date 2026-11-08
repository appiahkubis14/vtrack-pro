import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum DiscountType {
  PERCENTAGE = 'percentage',
  FIXED_AMOUNT = 'fixed_amount',
  VOLUME_TIER = 'volume_tier',
}

@Entity('discounts')
export class Discount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, nullable: true })
  code?: string;

  @Column()
  name: string;

  @Column({ name: 'discount_type', type: 'varchar', length: 20 })
  discountType: DiscountType;

  @Column({ name: 'discount_value', type: 'decimal', precision: 10, scale: 2 })
  discountValue: number;

  @Column({ name: 'min_quantity', nullable: true })
  minQuantity?: number;

  @Column({ name: 'applies_to_product_id', nullable: true })
  appliesToProductId?: string;

  @Column({ name: 'starts_at', type: 'timestamp', nullable: true })
  startsAt?: Date;

  @Column({ name: 'ends_at', type: 'timestamp', nullable: true })
  endsAt?: Date;

  @Column({ name: 'max_redemptions', nullable: true })
  maxRedemptions?: number;

  @Column({ name: 'redemption_count', default: 0 })
  redemptionCount: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
