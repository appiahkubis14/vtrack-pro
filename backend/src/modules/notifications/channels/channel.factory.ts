import { Injectable } from '@nestjs/common';
import { EmailChannel } from './email.channel';
import { SmsChannel } from './sms.channel';
import { PushChannel } from './push.channel';
import { WebhookChannel } from './webhook.channel';
import { NotificationChannelHandler } from './notification-channel.interface';
import { NotificationChannel } from '../entities/notification.entity';

@Injectable()
export class ChannelFactory {
  constructor(
    private readonly email: EmailChannel,
    private readonly sms: SmsChannel,
    private readonly push: PushChannel,
    private readonly webhook: WebhookChannel,
  ) {}

  get(channel: NotificationChannel): NotificationChannelHandler {
    switch (channel) {
      case NotificationChannel.EMAIL:
        return this.email;
      case NotificationChannel.SMS:
        return this.sms;
      case NotificationChannel.PUSH:
        return this.push;
      case NotificationChannel.WEBHOOK:
        return this.webhook;
      default:
        throw new Error(`No handler registered for channel "${channel}" (telegram/slack/inapp: see templates dir)`);
    }
  }
}
