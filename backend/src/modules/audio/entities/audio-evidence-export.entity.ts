import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export interface ChainOfCustodyEntry {
  clipId: string;
  originalHash: string;
  verifiedAt: string;
}

@Entity('audio_evidence_exports')
export class AudioEvidenceExport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'session_id' })
  sessionId: string;

  @Column({ name: 'exported_by', nullable: true })
  exportedBy?: string;

  @Column({ name: 'case_reference', nullable: true })
  caseReference?: string;

  @Column({ name: 'export_hash', length: 64 })
  exportHash: string;

  @Column({ name: 'chain_of_custody', type: 'jsonb' })
  chainOfCustody: ChainOfCustodyEntry[];

  @Column({ name: 'digital_signature', type: 'text', nullable: true })
  digitalSignature?: string;

  @CreateDateColumn({ name: 'exported_at' })
  exportedAt: Date;
}
