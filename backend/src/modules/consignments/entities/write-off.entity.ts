import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Units lost, damaged or retired. A reason is mandatory (BR14). */
@Entity('write_offs')
export class WriteOff {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'organization_id' }) organizationId: string;
  @Column({ name: 'consignment_line_id', type: 'uuid', nullable: true }) consignmentLineId?: string | null;
  @Column({ name: 'vehicle_id', type: 'uuid', nullable: true }) vehicleId?: string | null;
  @Column({ default: 1 }) units: number;
  @Column({ type: 'text' }) reason: string;
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy?: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
