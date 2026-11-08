import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TravelCorridor } from './entities/travel-corridor.entity';
import { CorridorEvent } from './entities/corridor-event.entity';
import { BorderCrossing } from './entities/border-crossing.entity';

@Injectable()
export class CorridorsService {
  constructor(
    @InjectRepository(TravelCorridor) private readonly corridors: Repository<TravelCorridor>,
    @InjectRepository(CorridorEvent) private readonly corridorEvents: Repository<CorridorEvent>,
    @InjectRepository(BorderCrossing) private readonly crossings: Repository<BorderCrossing>,
  ) {}

  findAll(organizationId?: string) {
    return this.corridors.find({
      where: organizationId ? { organizationId } : {},
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string) {
    const corridor = await this.corridors.findOne({ where: { id } });
    if (!corridor) throw new NotFoundException(`Travel corridor ${id} not found`);
    return corridor;
  }

  create(body: Partial<TravelCorridor> & { organizationId: string }) {
    return this.corridors.save(this.corridors.create(body));
  }

  events(corridorId: string, limit = 100) {
    return this.corridorEvents.find({ where: { corridorId }, order: { timestamp: 'DESC' }, take: limit });
  }

  listBorderCrossings(query: { deviceId?: string; limit?: number } = {}) {
    return this.crossings.find({
      where: query.deviceId ? { deviceId: query.deviceId } : {},
      order: { crossedAt: 'DESC' },
      take: query.limit ?? 100,
    });
  }
}
