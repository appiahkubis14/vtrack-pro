import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('suppliers')
export class Supplier {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'organization_id' }) organizationId: string;
  @Column() name: string;
  @Column({ type: 'varchar', nullable: true }) country?: string | null;
  @Column({ name: 'contact_name', type: 'varchar', nullable: true }) contactName?: string | null;
  @Column({ type: 'varchar', nullable: true }) phone?: string | null;
  @Column({ type: 'varchar', nullable: true }) email?: string | null;
  @Column({ type: 'text', nullable: true }) notes?: string | null;
  @Column({ name: 'is_active', default: true }) isActive: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
