import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audio_access_logs')
export class AudioAccessLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'clip_id' })
  clipId: string;

  @Column({ name: 'session_id', nullable: true })
  sessionId?: string;

  @Column({ name: 'accessed_by', nullable: true })
  accessedBy?: string;

  @Column({ name: 'access_type' })
  accessType: 'playback' | 'download' | 'export' | 'transcript_view';

  @Column({ name: 'ip_address', nullable: true })
  ipAddress?: string;

  @Column({ type: 'text', nullable: true })
  justification?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
