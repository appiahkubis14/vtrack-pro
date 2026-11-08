import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  client: Redis;
  pubClient: Redis;
  subClient: Redis;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const opts = {
      host: this.config.get<string>('redis.host'),
      port: this.config.get<number>('redis.port'),
      password: this.config.get<string>('redis.password'),
    };
    this.client = new Redis(opts);
    // Separate pub/sub clients, as ioredis requires once a connection enters
    // subscriber mode - used by the Socket.IO Redis adapter (see below).
    this.pubClient = new Redis(opts);
    this.subClient = new Redis(opts);
  }

  onModuleDestroy() {
    this.client?.disconnect();
    this.pubClient?.disconnect();
    this.subClient?.disconnect();
  }
}
