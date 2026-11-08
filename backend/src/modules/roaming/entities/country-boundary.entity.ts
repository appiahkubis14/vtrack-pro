import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('country_boundaries')
export class CountryBoundary {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'country_code', unique: true })
  countryCode: string;

  @Column({ name: 'country_name' })
  countryName: string;

  // Geometry not mapped as a TS-usable column - all boundary queries go
  // through raw SQL (see border-crossing.engine.ts) since TypeORM's spatial
  // type support doesn't round-trip GEOGRAPHY(MULTIPOLYGON) cleanly.
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
