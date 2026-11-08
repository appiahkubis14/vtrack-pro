import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * IMPORTANT: this entity is registered against the `timescale` connection
 * (see app.module.ts -> TypeOrmModule.forRootAsync({ name: 'timescale', ... }))
 * and its underlying table is converted to a hypertable by migration
 * 1700000003000-CreatePositionsHypertable.ts. Inject it with:
 *   @InjectRepository(Position, 'timescale') private positions: Repository<Position>
 *
 * Note: TimescaleDB requires the partitioning column ("timestamp") to be part
 * of the table's primary key, so the actual DB schema uses a composite
 * PRIMARY KEY (id, timestamp) even though this entity only declares `id` as
 * @PrimaryGeneratedColumn. That's fine for this table's append-only,
 * insert-and-query-by-range usage - just don't rely on `id` alone being
 * enough for a raw SQL UPDATE/DELETE WHERE clause.
 */
@Entity('positions')
export class Position {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'device_id' })
  deviceId: string;

  @Column({ type: 'decimal', precision: 10, scale: 8 })
  latitude: number;

  @Column({ type: 'decimal', precision: 11, scale: 8 })
  longitude: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  altitude?: number;

  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  speed?: number;

  @Column({ nullable: true })
  heading?: number;

  @Column({ nullable: true })
  accuracy?: number;

  @Column({ name: 'fuel_level', type: 'decimal', precision: 6, scale: 2, nullable: true })
  fuelLevel?: number;

  @Column({ name: 'fuel_consumption', type: 'decimal', precision: 10, scale: 3, nullable: true })
  fuelConsumption?: number;

  @Column({ name: 'engine_hours', type: 'decimal', precision: 10, scale: 2, nullable: true })
  engineHours?: number;

  @Column({ default: false })
  ignition: boolean;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  odometer?: number;

  @Column({ name: 'obd_data', type: 'jsonb', nullable: true })
  obdData?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  sensors?: Record<string, unknown>;

  @Column({ nullable: true })
  satellites?: number;

  @Column({ type: 'decimal', precision: 4, scale: 2, nullable: true })
  hdop?: number;

  @Column({ name: 'event_type', nullable: true })
  eventType?: string;

  @Column({ name: 'raw_data', type: 'text', nullable: true })
  rawData?: string;

  @Column({ type: 'timestamp' })
  timestamp: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
