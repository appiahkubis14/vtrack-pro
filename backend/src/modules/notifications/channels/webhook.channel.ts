import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannelHandler, NotificationPayload } from './notification-channel.interface';

const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = [1000, 5000, 15000];

@Injectable()
export class WebhookChannel implements NotificationChannelHandler {
  readonly name = 'webhook';
  private readonly logger = new Logger(WebhookChannel.name);

  async send(payload: NotificationPayload) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(payload.to, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: payload.title, body: payload.body, metadata: payload.metadata }),
        });
        if (res.ok) return { success: true };
        throw new Error(`Webhook responded with ${res.status}`);
      } catch (err) {
        if (attempt === MAX_RETRIES) {
          this.logger.warn(`Webhook delivery failed after ${MAX_RETRIES} retries: ${(err as Error).message}`);
          return { success: false, error: (err as Error).message };
        }
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt] ?? 15000));
      }
    }
    return { success: false, error: 'unreachable' };
  }
}
