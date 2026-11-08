import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('vehicle_digital_twin_snapshots')
export class DigitalTwinSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'vehicle_id' })
  vehicleId: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ type: 'jsonb' })
  state: Record<string, unknown>;

  @Column({ name: 'captured_at', type: 'timestamp' })
  capturedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
