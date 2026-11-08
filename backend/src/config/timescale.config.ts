import { registerAs } from '@nestjs/config';

// Separate connection for the high-write positions hypertable.
// Wired up as a second TypeOrmModule.forRootAsync connection named 'timescale' in app.module.ts.
export default registerAs('timescale', () => ({
  type: 'postgres' as const,
  host: process.env.TS_HOST ?? 'localhost',
  port: parseInt(process.env.TS_PORT ?? '5433', 10),
  username: process.env.TS_USERNAME ?? 'vtrack',
  password: process.env.TS_PASSWORD ?? 'vtrack123',
  database: process.env.TS_DATABASE ?? 'vtrack_ts',
  synchronize: false,
  logging: false,
}));
