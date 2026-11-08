import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('sms_wakeup_logs')
export class SmsWakeupLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'command_id' })
  commandId: string;

  @Column({ name: 'device_id' })
  deviceId: string;

  @Column({ name: 'phone_number', nullable: true })
  phoneNumber?: string;

  @Column({ name: 'wakeup_string', nullable: true })
  wakeupString?: string;

  @Column({ default: 'sent' })
  status: 'sent' | 'failed' | 'reconnected';

  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true })
  cost?: number;

  @Column({ name: 'sent_at', type: 'timestamp' })
  sentAt: Date;

  @Column({ name: 'reconnected_at', type: 'timestamp', nullable: true })
  reconnectedAt?: Date;
}
