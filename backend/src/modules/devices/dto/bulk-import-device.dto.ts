import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { CreateDeviceDto } from './create-device.dto';

export class BulkImportDeviceDto {
  @ApiProperty({ type: [CreateDeviceDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDeviceDto)
  devices: CreateDeviceDto[];
}
