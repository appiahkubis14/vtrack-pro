import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('product_entitlements')
export class ProductEntitlement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id' })
  productId: string;

  @Column({ name: 'variant_id', nullable: true })
  variantId?: string;

  /** e.g. 'module:portable_assets', 'module:audio', 'feature:fuel_theft_alerts' */
  @Column({ name: 'entitlement_key' })
  entitlementKey: string;

  /** boolean flag OR a limit object, e.g. {"maxDevices": 50} */
  @Column({ name: 'entitlement_value', type: 'jsonb', default: true })
  entitlementValue: boolean | Record<string, unknown>;
}
