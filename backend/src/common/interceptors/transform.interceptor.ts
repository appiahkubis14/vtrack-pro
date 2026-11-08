import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

export interface Envelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

/**
 * Wraps every successful response in a consistent { data, meta } envelope.
 * Skip by returning already-enveloped data (e.g. paginated results with their own meta).
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, Envelope<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<Envelope<T>> {
    return next.handle().pipe(
      map((data) => (data && data.data !== undefined ? data : { data })),
    );
  }
}
