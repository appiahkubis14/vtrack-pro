import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProductCategory } from './product-category.entity';

export enum HardwareType {
  GT06 = 'gt06',
  PORTABLE = 'portable',
  ROAMING_SIM = 'roaming_sim',
  AUDIO_CAPABLE = 'audio_capable',
  EV_CAPABLE = 'ev_capable',
  BUNDLE = 'bundle',
}

@Entity('product_catalog')
export class ProductCatalogItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'category_id', nullable: true })
  categoryId?: string;

  @ManyToOne(() => ProductCategory)
  @JoinColumn({ name: 'category_id' })
  category?: ProductCategory;

  @Column()
  name: string;

  @Column({ unique: true })
  slug: string;

  @Column({ name: 'short_description', nullable: true })
  shortDescription?: string;

  @Column({ name: 'long_description', type: 'text', nullable: true })
  longDescription?: string;

  @Column({ name: 'hardware_type', type: 'varchar', length: 50, nullable: true })
  hardwareType?: HardwareType;

  @Column({ name: 'technical_specs', type: 'jsonb', default: {} })
  technicalSpecs: Record<string, unknown>;

  @Column({ name: 'installation_requirements', type: 'text', nullable: true })
  installationRequirements?: string;

  @Column({ name: 'subscription_required', default: true })
  subscriptionRequired: boolean;

  @Column({ name: 'base_currency', default: 'GHS' })
  baseCurrency: string;

  @Column({ name: 'available_countries', type: 'text', array: true, nullable: true })
  availableCountries?: string[];

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'is_featured', default: false })
  isFeatured: boolean;

  @Column({ name: 'seo_title', nullable: true })
  seoTitle?: string;

  @Column({ name: 'seo_description', nullable: true })
  seoDescription?: string;

  @Column({ name: 'seo_keywords', type: 'text', array: true, nullable: true })
  seoKeywords?: string[];

  @Column({ name: 'image_urls', type: 'text', array: true, nullable: true })
  imageUrls?: string[];

  @Column({ name: 'datasheet_url', nullable: true })
  datasheetUrl?: string;

  @Column({ name: 'display_order', default: 0 })
  displayOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date;
}
