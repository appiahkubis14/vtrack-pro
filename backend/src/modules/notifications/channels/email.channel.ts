import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { NotificationChannelHandler, NotificationPayload } from './notification-channel.interface';

@Injectable()
export class EmailChannel implements NotificationChannelHandler {
  readonly name = 'email';
  private readonly logger = new Logger(EmailChannel.name);
  private transporter: nodemailer.Transporter;

  constructor(private readonly config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: this.config.get<number>('SMTP_PORT') ?? 587,
      auth: { user: this.config.get<string>('SMTP_USER'), pass: this.config.get<string>('SMTP_PASSWORD') },
    });
    // TODO: swap to @sendgrid/mail as a fallback transport when SMTP delivery fails,
    // per the spec's "Nodemailer + SendGrid (fallback)" requirement.
  }

  async send(payload: NotificationPayload) {
    try {
      await this.transporter.sendMail({
        from: this.config.get<string>('EMAIL_FROM'),
        to: payload.to,
        subject: payload.title,
        text: payload.body,
      });
      return { success: true };
    } catch (err) {
      this.logger.warn(`Email send failed: ${(err as Error).message}`);
      return { success: false, error: (err as Error).message };
    }
  }
}
