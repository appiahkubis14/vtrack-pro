import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;

  @ApiProperty()
  @IsString()
  firstName: string;

  @ApiProperty()
  @IsString()
  lastName: string;

  @ApiProperty({ required: false, description: 'Omit to create a new organization for this user' })
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiProperty({ required: false, description: 'Required when organizationId is omitted' })
  @IsOptional()
  @IsString()
  organizationName?: string;
}
