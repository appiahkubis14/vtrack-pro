import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationChannelHandler, NotificationPayload } from './notification-channel.interface';

@Injectable()
export class SmsChannel implements NotificationChannelHandler {
  readonly name = 'sms';
  private readonly logger = new Logger(SmsChannel.name);

  constructor(private readonly config: ConfigService) {}

  async send(payload: NotificationPayload) {
    const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN');

    if (!accountSid || !authToken) {
      this.logger.warn('Twilio not configured - falling back would go to Africa\'s Talking here');
      return { success: false, error: 'SMS provider not configured' };
    }

    try {
      // Lazy import so the twilio SDK isn't required unless SMS is actually used.
      const twilio = (await import('twilio')).default(accountSid, authToken);
      await twilio.messages.create({
        to: payload.to,
        from: this.config.get<string>('TWILIO_FROM_NUMBER'),
        body: `${payload.title}: ${payload.body}`,
      });
      return { success: true };
    } catch (err) {
      this.logger.warn(`SMS send failed: ${(err as Error).message}`);
      // TODO: fall back to Africa's Talking (AFRICAS_TALKING_API_KEY) on Twilio failure.
      return { success: false, error: (err as Error).message };
    }
  }
}
