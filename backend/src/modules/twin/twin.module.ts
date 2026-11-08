import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DigitalTwinSnapshot } from './entities/digital-twin-snapshot.entity';
import { DigitalTwinService } from './digital-twin.service';
import { DigitalTwinGateway } from './digital-twin.gateway';
import { DigitalTwinController, TwinFleetController } from './digital-twin.controller';
import { TwinUpdateListener } from './twin-update.listener';
import { RedisService } from '../../services/redis.service';
import { Device } from '../devices/entities/device.entity';
import { AuthModule } from '../auth/auth.module';
import { MapModule } from '../map/map.module';

@Module({
  imports: [TypeOrmModule.forFeature([DigitalTwinSnapshot, Device]), AuthModule, MapModule],
  controllers: [DigitalTwinController, TwinFleetController],
  providers: [DigitalTwinService, DigitalTwinGateway, TwinUpdateListener, RedisService],
  exports: [DigitalTwinService, DigitalTwinGateway],
})
export class TwinModule {}
