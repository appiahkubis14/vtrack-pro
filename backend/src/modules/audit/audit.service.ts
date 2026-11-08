import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

export interface RecordAuditInput {
  organizationId?: string;
  userId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  status?: 'success' | 'failed';
  errorMessage?: string;
}

@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>) {}

  /** Called by an AuditInterceptor (see decorators/audit.decorator.ts) or directly from services. */
  record(input: RecordAuditInput) {
    return this.logs.save(this.logs.create({ status: 'success', ...input }));
  }

  findAll(query: { organizationId?: string; userId?: string; resourceType?: string; limit?: number } = {}) {
    return this.logs.find({
      where: {
        ...(query.organizationId ? { organizationId: query.organizationId } : {}),
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      },
      order: { createdAt: 'DESC' },
      take: query.limit ?? 100,
    });
  }

  async findOne(id: string) {
    const log = await this.logs.findOne({ where: { id } });
    if (!log) throw new NotFoundException(`Audit log ${id} not found`);
    return log;
  }
}
