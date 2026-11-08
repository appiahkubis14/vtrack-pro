import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('recovery_events')
export class RecoveryEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'theft_case_id' })
  theftCaseId: string;

  @Column({ name: 'event_type' })
  eventType: string;

  @Column({ name: 'reference_id', nullable: true })
  referenceId?: string;

  @Column({ type: 'jsonb', nullable: true })
  details?: Record<string, unknown>;

  @Column({ name: 'created_by', nullable: true })
  createdBy?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
