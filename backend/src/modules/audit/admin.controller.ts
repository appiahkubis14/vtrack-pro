import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/constants/roles.constant';
import { User } from '../auth/entities/user.entity';
import { AuditService } from './audit.service';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly auditService: AuditService,
  ) {}

  @Get('system-health')
  @ApiOperation({ summary: 'Database + overall system health (lighter version of GET /health)' })
  async systemHealth() {
    const start = Date.now();
    let dbStatus: 'up' | 'down' = 'up';
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      dbStatus = 'down';
    }
    return {
      status: dbStatus === 'up' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: { database: { status: dbStatus, latency: `${Date.now() - start}ms` } },
    };
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Prometheus-style metrics summary (see /metrics for the scrape endpoint)' })
  metrics() {
    // TODO: wire an actual Prometheus registry (prom-client) and expose it at
    // GET /metrics via a dedicated controller excluded from the API prefix,
    // per the doc's "GET /metrics ... Returns Prometheus metrics" spec.
    return { note: 'Attach prom-client and expose a plaintext /metrics endpoint outside the API prefix.' };
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'Alias for GET /audit/logs, kept for spec parity' })
  auditLogs() {
    return this.auditService.findAll();
  }

  @Get('users')
  @ApiOperation({ summary: 'List all users across the platform (super admin only)' })
  users_() {
    return this.users.find({ order: { createdAt: 'DESC' }, take: 200 });
  }

  @Put('users/:id/role')
  @ApiOperation({ summary: "Change a user's role" })
  async updateRole(@Param('id') id: string, @Body() body: { role: Role }) {
    await this.users.update(id, { role: body.role });
    return this.users.findOne({ where: { id } });
  }
}
