import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';

export class SendDeviceCommandDto {
  @ApiProperty({ example: 'engine_stop' })
  @IsString()
  command: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;

  @ApiProperty({ required: false, description: 'ISO timestamp - schedule for later instead of sending now' })
  @IsOptional()
  @IsString()
  scheduledFor?: string;
}
