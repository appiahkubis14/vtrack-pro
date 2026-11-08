import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { DeviceRole } from '../entities/device-role.constant';

export class AssignDeviceRoleDto {
  @ApiProperty()
  @IsString()
  deviceId: string;

  @ApiProperty({ enum: DeviceRole })
  @IsEnum(DeviceRole)
  role: DeviceRole;

  @ApiProperty({ required: false, minimum: 0, maximum: 100, default: 50 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  trustLevel?: number;
}
