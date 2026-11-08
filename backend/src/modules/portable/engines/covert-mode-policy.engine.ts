import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeploymentAuditLog } from '../entities/deployment-audit-log.entity';
import { Role } from '../../../common/constants/roles.constant';

const ROLES_ALLOWED_TO_APPROVE_COVERT: Role[] = [Role.SUPER_ADMIN, Role.ORG_ADMIN, Role.FLEET_MANAGER];

export interface CovertRequestContext {
  requestedBy: string;
  requesterRole: Role;
  justification?: string;
}

/**
 * Covert mode is never a simple boolean toggle. Every request is logged
 * (approved or not), every approval requires both a justification string
 * and an approver with sufficient role, and there's no code path that lets
 * a deployment go covert without a DeploymentAuditLog row existing for it -
 * that's the whole point of building this as a policy engine rather than a
 * field on the deployment form.
 */
@Injectable()
export class CovertModePolicyEngine {
  constructor(@InjectRepository(DeploymentAuditLog) private readonly auditLogs: Repository<DeploymentAuditLog>) {}

  /**
   * Validates a covert request BEFORE the deployment is created, throwing if
   * it can't be approved. Always logs the attempt, whether it succeeds or not.
   */
  async requestCovert(deploymentId: string | null, context: CovertRequestContext): Promise<void> {
    if (!context.justification || context.justification.trim().length < 20) {
      await this.log(deploymentId, 'covert_denied', context.requestedBy, 'Justification missing or too brief (minimum 20 characters)');
      throw new ForbiddenException(
        'Covert mode requires a written legal justification of at least 20 characters explaining the basis for covert deployment.',
      );
    }

    await this.log(deploymentId, 'covert_requested', context.requestedBy, context.justification);
  }

  /**
   * A second, distinct role must approve - the requester cannot self-approve
   * even if they hold an approving role, per the spec's "approval workflow"
   * requirement (a request without independent sign-off isn't an approval).
   */
  async approveCovert(deploymentId: string, approverId: string, approverRole: Role, requestedBy: string): Promise<void> {
    if (!ROLES_ALLOWED_TO_APPROVE_COVERT.includes(approverRole)) {
      await this.log(deploymentId, 'covert_denied', approverId, `Role "${approverRole}" is not authorized to approve covert deployments`);
      throw new ForbiddenException(`Role "${approverRole}" cannot approve covert deployments.`);
    }
    if (approverId === requestedBy) {
      await this.log(deploymentId, 'covert_denied', approverId, 'Requester cannot self-approve');
      throw new ForbiddenException('The person who requested covert mode cannot also approve it.');
    }

    await this.log(deploymentId, 'covert_approved', approverId, `Approved covert deployment requested by ${requestedBy}`);
  }

  async logVisibilityRestriction(deploymentId: string, reason: string) {
    await this.log(deploymentId, 'visibility_restricted', undefined, reason);
  }

  async logAlertRedaction(deploymentId: string, alertId: string, reason: string) {
    await this.log(deploymentId, 'alert_redacted', undefined, reason, { alertId });
  }

  history(deploymentId: string) {
    return this.auditLogs.find({ where: { deploymentId }, order: { createdAt: 'ASC' } });
  }

  private async log(
    deploymentId: string | null,
    action: string,
    performedBy?: string,
    reason?: string,
    metadata?: Record<string, unknown>,
  ) {
    // deploymentId is null for pre-creation requests (the deployment row
    // doesn't exist yet at request time) - the schema allows a nullable
    // deployment_id specifically so this attempt still gets logged rather
    // than silently dropped, matching "audit log for every covert action."
    await this.auditLogs.save(
      this.auditLogs.create({ deploymentId: deploymentId ?? undefined, action, performedBy, reason, metadata }),
    );
  }
}
