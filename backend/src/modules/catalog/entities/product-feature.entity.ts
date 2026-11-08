import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('product_features')
export class ProductFeature {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id' })
  productId: string;

  @Column({ name: 'feature_key' })
  featureKey: string;

  @Column({ name: 'feature_label' })
  featureLabel: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'display_order', default: 0 })
  displayOrder: number;
}
