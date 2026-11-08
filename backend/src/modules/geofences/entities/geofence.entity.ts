import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum GeofenceType {
  CIRCLE = 'circle',
  POLYGON = 'polygon',
  RECTANGLE = 'rectangle',
  ROUTE = 'route',
}

@Entity('geofences')
export class Geofence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'varchar', length: 50 })
  type: GeofenceType;

  // GEOGRAPHY(POLYGON, 4326) for `polygon`/`rectangle` types - queried via raw
  // SQL ST_Contains in geofence-checker.engine.ts. `circle` types use
  // centerLatitude/centerLongitude + radius instead (a polygon column can't
  // cleanly represent a circle), so `coordinates` is nullable for those.
  @Column({ type: 'geometry', spatialFeatureType: 'Polygon', srid: 4326, nullable: true })
  coordinates?: object;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  radius?: number;

  @Column({ name: 'center_latitude', type: 'decimal', precision: 10, scale: 8, nullable: true })
  centerLatitude?: number;

  @Column({ name: 'center_longitude', type: 'decimal', precision: 11, scale: 8, nullable: true })
  centerLongitude?: number;

  /** Mobile geofence: when set, a circle that follows this vehicle (its centre is the vehicle's latest position). */
  @Column({ name: 'anchor_vehicle_id', type: 'uuid', nullable: true })
  anchorVehicleId?: string | null;

  /** notify = alerts only; restricted = entering is a violation; allowed = leaving is a violation; lez = low-emission zone. */
  @Column({ type: 'varchar', length: 12, default: 'notify' })
  rule: 'notify' | 'restricted' | 'allowed' | 'lez';

  @Column({ name: 'speed_limit', nullable: true })
  speedLimit?: number;

  @Column({ type: 'jsonb', nullable: true })
  schedule?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  alerts?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  actions?: Record<string, unknown>;

  @Column({
    type: 'jsonb',
    default: {
      entryDwellSeconds: 10,
      exitDwellSeconds: 15,
      accuracyThresholdMeters: 30,
      bufferMeters: 10,
      cooldownSeconds: 300,
    },
  })
  hysteresis: {
    entryDwellSeconds: number;
    exitDwellSeconds: number;
    accuracyThresholdMeters: number;
    bufferMeters: number;
    cooldownSeconds: number;
  };

  @Column({ default: '#FF0000' })
  color: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'created_by', nullable: true })
  createdBy?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date;
}
