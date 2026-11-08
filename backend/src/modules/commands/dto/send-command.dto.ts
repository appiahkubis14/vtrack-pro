import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class DeviceTargetDto {
  @ApiProperty({ description: 'Single device to target' })
  @IsOptional()
  @IsString()
  deviceId?: string;

  @ApiProperty({ required: false, description: 'Multiple devices - batch command' })
  @IsOptional()
  @IsArray()
  deviceIds?: string[];

  @ApiProperty({ required: false, description: 'ISO timestamp - schedule for later' })
  @IsOptional()
  @IsString()
  scheduledFor?: string;
}
