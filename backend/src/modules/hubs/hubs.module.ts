import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChargePoint, Hub } from './entities/hub.entity';
import { Owner } from '../contracts/entities/owner.entity';
import { User } from '../auth/entities/user.entity';
import { DataScopeService } from './data-scope.service';
import { HubsController } from './hubs.controller';
import { HubsService } from './hubs.service';

@Module({
  imports: [TypeOrmModule.forFeature([Hub, ChargePoint, Owner, User])],
  controllers: [HubsController],
  providers: [HubsService, DataScopeService],
  exports: [HubsService, DataScopeService, TypeOrmModule],
})
export class HubsModule {}
