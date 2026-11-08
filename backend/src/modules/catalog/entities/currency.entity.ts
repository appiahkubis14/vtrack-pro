import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('currencies')
export class Currency {
  @PrimaryColumn({ type: 'varchar', length: 3 })
  code: string;

  @Column()
  name: string;

  @Column()
  symbol: string;

  @Column({ name: 'decimal_places', default: 2 })
  decimalPlaces: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
