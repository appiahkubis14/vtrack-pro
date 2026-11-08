import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Installment, SaleContract } from './entities/sale-contract.entity';
import { Owner } from './entities/owner.entity';
import { HubsModule } from '../hubs/hubs.module';
import { FinanceModule } from '../finance/finance.module';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { OwnersService } from './owners.service';

@Module({
  imports: [TypeOrmModule.forFeature([SaleContract, Installment, Owner]), HubsModule, FinanceModule],
  controllers: [ContractsController],
  providers: [ContractsService, OwnersService],
  exports: [ContractsService, OwnersService],
})
export class ContractsModule {}
