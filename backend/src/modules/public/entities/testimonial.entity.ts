import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('testimonials')
export class Testimonial {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'customer_name' })
  customerName: string;

  @Column({ name: 'company_name', nullable: true })
  companyName?: string;

  @Column({ type: 'text' })
  quote: string;

  @Column({ nullable: true })
  rating?: number;

  @Column({ name: 'photo_url', nullable: true })
  photoUrl?: string;

  @Column({ name: 'product_id', nullable: true })
  productId?: string;

  @Column({ name: 'is_published', default: false })
  isPublished: boolean;

  @Column({ name: 'display_order', default: 0 })
  displayOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
