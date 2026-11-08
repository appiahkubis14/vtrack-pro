import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Alert } from './entities/alert.entity';
import { AlertSeverity, AlertType } from '../../common/constants/alerts.constant';
import { AlertsGateway } from './gateways/alerts.gateway';

export interface CreateAlertInput {
  organizationId: string;
  deviceId?: string;
  vehicleId?: string;
  driverId?: string;
  geofenceId?: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  description?: string;
  position?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AlertsService {
  constructor(
    @InjectRepository(Alert) private readonly alerts: Repository<Alert>,
    private readonly gateway: AlertsGateway,
  ) {}

  /** Called by alert-processor.ts (rule engine) whenever a monitored condition fires. */
  async raise(input: CreateAlertInput): Promise<Alert> {
    const alert = await this.alerts.save(this.alerts.create(input));
    this.gateway.broadcastNewAlert(alert);
    // TODO: fan out through notifications module (email/sms/push/webhook/telegram/slack)
    // based on the org's per-channel + per-severity preferences.
    return alert;
  }

  findAll(query: { organizationId?: string; severity?: AlertSeverity; acknowledged?: boolean; limit?: number } = {}) {
    return this.alerts.find({
      where: {
        ...(query.organizationId ? { organizationId: query.organizationId } : {}),
        ...(query.severity ? { severity: query.severity } : {}),
        ...(query.acknowledged !== undefined ? { isAcknowledged: query.acknowledged } : {}),
      },
      order: { createdAt: 'DESC' },
      take: query.limit ?? 50,
    });
  }

  async findOne(id: string) {
    const alert = await this.alerts.findOne({ where: { id } });
    if (!alert) throw new NotFoundException(`Alert ${id} not found`);
    return alert;
  }

  async acknowledge(id: string, userId: string) {
    await this.findOne(id);
    await this.alerts.update(id, { isAcknowledged: true, acknowledgedBy: userId, acknowledgedAt: new Date() });
    const alert = await this.findOne(id);
    this.gateway.broadcastUpdate(alert);
    return alert;
  }

  async resolve(id: string, userId: string, note?: string) {
    await this.findOne(id);
    await this.alerts.update(id, {
      isResolved: true,
      resolvedBy: userId,
      resolvedAt: new Date(),
      resolutionNote: note,
    });
    const alert = await this.findOne(id);
    this.gateway.broadcastUpdate(alert);
    return alert;
  }

  // --- Alert rules -------------------------------------------------------
  // Custom user-defined rules live in a separate `alert_rules` table in a
  // full build; not modeled yet here. rule-engine.ts documents the shape
  // this would take once that table exists.

  createRule(body: any) {
    return { id: 'rule-stub', ...body, note: 'alert_rules table not yet modeled - see rule-engine.ts' };
  }

  listRules() {
    return [];
  }

  async statistics(organizationId?: string) {
    const qb = this.alerts.createQueryBuilder('a');
    if (organizationId) qb.where('a.organization_id = :organizationId', { organizationId });

    const [total, critical, unacknowledged] = await Promise.all([
      qb.clone().getCount(),
      qb.clone().andWhere('a.severity = :sev', { sev: AlertSeverity.CRITICAL }).getCount(),
      qb.clone().andWhere('a.is_acknowledged = false').getCount(),
    ]);

    return { total, critical, unacknowledged };
  }
}
