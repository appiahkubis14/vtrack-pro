import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('saved_reports')
export class SavedReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'varchar', length: 50 })
  type: string;

  @Column({ type: 'jsonb', nullable: true })
  parameters?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  schedule?: Record<string, unknown>;

  @Column({ name: 'is_scheduled', default: false })
  isScheduled: boolean;

  @Column({ name: 'last_run_at', type: 'timestamp', nullable: true })
  lastRunAt?: Date;

  @Column({ name: 'next_run_at', type: 'timestamp', nullable: true })
  nextRunAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
