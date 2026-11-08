import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A live rider<->vehicle binding, established either by an NFC tap or a
 * successful BLE handshake from the rider's phone. This is the record
 * checked before allowing "battery unlocked"/ignition-on state - no active,
 * unexpired session means no unlock, regardless of what the tracker itself
 * reports.
 */
@Entity('rider_sessions')
export class RiderSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'rider_id' })
  riderId: string;

  @Column({ name: 'vehicle_id' })
  vehicleId: string;

  @Column({ name: 'device_id' })
  deviceId: string;

  @Column({ name: 'auth_method', type: 'varchar', length: 20 })
  authMethod: string;

  @Column({ name: 'session_token', unique: true })
  sessionToken: string; // opaque token, rotated per JWT-refresh conventions already used elsewhere in the app

  @Column({ name: 'started_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  startedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt: Date;

  @Column({ name: 'ended_at', type: 'timestamp', nullable: true })
  endedAt?: Date;

  @Column({ name: 'end_reason', nullable: true })
  endReason?: string; // 'expired'|'manual_logout'|'unauthorized_removal_detected'|'vehicle_reassigned'

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
