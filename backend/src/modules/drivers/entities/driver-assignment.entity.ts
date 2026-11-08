import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('driver_assignments')
export class DriverAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'driver_id' })
  driverId: string;

  @Column({ name: 'vehicle_id' })
  vehicleId: string;

  @Column({ name: 'assigned_by', nullable: true })
  assignedBy?: string;

  @CreateDateColumn({ name: 'assigned_at' })
  assignedAt: Date;

  @Column({ name: 'unassigned_at', type: 'timestamp', nullable: true })
  unassignedAt?: Date;

  @Column({ type: 'text', nullable: true })
  notes?: string;
}
