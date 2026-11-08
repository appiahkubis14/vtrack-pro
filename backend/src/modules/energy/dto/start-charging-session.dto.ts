import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

export class StartChargingSessionDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  deviceId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  startSoc?: number;

  @ApiProperty({ required: false, enum: ['AC', 'DC'] })
  @IsOptional()
  @IsIn(['AC', 'DC'])
  chargingType?: 'AC' | 'DC';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  chargerLocation?: string;
}
