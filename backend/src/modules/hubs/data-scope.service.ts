import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Hub } from './entities/hub.entity';
import { Owner } from '../contracts/entities/owner.entity';
import { AuthUser } from '../../common/auth/auth-user';
import { Role } from '../../common/constants/roles.constant';

/**
 * Row-level access (rules BR11/BR12): decides which hubs and owners a user may see.
 *  - admins, finance, fleet managers, auditors, dispatchers: everything in their organization
 *  - hub managers: only the hub(s) they manage
 *  - investors: only the owner record(s) linked to their login
 */
export interface DataScope {
  all: boolean;
  hubIds: string[];
  ownerIds: string[];
  role: Role;
}

@Injectable()
export class DataScopeService {
  constructor(
    @InjectRepository(Hub) private readonly hubs: Repository<Hub>,
    @InjectRepository(Owner) private readonly owners: Repository<Owner>,
  ) {}

  async forUser(user: AuthUser): Promise<DataScope> {
    const base = { hubIds: [] as string[], ownerIds: [] as string[], role: user.role };
    switch (user.role) {
      case Role.HUB_MANAGER: {
        const hubs = await this.hubs.find({ where: { organizationId: user.organizationId, managerUserId: user.sub }, select: ['id'] });
        return { ...base, all: false, hubIds: hubs.map((h) => h.id) };
      }
      case Role.INVESTOR: {
        const owners = await this.owners.find({ where: { organizationId: user.organizationId, userId: user.sub }, select: ['id'] });
        return { ...base, all: false, ownerIds: owners.map((o) => o.id) };
      }
      case Role.RIDER:
      case Role.DRIVER:
      case Role.VIEWER:
        return { ...base, all: false };
      default:
        return { ...base, all: true };
    }
  }

  assertHub(scope: DataScope, hubId: string): void {
    if (scope.all) return;
    if (!scope.hubIds.includes(hubId)) throw new ForbiddenException('You do not have access to this hub');
  }

  assertOwner(scope: DataScope, ownerId: string): void {
    if (scope.all) return;
    if (!scope.ownerIds.includes(ownerId)) throw new ForbiddenException('You do not have access to this owner');
  }
}
