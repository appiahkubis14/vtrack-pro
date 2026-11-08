import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audio_transcripts')
export class AudioTranscript {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'clip_id' })
  clipId: string;

  @Column({ nullable: true })
  language?: string;

  @Column({ name: 'transcript_text', type: 'text', nullable: true })
  transcriptText?: string;

  @Column({ type: 'decimal', precision: 4, scale: 3, nullable: true })
  confidence?: number;

  @Column({ name: 'detected_keywords', type: 'text', array: true, nullable: true })
  detectedKeywords?: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
