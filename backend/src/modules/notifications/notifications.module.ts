import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { EmailChannel } from './channels/email.channel';
import { SmsChannel } from './channels/sms.channel';
import { PushChannel } from './channels/push.channel';
import { WebhookChannel } from './channels/webhook.channel';
import { ChannelFactory } from './channels/channel.factory';

@Module({
  imports: [TypeOrmModule.forFeature([Notification])],
  controllers: [NotificationsController],
  providers: [NotificationsService, EmailChannel, SmsChannel, PushChannel, WebhookChannel, ChannelFactory],
  exports: [NotificationsService, ChannelFactory, SmsChannel],
})
export class NotificationsModule {}
