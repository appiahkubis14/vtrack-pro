import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('bundle_items')
export class BundleItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'bundle_id' })
  bundleId: string;

  @Column({ name: 'product_id', nullable: true })
  productId?: string;

  @Column({ name: 'variant_id', nullable: true })
  variantId?: string;

  @Column({ default: 1 })
  quantity: number;
}
