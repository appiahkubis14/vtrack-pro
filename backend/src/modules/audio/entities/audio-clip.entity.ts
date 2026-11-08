import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audio_clips')
export class AudioClip {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'session_id' })
  sessionId: string;

  @Column({ name: 'clip_index', default: 0 })
  clipIndex: number;

  @Column({ name: 'storage_location' })
  storageLocation: string;

  @Column({ name: 'file_size_bytes', type: 'bigint', nullable: true })
  fileSizeBytes?: number;

  @Column({ name: 'duration_seconds', type: 'decimal', precision: 8, scale: 2, nullable: true })
  durationSeconds?: number;

  @Column({ name: 'sha256_hash', length: 64 })
  sha256Hash: string;

  @Column({ name: 'recorded_at', type: 'timestamp' })
  recordedAt: Date;

  @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true })
  latitude?: number;

  @Column({ type: 'decimal', precision: 11, scale: 8, nullable: true })
  longitude?: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
