import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('travel_corridors')
export class TravelCorridor {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column()
  name: string;

  @Column({ name: 'origin_country' })
  originCountry: string;

  @Column({ name: 'destination_country' })
  destinationCountry: string;

  @Column({ name: 'expected_countries', type: 'text', array: true })
  expectedCountries: string[];

  @Column({ name: 'max_border_dwell_minutes', default: 240 })
  maxBorderDwellMinutes: number;

  @Column({ name: 'max_transit_hours', nullable: true })
  maxTransitHours?: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
