import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

/**
 * Thin facade over the app's BullMQ queues so callers don't need to
 * @InjectQueue() every queue name individually. Register additional queues
 * here (and in their owning module via BullModule.registerQueue) as they're
 * added - 'device-commands' (commands.module.ts) is the first.
 */
@Injectable()
export class QueueService {
  constructor(@InjectQueue('device-commands') private readonly deviceCommands: Queue) {}

  get commands(): Queue {
    return this.deviceCommands;
  }
}
