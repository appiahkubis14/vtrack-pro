import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type LockRequestStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';

/** A manual lock/unlock that needs a person's approval (BR8). */
@Entity('lock_requests')
export class LockRequest {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'organization_id' }) organizationId: string;
  @Column({ name: 'hub_id', type: 'uuid', nullable: true }) hubId?: string | null;
  @Column({ name: 'vehicle_id' }) vehicleId: string;
  @Column({ name: 'rider_id', type: 'uuid', nullable: true }) riderId?: string | null;
  @Column({ type: 'varchar', default: 'lock' }) kind: 'lock' | 'unlock';
  @Column({ type: 'text' }) reason: string;
  @Column({ type: 'varchar', default: 'pending' }) status: LockRequestStatus;
  @Column({ name: 'requested_by', type: 'uuid', nullable: true }) requestedBy?: string | null;
  @Column({ name: 'decided_by', type: 'uuid', nullable: true }) decidedBy?: string | null;
  @Column({ name: 'decided_at', type: 'timestamp', nullable: true }) decidedAt?: Date | null;
  @Column({ name: 'decision_note', type: 'text', nullable: true }) decisionNote?: string | null;
  @Column({ name: 'command_id', type: 'uuid', nullable: true }) commandId?: string | null;
  @Column({ name: 'result_note', type: 'text', nullable: true }) resultNote?: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
