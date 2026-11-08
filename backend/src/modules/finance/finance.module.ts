import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DailySettlement } from './entities/daily-settlement.entity';
import { LedgerAccount, LedgerEntry, LedgerTransaction } from './entities/ledger.entity';
import { RiderAssignment } from '../operations/entities/rider-assignment.entity';
import { HubsModule } from '../hubs/hubs.module';
import { LedgerService } from './ledger.service';
import { SettlementsService } from './settlements.service';
import { BusinessReportsService } from './business-reports.service';
import { PaymentsService } from './payments.service';
import { FinanceController } from './finance.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DailySettlement, LedgerAccount, LedgerTransaction, LedgerEntry, RiderAssignment]), HubsModule],
  controllers: [FinanceController],
  providers: [LedgerService, SettlementsService, BusinessReportsService, PaymentsService],
  exports: [LedgerService, SettlementsService, PaymentsService, BusinessReportsService],
})
export class FinanceModule {}
