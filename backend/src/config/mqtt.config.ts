import { registerAs } from '@nestjs/config';

export default registerAs('mqtt', () => ({
  brokerUrl: process.env.MQTT_BROKER_URL ?? 'mqtt://localhost:1883',
  clientId: process.env.MQTT_CLIENT_ID ?? 'vtrack-backend',
}));
