import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export default registerAs(
  'database',
  (): TypeOrmModuleOptions => ({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'vtrack',
    password: process.env.DB_PASSWORD ?? 'vtrack123',
    database: process.env.DB_DATABASE ?? 'vtrack',
    autoLoadEntities: true,
    // Never use synchronize in production - migrations own the schema.
    synchronize: false,
    logging: process.env.NODE_ENV === 'development',
    migrations: [__dirname + '/../database/migrations/*.{ts,js}'],
    migrationsRun: false,
  }),
);
