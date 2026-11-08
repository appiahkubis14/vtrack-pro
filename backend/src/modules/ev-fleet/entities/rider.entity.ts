import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum RiderAuthMethod {
  NFC_RFID = 'nfc_rfid',       // Phase 2 - physical tag read at the tracker
  BLUETOOTH_APP = 'bluetooth_app', // Phase 1 - phone app proxies identity via BLE handshake with the tracker
}

@Entity('riders')
export class Rider {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'full_name' })
  fullName: string;

  @Column({ unique: true })
  phone: string; // also the MoMo payout/debit number in most cases - kept separate from a future dedicated payment-account field since riders sometimes pay from a different line than their registered phone

  @Column({ name: 'national_id_number', nullable: true })
  nationalIdNumber?: string; // Ghana Card number, if captured at registration

  @Column({ name: 'auth_method', type: 'varchar', length: 20 })
  authMethod: RiderAuthMethod;

  @Column({ name: 'nfc_tag_uid', nullable: true, unique: true })
  nfcTagUid?: string; // Phase 2

  @Column({ name: 'assigned_vehicle_id', nullable: true })
  assignedVehicleId?: string;

  @Column({ name: 'daily_target_amount', type: 'decimal', precision: 10, scale: 2 })
  dailyTargetAmount: number; // the "work and pay" daily debit amount in GHS

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // --- business layer (migration 026) ---
  @Column({ name: 'hub_id', type: 'uuid', nullable: true }) hubId?: string | null;
  @Column({ name: 'momo_number_enc', type: 'text', nullable: true, select: false }) momoNumberEnc?: string | null;
  @Column({ name: 'guarantor_name', type: 'varchar', nullable: true }) guarantorName?: string | null;
  @Column({ name: 'guarantor_phone', type: 'varchar', nullable: true }) guarantorPhone?: string | null;
  @Column({ name: 'user_id', type: 'uuid', nullable: true }) userId?: string | null;
  @Column({ type: 'varchar', default: 'active' }) status: 'active' | 'suspended' | 'exited';
}
