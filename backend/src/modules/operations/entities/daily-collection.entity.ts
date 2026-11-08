import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { pesewasTransformer } from '../../../common/money/money';

@Entity('daily_collections')
export class DailyCollection {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'organization_id' }) organizationId: string;
  @Column({ name: 'hub_id' }) hubId: string;
  @Column({ name: 'rider_id' }) riderId: string;
  @Column({ name: 'vehicle_id' }) vehicleId: string;
  @Column({ name: 'collection_date', type: 'date' }) collectionDate: string;
  @Column({ name: 'amount_pesewas', type: 'bigint', transformer: pesewasTransformer }) amountPesewas: number;
  @Column({ type: 'varchar', default: 'cash' }) source: 'cash' | 'momo' | 'other';
  @Column({ type: 'varchar', nullable: true }) reference?: string | null;
  @Column({ name: 'recorded_by', type: 'uuid', nullable: true }) recordedBy?: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
