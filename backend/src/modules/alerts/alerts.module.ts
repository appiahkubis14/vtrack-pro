import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Alert } from './entities/alert.entity';
import { Device } from '../devices/entities/device.entity';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertsGateway } from './gateways/alerts.gateway';
import { AlertProcessor } from './processors/alert-processor';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Alert, Device]), AuthModule],
  controllers: [AlertsController],
  providers: [AlertsService, AlertsGateway, AlertProcessor],
  exports: [AlertsService, AlertsGateway],
})
export class AlertsModule {}
