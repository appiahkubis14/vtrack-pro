import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WakeSleepEngine } from './engines/wake-sleep.engine';

@Injectable()
export class WakeSleepScheduler {
  constructor(private readonly wakeSleepEngine: WakeSleepEngine) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweep() {
    await this.wakeSleepEngine.sweepForSleepingDevices();
  }
}
