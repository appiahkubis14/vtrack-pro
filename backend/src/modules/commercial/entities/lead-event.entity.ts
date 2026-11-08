import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('lead_events')
export class LeadEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'lead_id' })
  leadId: string;

  @Column({ name: 'event_type' })
  eventType: string;

  @Column({ name: 'from_status', nullable: true })
  fromStatus?: string;

  @Column({ name: 'to_status', nullable: true })
  toStatus?: string;

  @Column({ type: 'text', nullable: true })
  note?: string;

  @Column({ name: 'created_by', nullable: true })
  createdBy?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
