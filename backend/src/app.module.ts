import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import timescaleConfig from './config/timescale.config';
import redisConfig from './config/redis.config';
import jwtConfig from './config/jwt.config';
import mqttConfig from './config/mqtt.config';

import { AppThrottlerGuard } from './common/guards/throttler.guard';

import { AuthModule } from './modules/auth/auth.module';
import { MapModule } from './modules/map/map.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { DevicesModule } from './modules/devices/devices.module';
import { PositionsModule } from './modules/positions/positions.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { FuelModule } from './modules/fuel/fuel.module';
import { GeofencesModule } from './modules/geofences/geofences.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { CommandsModule } from './modules/commands/commands.module';
import { TripsModule } from './modules/trips/trips.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuditModule } from './modules/audit/audit.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { HealthModule } from './health/health.module';
import { TwinModule } from './modules/twin/twin.module';
import { EnergyModule } from './modules/energy/energy.module';
import { FusionModule } from './modules/fusion/fusion.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CommercialModule } from './modules/commercial/commercial.module';
import { HubsModule } from './modules/hubs/hubs.module';
import { ConsignmentsModule } from './modules/consignments/consignments.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { OperationsModule } from './modules/operations/operations.module';
import { FinanceModule } from './modules/finance/finance.module';
import { TeamModule } from './modules/team/team.module';
import { PortableModule } from './modules/portable/portable.module';
import { RoamingModule } from './modules/roaming/roaming.module';
import { AudioModule } from './modules/audio/audio.module';
import { TheftRecoveryModule } from './modules/theft-recovery/theft-recovery.module';
import { PublicSiteModule } from './modules/public/public.module';
import { EvFleetModule } from './modules/ev-fleet/ev-fleet.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, timescaleConfig, redisConfig, jwtConfig, mqttConfig],
      envFilePath: ['.env'],
    }),

    // Primary relational store (everything except high-write GPS positions).
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.get('database')!,
    }),

    // Secondary connection, named 'timescale', dedicated to the positions hypertable.
    TypeOrmModule.forRootAsync({
      name: 'timescale',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ...config.get('timescale')!,
        entities: [__dirname + '/modules/devices/entities/position.entity.{ts,js}'],
      }),
    }),

    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get<string>('redis.password'),
        },
      }),
    }),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: (config.get<number>('THROTTLE_TTL') ?? 60) * 1000,
          limit: config.get<number>('THROTTLE_LIMIT') ?? 100,
        },
      ],
    }),

    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),

    // --- Feature modules -------------------------------------------------
    AuthModule,
    MapModule,
    OrganizationsModule,
    DevicesModule,
    PositionsModule,
    VehiclesModule,
    FuelModule,
    GeofencesModule,
    AlertsModule,
    NotificationsModule,
    CommandsModule,
    TripsModule,
    DriversModule,
    MaintenanceModule,
    ReportsModule,
    AnalyticsModule,
    AuditModule,
    DashboardModule,
    HealthModule,
    TwinModule,
    EnergyModule,
    FusionModule,
    CatalogModule,
    CommercialModule,
    HubsModule,
    ConsignmentsModule,
    ContractsModule,
    OperationsModule,
    FinanceModule,
    TeamModule,
    PortableModule,
    RoamingModule,
    AudioModule,
    TheftRecoveryModule,
    PublicSiteModule,
    EvFleetModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class AppModule {}
