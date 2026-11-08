import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request } from 'express';
import { AuditService } from './audit.service';

/** Values under these keys are never written to the audit trail. */
const SECRET_KEY = /pass|secret|token|momo|iddocument|nationalid|otp|backup|code|pin/i;
/** Reads of personal or financial data are logged too (who looked at what). */
const SENSITIVE_READ = /^\/(owners|riders|users|contracts\/[^/]+|ledger|business-reports\/(owner|rider)-statement|settlements|investor|rider-portal|audit)/;
const SKIP = /^\/(health|metrics|auth\/refresh|docs)/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object' || depth > 3) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

/**
 * Records every change made through the API, and every read of personal or financial data, with who, what, from where
 * and whether it succeeded. It never blocks or fails a request: a problem writing the log is logged and swallowed.
 */
@Injectable()
export class ActivityAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Audit');
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request & { user?: any }>();
    const path = (req.path || req.url || '').replace(/^\/api/, '');
    if (SKIP.test(path)) return next.handle();
    const isRead = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
    if (isRead && !SENSITIVE_READ.test(path)) return next.handle();

    const write = (status: 'success' | 'failed', error?: string) => {
      const segments = path.split('/').filter(Boolean);
      const id = segments.find((s) => UUID.test(s));
      const resource = segments.find((s) => !UUID.test(s)) ?? 'unknown';
      const action = `${req.method.toLowerCase()} ${segments.filter((s) => !UUID.test(s)).join('/')}`.slice(0, 100);
      const user = req.user;
      Promise.resolve(
        this.audit.record({
          organizationId: user?.organizationId,
          userId: user?.sub,
          action,
          resourceType: resource.slice(0, 50),
          resourceId: id,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          newValues: isRead ? undefined : (redact(req.body) as Record<string, unknown>),
          status,
          errorMessage: error?.slice(0, 500),
        }),
      ).catch((e) => this.logger.warn(`Could not write audit entry: ${e.message}`));
    };

    return next.handle().pipe(
      tap({
        next: () => write('success'),
        error: (e) => write('failed', e?.message),
      }),
    );
  }
}
