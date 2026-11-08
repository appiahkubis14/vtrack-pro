import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { pesewasTransformer } from '../../../common/money/money';

export enum VehicleType { EBIKE = 'ebike', TRIKE_PASSENGER = 'trike_passenger', TRIKE_GOODS = 'trike_goods', TRIKE_WASTE = 'trike_waste' }

@Entity('vehicle_models')
export class VehicleModel {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'organization_id' }) organizationId: string;
  @Column() brand: string;
  @Column() name: string;
  @Column({ name: 'vehicle_type', type: 'varchar' }) vehicleType: VehicleType;
  @Column({ name: 'battery_spec', type: 'varchar', nullable: true }) batterySpec?: string | null;
  @Column({ name: 'list_price_pesewas', type: 'bigint', transformer: pesewasTransformer, default: 0 }) listPricePesewas: number;
  @Column({ name: 'is_active', default: true }) isActive: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
