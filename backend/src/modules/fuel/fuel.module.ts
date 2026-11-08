import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from '../devices/entities/device.entity';
import { FuelController } from './fuel.controller';
import { FuelService } from './fuel.service';
import { FuelCalculatorProcessor } from './processors/fuel-calculator.processor';
import { TheftDetectionProcessor } from './processors/theft-detection.processor';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [TypeOrmModule.forFeature([Device]), AlertsModule],
  controllers: [FuelController],
  providers: [FuelService, FuelCalculatorProcessor, TheftDetectionProcessor],
  exports: [FuelService],
})
export class FuelModule {}
