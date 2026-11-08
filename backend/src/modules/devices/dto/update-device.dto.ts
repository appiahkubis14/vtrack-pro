import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsOptional, IsObject } from 'class-validator';
import { CreateDeviceDto } from './create-device.dto';

export class UpdateDeviceDto extends PartialType(CreateDeviceDto) {
  @ApiProperty({ required: false, description: 'Update interval, geofence defaults, etc.' })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
