import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum HubStatus { PILOT = 'pilot', ACTIVE = 'active', CLOSED = 'closed' }

@Entity('hubs')
export class Hub {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'organization_id' }) organizationId: string;
  @Column() name: string;
  @Column() region: string;
  @Column({ type: 'varchar', nullable: true }) town?: string | null;
  @Column({ type: 'varchar', nullable: true }) assembly?: string | null;
  @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true, transformer: { to: (v: any) => v, from: (v: any) => (v == null ? v : Number(v)) } }) latitude?: number | null;
  @Column({ type: 'decimal', precision: 11, scale: 8, nullable: true, transformer: { to: (v: any) => v, from: (v: any) => (v == null ? v : Number(v)) } }) longitude?: number | null;
  @Column({ name: 'grace_period_hours', type: 'int', nullable: true }) gracePeriodHours?: number | null;
  @Column({ name: 'manager_user_id', type: 'uuid', nullable: true }) managerUserId?: string | null;
  @Column({ type: 'varchar', default: HubStatus.PILOT }) status: HubStatus;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}

export enum PowerSource { GRID = 'grid', SOLAR = 'solar' }

@Entity('charge_points')
export class ChargePoint {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'organization_id' }) organizationId: string;
  @Column({ name: 'hub_id' }) hubId: string;
  @Column() name: string;
  @Column({ name: 'power_source', type: 'varchar', default: PowerSource.GRID }) powerSource: PowerSource;
  @Column({ type: 'varchar', default: 'active' }) status: 'active' | 'faulty' | 'offline';
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
