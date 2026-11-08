import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ActivityAuditInterceptor } from './activity-audit.interceptor';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { User } from '../auth/entities/user.entity';
import { AuditController } from './audit.controller';
import { AdminController } from './admin.controller';
import { AuditService } from './audit.service';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog, User])],
  controllers: [AuditController, AdminController],
  providers: [AuditService, { provide: APP_INTERCEPTOR, useClass: ActivityAuditInterceptor }],
  exports: [AuditService],
})
export class AuditModule {}
