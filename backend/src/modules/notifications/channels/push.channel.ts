import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationChannelHandler, NotificationPayload } from './notification-channel.interface';

@Injectable()
export class PushChannel implements NotificationChannelHandler {
  readonly name = 'push';
  private readonly logger = new Logger(PushChannel.name);
  private initialized = false;

  constructor(private readonly config: ConfigService) {}

  private async ensureInitialized() {
    if (this.initialized) return;
    const admin = await import('firebase-admin');
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: this.config.get<string>('FCM_PROJECT_ID'),
          clientEmail: this.config.get<string>('FCM_CLIENT_EMAIL'),
          privateKey: this.config.get<string>('FCM_PRIVATE_KEY')?.replace(/\\n/g, '\n'),
        }),
      });
    }
    this.initialized = true;
  }

  async send(payload: NotificationPayload) {
    try {
      await this.ensureInitialized();
      const admin = await import('firebase-admin');
      await admin.messaging().send({
        token: payload.to, // FCM device token
        notification: { title: payload.title, body: payload.body },
        data: (payload.metadata as Record<string, string>) ?? {},
      });
      return { success: true };
    } catch (err) {
      this.logger.warn(`Push send failed: ${(err as Error).message}`);
      return { success: false, error: (err as Error).message };
    }
  }
}
