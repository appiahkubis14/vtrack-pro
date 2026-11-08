import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('hardware_skus')
export class HardwareSku {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id' })
  productId: string;

  @Column({ unique: true })
  sku: string;

  @Column({ nullable: true })
  manufacturer?: string;

  @Column({ nullable: true })
  model?: string;

  @Column({ name: 'ip_rating', nullable: true })
  ipRating?: string;

  @Column({ name: 'battery_capacity_mah', nullable: true })
  batteryCapacityMah?: number;

  @Column({ name: 'is_covert_capable', default: false })
  isCovertCapable: boolean;

  @Column({ name: 'cost_price', type: 'decimal', precision: 10, scale: 2, nullable: true })
  costPrice?: number;

  @Column({ name: 'stock_quantity', default: 0 })
  stockQuantity: number;

  @Column({ name: 'low_stock_threshold', default: 10 })
  lowStockThreshold: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
