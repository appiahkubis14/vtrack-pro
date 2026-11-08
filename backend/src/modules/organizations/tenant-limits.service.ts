import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Repository } from 'typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import { Device } from '../devices/entities/device.entity';
import { User } from '../auth/entities/user.entity';

@Injectable()
export class TenantLimitsService {
  private readonly logger = new Logger(TenantLimitsService.name);

  constructor(
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  /** Call before creating a new device - throws if the org is at its configured device_limit. */
  async assertCanAddDevice(organizationId: string): Promise<void> {
    const org = await this.organizations.findOne({ where: { id: organizationId } });
    if (!org?.deviceLimit) return; // no limit configured = unlimited

    const currentCount = await this.devices.count({ where: { organizationId } });
    if (currentCount >= org.deviceLimit) {
      throw new ForbiddenException(
        `Device limit reached: ${currentCount}/${org.deviceLimit}. Upgrade your subscription plan to add more devices.`,
      );
    }
  }

  /** Call before inviting/creating a new user - throws if the org is at its configured user_limit. */
  async assertCanAddUser(organizationId: string): Promise<void> {
    const org = await this.organizations.findOne({ where: { id: organizationId } });
    if (!org?.userLimit) return;

    const currentCount = await this.users.count({ where: { organizationId } });
    if (currentCount >= org.userLimit) {
      throw new ForbiddenException(`User limit reached: ${currentCount}/${org.userLimit}. Upgrade your subscription plan to add more users.`);
    }
  }

  async usage(organizationId: string) {
    const org = await this.organizations.findOne({ where: { id: organizationId } });
    const [deviceCount, userCount] = await Promise.all([
      this.devices.count({ where: { organizationId } }),
      this.users.count({ where: { organizationId } }),
    ]);

    return {
      devices: { used: deviceCount, limit: org?.deviceLimit ?? null },
      users: { used: userCount, limit: org?.userLimit ?? null },
      billingStatus: org?.billingStatus,
      trialEndsAt: org?.trialEndsAt,
    };
  }

  /** Nightly sweep: any org whose trial has expired without converting to a paid plan gets suspended. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async sweepExpiredTrials() {
    const expired = await this.organizations
      .createQueryBuilder('o')
      .where('o.billing_status = :status', { status: 'trial' })
      .andWhere('o.trial_ends_at IS NOT NULL')
      .andWhere('o.trial_ends_at < :now', { now: new Date() })
      .getMany();

    for (const org of expired) {
      await this.organizations.update(org.id, { billingStatus: 'suspended' });
      this.logger.log(`Organization ${org.id} (${org.name}) trial expired - marked suspended`);
    }

    if (expired.length) this.logger.log(`Suspended ${expired.length} expired trial organization(s)`);
  }
}
