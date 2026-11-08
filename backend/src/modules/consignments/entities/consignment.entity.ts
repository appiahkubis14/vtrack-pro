import { Column, CreateDateColumn, Entity, OneToMany, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { pesewasTransformer } from '../../../common/money/money';
import { ConsignmentStatus } from '../../../common/lifecycle/transitions';
import { VehicleModel } from './vehicle-model.entity';

@Entity('consignments')
export class Consignment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'organization_id' }) organizationId: string;
  @Column() reference: string;
  @Column({ name: 'supplier_name', type: 'varchar', nullable: true }) supplierName?: string | null;
  @Column({ name: 'supplier_country', type: 'varchar', nullable: true }) supplierCountry?: string | null;
  @Column({ name: 'supplier_id', type: 'uuid', nullable: true }) supplierId?: string | null;
  @Column({ name: 'container_no', type: 'varchar', nullable: true }) containerNo?: string | null;
  @Column({ name: 'bl_number', type: 'varchar', nullable: true }) blNumber?: string | null;
  @Column({ type: 'varchar', default: ConsignmentStatus.ORDERED }) status: ConsignmentStatus;
  @Column({ name: 'shipped_at', type: 'date', nullable: true }) shippedAt?: string | null;
  @Column({ name: 'arrived_at', type: 'date', nullable: true }) arrivedAt?: string | null;
  @Column({ name: 'cleared_at', type: 'date', nullable: true }) clearedAt?: string | null;
  @Column({ name: 'received_at', type: 'date', nullable: true }) receivedAt?: string | null;
  @Column({ name: 'closed_at', type: 'date', nullable: true }) closedAt?: string | null;
  @Column({ name: 'landed_cost_pesewas', type: 'bigint', transformer: pesewasTransformer, default: 0 }) landedCostPesewas: number;
  @Column({ type: 'text', nullable: true }) notes?: string | null;
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy?: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
  @OneToMany(() => ConsignmentLine, (l) => l.consignment) lines?: ConsignmentLine[];
}

@Entity('consignment_lines')
export class ConsignmentLine {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'consignment_id' }) consignmentId: string;
  @ManyToOne(() => Consignment, (c) => c.lines, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'consignment_id' }) consignment?: Consignment;
  @Column({ name: 'vehicle_model_id' }) vehicleModelId: string;
  @ManyToOne(() => VehicleModel) @JoinColumn({ name: 'vehicle_model_id' }) vehicleModel?: VehicleModel;
  @Column() quantity: number;
  @Column({ name: 'unit_cost_pesewas', type: 'bigint', transformer: pesewasTransformer, default: 0 }) unitCostPesewas: number;
  @Column({ name: 'units_registered', default: 0 }) unitsRegistered: number;
  @Column({ name: 'units_written_off', default: 0 }) unitsWrittenOff: number;
}
