import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum VariantType {
  TIER = 'tier',
  BILLING_MODEL = 'billing_model',
  SIM_OPTION = 'sim_option',
  INSTALL_OPTION = 'install_option',
}

@Entity('product_variants')
export class ProductVariant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id' })
  productId: string;

  @Column()
  name: string;

  @Column({ unique: true })
  sku: string;

  @Column({ name: 'variant_type', type: 'varchar', length: 30 })
  variantType: VariantType;

  @Column({ name: 'includes_sim', default: true })
  includesSim: boolean;

  @Column({ name: 'includes_installation', default: false })
  includesInstallation: boolean;

  @Column({ name: 'is_default', default: false })
  isDefault: boolean;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'display_order', default: 0 })
  displayOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
