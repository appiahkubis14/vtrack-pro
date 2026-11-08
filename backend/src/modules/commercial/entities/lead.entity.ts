import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum LeadStatus {
  NEW = 'new',
  CONTACTED = 'contacted',
  QUALIFIED = 'qualified',
  QUOTE_SENT = 'quote_sent',
  NEGOTIATING = 'negotiating',
  WON = 'won',
  LOST = 'lost',
  ARCHIVED = 'archived',
}

@Entity('leads')
export class Lead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'contact_name' })
  contactName: string;

  @Column({ name: 'company_name', nullable: true })
  companyName?: string;

  @Column({ nullable: true })
  phone?: string;

  @Column({ nullable: true })
  email?: string;

  @Column({ name: 'whatsapp_number', nullable: true })
  whatsappNumber?: string;

  @Column({ nullable: true })
  country?: string;

  @Column({ nullable: true })
  city?: string;

  @Column({ name: 'fleet_size', nullable: true })
  fleetSize?: number;

  @Column({ name: 'product_interest_id', nullable: true })
  productInterestId?: string;

  @Column({ type: 'text', nullable: true })
  message?: string;

  @Column({ name: 'source_channel', nullable: true })
  sourceChannel?: string;

  @Column({ name: 'campaign_source_id', nullable: true })
  campaignSourceId?: string;

  @Column({ name: 'preferred_language', default: 'en' })
  preferredLanguage: string;

  @Column({ name: 'consent_to_contact', default: false })
  consentToContact: boolean;

  @Column({ type: 'varchar', length: 20, default: LeadStatus.NEW })
  status: LeadStatus;

  @Column({ name: 'assigned_to', nullable: true })
  assignedTo?: string;

  @Column({ name: 'converted_organization_id', nullable: true })
  convertedOrganizationId?: string;

  @Column({ name: 'lost_reason', nullable: true })
  lostReason?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
