import { LoggerService as NestLoggerService } from '@nestjs/common';
import * as winston from 'winston';
import 'winston-daily-rotate-file';

/**
 * Structured Winston logger with daily-rotating files, wired in as Nest's
 * app-wide logger via app.useLogger(new AppLoggerService()) in main.ts if
 * you want structured JSON logs instead of Nest's default console output.
 */
export class AppLoggerService implements NestLoggerService {
  private readonly logger = winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [
      new winston.transports.Console(),
      new (winston.transports as any).DailyRotateFile({
        dirname: 'logs',
        filename: 'vtrack-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxFiles: '14d',
      }),
    ],
  });

  log(message: string, context?: string) {
    this.logger.info(message, { context });
  }
  error(message: string, trace?: string, context?: string) {
    this.logger.error(message, { trace, context });
  }
  warn(message: string, context?: string) {
    this.logger.warn(message, { context });
  }
  debug(message: string, context?: string) {
    this.logger.debug(message, { context });
  }
  verbose(message: string, context?: string) {
    this.logger.verbose(message, { context });
  }
}
