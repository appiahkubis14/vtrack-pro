import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('quote_items')
export class QuoteItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'quote_id' })
  quoteId: string;

  @Column({ name: 'product_id', nullable: true })
  productId?: string;

  @Column({ name: 'variant_id', nullable: true })
  variantId?: string;

  @Column({ name: 'bundle_id', nullable: true })
  bundleId?: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ default: 1 })
  quantity: number;

  @Column({ name: 'unit_hardware_price', type: 'decimal', precision: 10, scale: 2, default: 0 })
  unitHardwarePrice: number;

  @Column({ name: 'unit_installation_price', type: 'decimal', precision: 10, scale: 2, default: 0 })
  unitInstallationPrice: number;

  @Column({ name: 'unit_subscription_price', type: 'decimal', precision: 10, scale: 2, default: 0 })
  unitSubscriptionPrice: number;

  @Column({ name: 'unit_sim_price', type: 'decimal', precision: 10, scale: 2, default: 0 })
  unitSimPrice: number;

  @Column({ name: 'discount_id', nullable: true })
  discountId?: string;

  @Column({ name: 'line_discount_amount', type: 'decimal', precision: 10, scale: 2, default: 0 })
  lineDiscountAmount: number;

  @Column({ name: 'line_tax_amount', type: 'decimal', precision: 10, scale: 2, default: 0 })
  lineTaxAmount: number;

  @Column({ name: 'line_total', type: 'decimal', precision: 12, scale: 2, default: 0 })
  lineTotal: number;

  @Column({ name: 'display_order', default: 0 })
  displayOrder: number;
}
