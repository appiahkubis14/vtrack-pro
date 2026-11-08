import "./config/pg-types";
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { assertRequiredEnvVars } from './config/validation.config';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  assertRequiredEnvVars(); // in production a missing or default secret stops the app here
  const app = await NestFactory.create(AppModule, { cors: true });

  const config = app.get(ConfigService);
  const port = config.get<number>('app.port') ?? 3000;
  const apiPrefix = config.get<string>('app.apiPrefix') ?? 'api';
  const corsOrigin = config.get<string>('app.corsOrigin') ?? '*';

  // ---- Security ----
  app.use(helmet());
  app.use(compression());
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });

  // ---- Global prefix ----
  app.setGlobalPrefix(apiPrefix, { exclude: ['health', 'public/(.*)'] });

  // ---- Validation ----
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ---- Global filters / interceptors (RFC 7807 errors, response envelope, logging) ----
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor(), new TransformInterceptor());

  // ---- WebSocket adapter (swap for RedisIoAdapter in production, see services/redis.service.ts) ----
  app.useWebSocketAdapter(new IoAdapter(app));

  // ---- Swagger / OpenAPI ----
  const swaggerConfig = new DocumentBuilder()
    .setTitle('V-Track Pro API')
    .setDescription('Enterprise Vehicle Tracking & Fleet Management Platform')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`V-Track Pro API running on port ${port} (docs at /docs)`);
}

bootstrap();
