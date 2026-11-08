import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RemoteCommand } from './entities/remote-command.entity';
import { DeviceCommandLog } from './entities/device-command-log.entity';
import { SmsWakeupLog } from './entities/sms-wakeup-log.entity';
import { Device } from '../devices/entities/device.entity';
import { CommandsController } from './commands.controller';
import { CommandsService } from './commands.service';
import { CommandsGateway } from './gateways/commands.gateway';
import { CommandQueueProcessor } from './processors/command-queue.processor';
import { SmsWakeupService } from './engines/sms-wakeup.service';
import { DevicesModule } from '../devices/devices.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RemoteCommand, DeviceCommandLog, SmsWakeupLog, Device]),
    BullModule.registerQueue({ name: 'device-commands' }),
    DevicesModule,
    NotificationsModule,
  ],
  controllers: [CommandsController],
  providers: [CommandsService, CommandsGateway, CommandQueueProcessor, SmsWakeupService],
  exports: [CommandsService],
})
export class CommandsModule {}
