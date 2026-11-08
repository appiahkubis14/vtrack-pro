import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mqtt from 'mqtt';

/**
 * Bridges to an MQTT broker for IoT-style device/command traffic, distinct
 * from the raw TCP servers in devices/tcp/device-tcp.service.ts (which speak
 * device-native binary protocols directly). Use this for devices/gateways
 * that support MQTT natively, or for internal service-to-service pub/sub.
 */
@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private client: mqtt.MqttClient;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.client = mqtt.connect(this.config.get<string>('mqtt.brokerUrl') ?? 'mqtt://localhost:1883', {
      clientId: this.config.get<string>('mqtt.clientId') ?? 'vtrack-backend',
      reconnectPeriod: 5000,
    });

    this.client.on('connect', () => this.logger.log('Connected to MQTT broker'));
    this.client.on('error', (err) => this.logger.warn(`MQTT error: ${err.message}`));
  }

  onModuleDestroy() {
    this.client?.end();
  }

  publish(topic: string, payload: Record<string, unknown> | string) {
    const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.client.publish(topic, message, { qos: 1 });
  }

  subscribe(topic: string, handler: (payload: Buffer) => void) {
    this.client.subscribe(topic, { qos: 1 });
    this.client.on('message', (receivedTopic, message) => {
      if (receivedTopic === topic) handler(message);
    });
  }
}
