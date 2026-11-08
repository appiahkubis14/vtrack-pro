import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('sim_assignment_history')
export class SimAssignmentHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'sim_profile_id' })
  simProfileId: string;

  @Column({ name: 'device_id', nullable: true })
  deviceId?: string;

  @CreateDateColumn({ name: 'assigned_at' })
  assignedAt: Date;

  @Column({ name: 'unassigned_at', type: 'timestamp', nullable: true })
  unassignedAt?: Date;

  @Column({ name: 'unassignment_reason', nullable: true })
  unassignmentReason?: string;
}
