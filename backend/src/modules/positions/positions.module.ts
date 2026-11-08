import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Position } from '../devices/entities/position.entity';
import { Device } from '../devices/entities/device.entity';
import { PositionsController } from './positions.controller';
import { PositionsService } from './positions.service';
import { PositionsGateway } from './gateways/positions.gateway';
import { PositionProcessor } from './processors/position.processor';
import { DevicesModule } from '../devices/devices.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Position], 'timescale'),
    TypeOrmModule.forFeature([Device]),
    DevicesModule, // for DevicesGateway (broadcast) - DevicesModule exports it
  ],
  controllers: [PositionsController],
  providers: [PositionsService, PositionsGateway, PositionProcessor],
  exports: [PositionsService],
})
export class PositionsModule {}
