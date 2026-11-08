import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @InjectDataSource('timescale') private readonly timescaleDb: DataSource,
    @InjectQueue('device-commands') private readonly commandQueue: Queue,
  ) {}

  @Get()
  async check() {
    const [dbLatency, tsLatency, queueCounts] = await Promise.all([
      this.timed(() => this.db.query('SELECT 1')),
      this.timed(() => this.timescaleDb.query('SELECT 1')),
      this.commandQueue.getJobCounts(),
    ]);

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      services: {
        database: { status: dbLatency.ok ? 'up' : 'down', latency: `${dbLatency.ms}ms` },
        timescale: { status: tsLatency.ok ? 'up' : 'down', latency: `${tsLatency.ms}ms` },
        queue: { status: 'up', ...queueCounts },
      },
    };
  }

  private async timed(fn: () => Promise<unknown>): Promise<{ ok: boolean; ms: number }> {
    const start = Date.now();
    try {
      await fn();
      return { ok: true, ms: Date.now() - start };
    } catch {
      return { ok: false, ms: Date.now() - start };
    }
  }
}
