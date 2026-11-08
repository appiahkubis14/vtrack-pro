import { Module } from '@nestjs/common';
import { RealtimeEventsGateway } from './realtime-events.gateway';

@Module({
  providers: [RealtimeEventsGateway],
  exports: [RealtimeEventsGateway],
})
export class RealtimeModule {}
