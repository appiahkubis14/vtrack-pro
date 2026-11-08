import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Extend the default guard so per-route @Throttle() overrides keep working,
// and so we can later key limits by organization/API key instead of raw IP.
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {}
