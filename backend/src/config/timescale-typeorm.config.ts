import { config } from 'dotenv';
import { DataSource } from 'typeorm';

config();

export default new DataSource({
  type: 'postgres',
  host: process.env.TS_HOST ?? 'localhost',
  port: parseInt(process.env.TS_PORT ?? '5433', 10),
  username: process.env.TS_USERNAME ?? 'vtrack',
  password: process.env.TS_PASSWORD ?? 'vtrack123',
  database: process.env.TS_DATABASE ?? 'vtrack_ts',
  entities: [__dirname + '/../modules/devices/entities/position.entity.{ts,js}'],
  migrations: [__dirname + '/../database/migrations-timescale/*.{ts,js}'],
});
