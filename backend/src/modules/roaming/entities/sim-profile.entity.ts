import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum SimType {
  LOCAL = 'local',
  MULTI_NETWORK = 'multi_network',
  REGIONAL = 'regional',
  GLOBAL = 'global',
  ESIM = 'esim',
  IOT_SIM = 'iot_sim',
  PREPAID = 'prepaid',
  POSTPAID = 'postpaid',
}

@Entity('sim_profiles')
export class SimProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'device_id', nullable: true })
  deviceId?: string;

  @Column({ unique: true, nullable: true })
  iccid?: string;

  @Column({ nullable: true })
  imsi?: string;

  @Column({ nullable: true })
  msisdn?: string;

  @Column({ nullable: true })
  provider?: string;

  @Column({ name: 'sim_type', type: 'varchar', length: 20, default: SimType.LOCAL })
  simType: SimType;

  @Column({ name: 'roaming_enabled', default: false })
  roamingEnabled: boolean;

  @Column({ name: 'allowed_countries', type: 'text', array: true, nullable: true })
  allowedCountries?: string[];

  @Column({ name: 'blocked_countries', type: 'text', array: true, nullable: true })
  blockedCountries?: string[];

  @Column({ name: 'data_cap_mb', nullable: true })
  dataCapMb?: number;

  @Column({ name: 'data_used_mb', type: 'decimal', precision: 10, scale: 2, default: 0 })
  dataUsedMb: number;

  @Column({ name: 'sms_enabled', default: true })
  smsEnabled: boolean;

  @Column({ name: 'voice_enabled', default: false })
  voiceEnabled: boolean;

  @Column({ name: 'apn_settings', type: 'jsonb', nullable: true })
  apnSettings?: Record<string, unknown>;

  @Column({ default: 'active' })
  status: 'active' | 'suspended' | 'deactivated' | 'swapped';

  @Column({ name: 'activated_at', type: 'timestamp', nullable: true })
  activatedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
