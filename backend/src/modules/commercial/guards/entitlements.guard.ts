import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRES_ENTITLEMENT_KEY } from '../../../common/decorators/requires-entitlement.decorator';
import { EntitlementsEngine } from '../engines/entitlements.engine';

@Injectable()
export class EntitlementsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsEngine,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredKey = this.reflector.getAllAndOverride<string>(REQUIRES_ENTITLEMENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredKey) return true; // route doesn't declare a requirement - nothing to enforce

    const request = context.switchToHttp().getRequest();
    const user = request.user as { organizationId?: string } | undefined;
    if (!user?.organizationId) {
      throw new ForbiddenException('No organization context - are you authenticated?');
    }

    const result = await this.entitlements.check(user.organizationId, requiredKey);
    if (!result.granted) {
      throw new ForbiddenException(
        `Your organization's subscription does not include "${requiredKey}". ${result.reason ?? ''}`.trim(),
      );
    }
    return true;
  }
}
