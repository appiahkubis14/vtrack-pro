import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from './entities/device.entity';
import { RawDeviceData } from './entities/raw-device-data.entity';
import { RemoteCommand } from '../commands/entities/remote-command.entity';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { DevicesGateway } from './gateways/devices.gateway';
import { DeviceTcpService } from './tcp/device-tcp.service';
import { ProtocolFactory } from './processors/protocol.factory';
import { GT06Processor } from './processors/gt06.processor';
import { TK103Processor } from './processors/tk103.processor';
import { TeltonikaProcessor } from './processors/teltonika.processor';
import { AuthModule } from '../auth/auth.module';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  imports: [TypeOrmModule.forFeature([Device, RawDeviceData, RemoteCommand]), AuthModule, OrganizationsModule],
  controllers: [DevicesController],
  providers: [
    DevicesService,
    DevicesGateway,
    DeviceTcpService,
    ProtocolFactory,
    GT06Processor,
    TK103Processor,
    TeltonikaProcessor,
  ],
  exports: [DevicesService, DevicesGateway, DeviceTcpService],
})
export class DevicesModule {}
