export interface NotificationPayload {
  to: string; // email address, phone number, device token, or webhook URL depending on channel
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationChannelHandler {
  readonly name: string;
  send(payload: NotificationPayload): Promise<{ success: boolean; error?: string }>;
}
