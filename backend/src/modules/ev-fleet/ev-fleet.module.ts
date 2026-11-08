import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Rider } from './entities/rider.entity';
import { RiderSession } from './entities/rider-session.entity';
import { PaymentLog } from './entities/payment-log.entity';
import { ImmobilizerState } from './entities/immobilizer-state.entity';
import { Device } from '../devices/entities/device.entity';
import { WorkAndPayScheduler, WorkAndPayProcessor } from './processors/work-and-pay.processor';
import { PaymentGatewayService } from './processors/payment-gateway.service';
import { LockRequest } from './entities/lock-request.entity';
import { RiderException } from './entities/rider-exception.entity';
import { EnforcementService } from './enforcement.service';
import { EnforcementController } from './enforcement.controller';
import { HubsModule } from '../hubs/hubs.module';
import { AuditModule } from '../audit/audit.module';
import { TwinModule } from '../twin/twin.module';
import { CommandsModule } from '../commands/commands.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Rider, RiderSession, PaymentLog, ImmobilizerState, Device, LockRequest, RiderException]),
    BullModule.registerQueue({ name: 'work-and-pay' }),
    TwinModule,
    CommandsModule,
    NotificationsModule,
    HubsModule,
    AuditModule,
  ],
  controllers: [EnforcementController],
  providers: [WorkAndPayScheduler, WorkAndPayProcessor, PaymentGatewayService, EnforcementService],
  exports: [PaymentGatewayService, EnforcementService],
})
export class EvFleetModule {}
