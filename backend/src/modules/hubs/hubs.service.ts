import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ChargePoint, Hub, HubStatus, PowerSource } from './entities/hub.entity';
import { DataScope } from './data-scope.service';
import { User } from '../auth/entities/user.entity';
import { Role } from '../../common/constants/roles.constant';

export interface HubInput {
  name?: string; region?: string; town?: string; assembly?: string;
  latitude?: number; longitude?: number; status?: HubStatus; managerUserId?: string | null; gracePeriodHours?: number | null;
}

@Injectable()
export class HubsService {
  constructor(
    @InjectRepository(Hub) private readonly hubs: Repository<Hub>,
    @InjectRepository(ChargePoint) private readonly chargePoints: Repository<ChargePoint>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  list(orgId: string, scope: DataScope) {
    if (!scope.all && scope.hubIds.length === 0) return Promise.resolve([]);
    return this.hubs.find({
      where: { organizationId: orgId, ...(scope.all ? {} : { id: In(scope.hubIds) }) },
      order: { name: 'ASC' },
    });
  }

  async get(orgId: string, id: string): Promise<Hub> {
    const hub = await this.hubs.findOne({ where: { id, organizationId: orgId } });
    if (!hub) throw new NotFoundException(`Hub ${id} not found`);
    return hub;
  }

  private assertGrace(h?: number | null) {
    if (h != null && (!Number.isInteger(h) || h < 1 || h > 168)) throw new BadRequestException('gracePeriodHours must be a whole number from 1 to 168');
  }

  async create(orgId: string, input: HubInput): Promise<Hub> {
    this.assertGrace(input.gracePeriodHours);
    if (!input.name || !input.region) throw new BadRequestException('A hub needs a name and a region');
    await this.assertManager(orgId, input.managerUserId);
    try {
      return await this.hubs.save(this.hubs.create({ ...input, organizationId: orgId, status: input.status ?? HubStatus.PILOT }));
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictException(`A hub named "${input.name}" already exists`);
      throw e;
    }
  }

  async update(orgId: string, id: string, input: HubInput): Promise<Hub> {
    const hub = await this.get(orgId, id);
    this.assertGrace(input.gracePeriodHours);
    if (input.managerUserId !== undefined) await this.assertManager(orgId, input.managerUserId);
    Object.assign(hub, input);
    return this.hubs.save(hub);
  }

  /** A hub's manager must be a real user of this organization with the hub_manager role. */
  private async assertManager(orgId: string, userId?: string | null) {
    if (!userId) return;
    const user = await this.users.findOne({ where: { id: userId, organizationId: orgId } });
    if (!user) throw new BadRequestException('Manager user not found in this organization');
    if (user.role !== Role.HUB_MANAGER) {
      throw new BadRequestException(`That user's role is "${user.role}"; a hub manager must have the role "hub_manager"`);
    }
  }

  listChargePoints(orgId: string, hubId: string) {
    return this.chargePoints.find({ where: { organizationId: orgId, hubId }, order: { name: 'ASC' } });
  }

  async addChargePoint(orgId: string, hubId: string, input: { name?: string; powerSource?: PowerSource }) {
    await this.get(orgId, hubId);
    if (!input.name) throw new BadRequestException('A charge point needs a name');
    try {
      return await this.chargePoints.save(this.chargePoints.create({ organizationId: orgId, hubId, name: input.name, powerSource: input.powerSource ?? PowerSource.GRID }));
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictException(`This hub already has a charge point named "${input.name}"`);
      throw e;
    }
  }
}
