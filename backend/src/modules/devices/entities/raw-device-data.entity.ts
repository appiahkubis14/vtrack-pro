import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Raw inbound bytes/JSON per device message, kept for protocol debugging and replays. */
@Entity('raw_device_data')
export class RawDeviceData {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'device_id' })
  deviceId: string;

  @Column({ type: 'varchar', length: 50 })
  protocol: string;

  @Column({ name: 'raw_hex', type: 'text', nullable: true })
  rawHex?: string;

  @Column({ name: 'parsed_json', type: 'jsonb', nullable: true })
  parsedJson?: Record<string, unknown>;

  @Column({ name: 'ip_address', nullable: true })
  ipAddress?: string;

  @Column({ nullable: true })
  port?: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
