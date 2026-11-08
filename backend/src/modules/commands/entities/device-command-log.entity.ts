import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('device_command_logs')
export class DeviceCommandLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'command_id' })
  commandId: string;

  @Column({ name: 'from_state', nullable: true })
  fromState?: string;

  @Column({ name: 'to_state' })
  toState: string;

  @Column({ type: 'text', nullable: true })
  reason?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
