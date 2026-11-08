import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organization } from './entities/organization.entity';
import { User } from '../auth/entities/user.entity';
import { Device } from '../devices/entities/device.entity';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { TenantLimitsController } from './tenant-limits.controller';
import { TenantLimitsService } from './tenant-limits.service';

@Module({
  imports: [TypeOrmModule.forFeature([Organization, User, Device])],
  controllers: [OrganizationsController, TenantLimitsController],
  providers: [OrganizationsService, TenantLimitsService],
  exports: [OrganizationsService, TenantLimitsService],
})
export class OrganizationsModule {}
