import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('campaign_sources')
export class CampaignSource {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ name: 'utm_source', nullable: true })
  utmSource?: string;

  @Column({ name: 'utm_medium', nullable: true })
  utmMedium?: string;

  @Column({ name: 'utm_campaign', nullable: true })
  utmCampaign?: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
