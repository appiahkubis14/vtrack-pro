import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LessThan, Repository } from 'typeorm';
import { PortableAsset, PortableAssetStatus } from './entities/portable-asset.entity';
import { AssetDeployment, DeploymentStatus } from './entities/asset-deployment.entity';
import { BatteryTelemetry } from './entities/battery-telemetry.entity';
import { CovertModePolicyEngine } from './engines/covert-mode-policy.engine';
import { AlertsService } from '../alerts/alerts.service';
import { AlertSeverity, AlertType } from '../../common/constants/alerts.constant';
import { Role } from '../../common/constants/roles.constant';
import { Device } from '../devices/entities/device.entity';

export interface CreateDeploymentInput {
  portableAssetId: string;
  deploymentPurpose?: string;
  deploymentLocation?: string;
  responsibleUserId?: string;
  expectedReturnDate?: string;
  deploymentNotes?: string;
  requestCovert?: boolean;
  covertJustification?: string;
}

@Injectable()
export class PortableAssetsService {
  private readonly logger = new Logger(PortableAssetsService.name);

  constructor(
    @InjectRepository(PortableAsset) private readonly assets: Repository<PortableAsset>,
    @InjectRepository(AssetDeployment) private readonly deployments: Repository<AssetDeployment>,
    @InjectRepository(BatteryTelemetry) private readonly batteryTelemetry: Repository<BatteryTelemetry>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    private readonly covertPolicy: CovertModePolicyEngine,
    private readonly alertsService: AlertsService,
  ) {}

  findAll(query: { organizationId?: string; status?: PortableAssetStatus; assetType?: string } = {}) {
    return this.assets.find({
      where: {
        ...(query.organizationId ? { organizationId: query.organizationId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.assetType ? { assetType: query.assetType as any } : {}),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string) {
    const asset = await this.assets.findOne({ where: { id } });
    if (!asset) throw new NotFoundException(`Portable asset ${id} not found`);
    return asset;
  }

  create(body: Partial<PortableAsset> & { organizationId: string }) {
    const qrCode = `VT-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    return this.assets.save(this.assets.create({ ...body, qrActivationCode: qrCode }));
  }

  async setPowerProfile(id: string, profile: string) {
    await this.findOne(id);
    await this.assets.update(id, { currentPowerProfile: profile });
    return this.findOne(id);
  }

  // ---- Deployments -------------------------------------------------

  async createDeployment(input: CreateDeploymentInput, requestedBy: string, requesterRole: Role) {
    const asset = await this.findOne(input.portableAssetId);
    if (asset.status === PortableAssetStatus.DEPLOYED) {
      throw new BadRequestException('This asset already has an active deployment');
    }

    if (input.requestCovert) {
      // Validates justification and logs the request BEFORE any deployment
      // exists (pre-creation log, see CovertModePolicyEngine's docblock) -
      // a failed/rejected covert request never gets a deployment created.
      await this.covertPolicy.requestCovert(null, {
        requestedBy,
        requesterRole,
        justification: input.covertJustification,
      });
    }

    const deployment = await this.deployments.save(
      this.deployments.create({
        portableAssetId: input.portableAssetId,
        deploymentPurpose: input.deploymentPurpose,
        deploymentLocation: input.deploymentLocation,
        responsibleUserId: input.responsibleUserId,
        requestedBy,
        expectedReturnDate: input.expectedReturnDate ? new Date(input.expectedReturnDate) : undefined,
        deploymentNotes: input.deploymentNotes,
        isCovert: Boolean(input.requestCovert),
        covertJustification: input.covertJustification,
        status: DeploymentStatus.ACTIVE,
      }),
    );

    if (input.requestCovert) {
      // Log again now that we have a real deployment_id to attach it to -
      // this is the durable record; the pre-creation log above just proves
      // the request happened even if creation somehow failed after it.
      await this.covertPolicy.requestCovert(deployment.id, {
        requestedBy,
        requesterRole,
        justification: input.covertJustification,
      });
    }

    await this.assets.update(input.portableAssetId, { status: PortableAssetStatus.DEPLOYED });
    return deployment;
  }

  /** A second person with an approving role must sign off - see CovertModePolicyEngine for why self-approval is blocked. */
  async approveCovertDeployment(deploymentId: string, approverId: string, approverRole: Role) {
    const deployment = await this.requireDeployment(deploymentId);
    await this.covertPolicy.approveCovert(deploymentId, approverId, approverRole, deployment.requestedBy ?? '');
    await this.deployments.update(deploymentId, { covertApprovedBy: approverId, covertApprovedAt: new Date() });
    return this.requireDeployment(deploymentId);
  }

  async returnAsset(
    deploymentId: string,
    condition: 'good' | 'damaged' | 'lost' | 'not_returned',
    checklist?: Record<string, boolean>,
  ) {
    const deployment = await this.requireDeployment(deploymentId);
    if (deployment.status === DeploymentStatus.RETURNED) {
      throw new BadRequestException('This deployment is already marked returned');
    }

    await this.deployments.update(deploymentId, {
      actualReturnDate: new Date(),
      returnCondition: condition,
      recoveryChecklist: checklist,
      status: condition === 'lost' ? DeploymentStatus.LOST : DeploymentStatus.RETURNED,
    });

    await this.assets.update(deployment.portableAssetId, {
      status: condition === 'lost' ? PortableAssetStatus.LOST : PortableAssetStatus.AVAILABLE,
    });

    return this.requireDeployment(deploymentId);
  }

  listDeployments(assetId: string) {
    return this.deployments.find({ where: { portableAssetId: assetId }, order: { deployedAt: 'DESC' } });
  }

  async getBatteryHistory(assetId: string, limit = 100) {
    const asset = await this.findOne(assetId);
    if (!asset.deviceId) return [];
    return this.batteryTelemetry.find({
      where: { deviceId: asset.deviceId },
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }

  auditHistory(deploymentId: string) {
    return this.covertPolicy.history(deploymentId);
  }

  private async requireDeployment(id: string): Promise<AssetDeployment> {
    const deployment = await this.deployments.findOne({ where: { id } });
    if (!deployment) throw new NotFoundException(`Deployment ${id} not found`);
    return deployment;
  }

  /**
   * Nightly sweep: any active deployment past its expected_return_date gets
   * flagged overdue and raises an alert - this is what makes "expected vs
   * actual return" in the schema mean something instead of just being an
   * unused column.
   */
  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async sweepOverdueReturns() {
    const overdue = await this.deployments.find({
      where: { status: DeploymentStatus.ACTIVE, expectedReturnDate: LessThan(new Date()) },
    });

    for (const deployment of overdue) {
      await this.deployments.update(deployment.id, { status: DeploymentStatus.OVERDUE });
      const asset = await this.assets.findOne({ where: { id: deployment.portableAssetId } });
      if (!asset) continue;

      const device = asset.deviceId ? await this.devices.findOne({ where: { id: asset.deviceId } }) : null;

      await this.alertsService.raise({
        organizationId: asset.organizationId,
        deviceId: asset.deviceId,
        type: AlertType.MAINTENANCE_DUE, // no dedicated "deployment overdue" alert type yet - closest existing category
        severity: AlertSeverity.MEDIUM,
        title: `Asset "${asset.assetName}" deployment is overdue for return (expected ${deployment.expectedReturnDate?.toDateString()})`,
        metadata: { deploymentId: deployment.id },
      });
    }

    if (overdue.length) this.logger.log(`Flagged ${overdue.length} overdue deployment(s)`);
  }
}
