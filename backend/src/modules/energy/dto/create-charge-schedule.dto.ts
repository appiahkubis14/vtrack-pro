import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsDateString, IsNumber, IsOptional } from 'class-validator';

export class CreateChargeScheduleDto {
  @ApiProperty()
  @IsNumber()
  targetSoc: number;

  @ApiProperty()
  @IsDateString()
  departureTime: string;

  @ApiProperty({ required: false, description: 'Defaults to vehicle nameplate capacity if omitted' })
  @IsOptional()
  @IsNumber()
  batteryCapacityKwh?: number;

  @ApiProperty({ required: false, default: 7.2 })
  @IsOptional()
  @IsNumber()
  chargerPowerKw?: number;

  @ApiProperty({ required: false, type: [Object] })
  @IsOptional()
  @IsArray()
  electricityPriceSchedule?: Array<{ hour: number; pricePerKwh: number }>;
}
