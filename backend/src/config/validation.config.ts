// Startup env-var schema. Extend as new integrations are added.
// Kept lightweight here; swap for a Joi schema passed to ConfigModule.forRoot({ validationSchema })
// once you pull in the `joi` package.
export const REQUIRED_ENV_VARS = [
  'DB_HOST',
  'DB_PORT',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_DATABASE',
  'REDIS_HOST',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
];

const PLACEHOLDER = /^(change-me|dev-|changeme|secret$|password$)/i;

export function assertRequiredEnvVars(): void {
  const production = process.env.NODE_ENV === 'production';
  if (production) {
    // In production a weak or missing secret is a hard stop, not a warning: a default JWT secret would let anyone forge a login.
    const problems: string[] = [];
    for (const key of [...REQUIRED_ENV_VARS, 'FIELD_ENCRYPTION_KEY']) {
      if (!process.env[key]) problems.push(`${key} is not set`);
    }
    for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
      const v = process.env[key];
      if (v && (PLACEHOLDER.test(v) || v.length < 32)) problems.push(`${key} must be a random value of at least 32 characters`);
    }
    if (process.env.JWT_SECRET && process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) problems.push('JWT_SECRET and JWT_REFRESH_SECRET must differ');
    if (process.env.FIELD_ENCRYPTION_KEY && !/^[0-9a-fA-F]{64}$/.test(process.env.FIELD_ENCRYPTION_KEY)) problems.push('FIELD_ENCRYPTION_KEY must be 64 hex characters');
    if (problems.length) throw new Error(`Refusing to start in production:\n  - ${problems.join('\n  - ')}`);
  }
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length) {
    // eslint-disable-next-line no-console
    console.warn(`[config] Missing recommended env vars: ${missing.join(', ')}`);
  }
}
