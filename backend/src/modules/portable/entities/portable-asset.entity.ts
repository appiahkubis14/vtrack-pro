import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum AssetType {
  VEHICLE = 'vehicle',
  MOTORCYCLE = 'motorcycle',
  TRUCK = 'truck',
  TRAILER = 'trailer',
  CONTAINER = 'container',
  GENERATOR = 'generator',
  CONSTRUCTION_EQUIPMENT = 'construction_equipment',
  CARGO = 'cargo',
  PACKAGE = 'package',
  EQUIPMENT = 'equipment',
  INVESTIGATION = 'investigation',
}

export enum PortableAssetStatus {
  AVAILABLE = 'available',
  DEPLOYED = 'deployed',
  MAINTENANCE = 'maintenance',
  LOST = 'lost',
  RETIRED = 'retired',
}

@Entity('portable_assets')
export class PortableAsset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'device_id', nullable: true })
  deviceId?: string;

  @Column({ name: 'asset_type', type: 'varchar', length: 30 })
  assetType: AssetType;

  @Column({ name: 'asset_name' })
  assetName: string;

  @Column({ name: 'asset_identifier', nullable: true })
  assetIdentifier?: string;

  @Column({ name: 'is_battery_powered', default: true })
  isBatteryPowered: boolean;

  @Column({ name: 'is_magnetic_casing', default: false })
  isMagneticCasing: boolean;

  @Column({ name: 'ip_rating', nullable: true })
  ipRating?: string;

  @Column({ name: 'is_covert_capable', default: false })
  isCovertCapable: boolean;

  @Column({ name: 'current_power_profile', default: 'interval_5m' })
  currentPowerProfile: string;

  @Column({ name: 'qr_activation_code', unique: true, nullable: true })
  qrActivationCode?: string;

  @Column({ type: 'varchar', length: 20, default: PortableAssetStatus.AVAILABLE })
  status: PortableAssetStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
