import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('taxes')
export class Tax {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', nullable: true })
  organizationId?: string;

  @Column()
  name: string;

  @Column({ name: 'rate_percent', type: 'decimal', precision: 5, scale: 2 })
  ratePercent: number;

  @Column({ nullable: true })
  country?: string;

  @Column({ name: 'is_compound', default: false })
  isCompound: boolean;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
