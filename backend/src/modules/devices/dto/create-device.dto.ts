import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { DeviceProtocol } from '../entities/device.entity';

export class CreateDeviceDto {
  @ApiProperty()
  @IsString()
  imei: string;

  @ApiProperty({ enum: DeviceProtocol })
  @IsEnum(DeviceProtocol)
  protocol: DeviceProtocol;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiProperty({ required: false, description: 'Vehicle to attach this device to' })
  @IsOptional()
  @IsString()
  vehicleId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  simNumber?: string;
}
