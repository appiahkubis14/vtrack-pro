import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('owners')
export class Owner {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'organization_id' }) organizationId: string;
  @Column({ name: 'owner_type', type: 'varchar', default: 'individual' }) ownerType: 'individual' | 'sme';
  @Column() name: string;
  @Column() phone: string;
  @Column({ type: 'varchar', nullable: true }) email?: string | null;
  /** AES-256-GCM encrypted - never returned by the API; see FieldCrypto. */
  @Column({ name: 'momo_number_enc', type: 'text', nullable: true, select: false }) momoNumberEnc?: string | null;
  @Column({ name: 'id_document_enc', type: 'text', nullable: true, select: false }) idDocumentEnc?: string | null;
  @Column({ name: 'id_document_last4', type: 'varchar', nullable: true }) idDocumentLast4?: string | null;
  @Column({ name: 'kyc_status', type: 'varchar', default: 'pending' }) kycStatus: 'pending' | 'verified' | 'rejected';
  @Column({ name: 'user_id', type: 'uuid', nullable: true }) userId?: string | null;
  @Column({ name: 'rider_id', type: 'uuid', nullable: true }) riderId?: string | null;
  @Column({ name: 'is_active', default: true }) isActive: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
