import "./pg-types";
import { config } from 'dotenv';
import { DataSource } from 'typeorm';

// Standalone DataSource used by the TypeORM CLI (migration:generate/run/revert).
config();

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME ?? 'vtrack',
  password: process.env.DB_PASSWORD ?? 'vtrack123',
  database: process.env.DB_DATABASE ?? 'vtrack',
  entities: [__dirname + '/../modules/**/entities/*.entity.{ts,js}'],
  migrations: [__dirname + '/../database/migrations/*.{ts,js}'],
});
