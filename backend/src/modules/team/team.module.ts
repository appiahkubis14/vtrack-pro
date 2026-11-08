import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';
import { PortalService } from './portal.service';

@Module({ imports: [FinanceModule], controllers: [TeamController], providers: [TeamService, PortalService] })
export class TeamModule {}
