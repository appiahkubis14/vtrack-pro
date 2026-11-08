import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** BR17 (PROPOSED, awaiting client confirmation): an approved period in which a rider is not locked for non-payment. */
@Entity('rider_exceptions')
export class RiderException {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'organization_id' }) organizationId: string;
  @Column({ name: 'rider_id' }) riderId: string;
  @Column({ type: 'varchar' }) kind: 'sickness' | 'breakdown' | 'leave' | 'other';
  @Column({ name: 'starts_on', type: 'date' }) startsOn: string;
  @Column({ name: 'ends_on', type: 'date' }) endsOn: string;
  @Column({ type: 'text' }) reason: string;
  @Column({ type: 'varchar', default: 'active' }) status: 'active' | 'cancelled';
  @Column({ name: 'approved_by' }) approvedBy: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
