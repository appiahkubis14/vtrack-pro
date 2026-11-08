import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('recovery_notes')
export class RecoveryNote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'theft_case_id' })
  theftCaseId: string;

  @Column({ name: 'author_id', nullable: true })
  authorId?: string;

  @Column({ type: 'text' })
  note: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
