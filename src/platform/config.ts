/**
 * Configuration: DATABASE_URL and PORT per the design, plus optional LOG_LEVEL and SWAGGER_ENABLED.
 */
export interface AppConfig {
  databaseUrl: string;
  port: number;
  logLevel: string;
  /** Serve Swagger UI at /docs. Defaults to true, except when NODE_ENV=production. */
  swaggerEnabled: boolean;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0)
    throw new Error(`PORT must be a positive integer, got ${env.PORT}`);
  return {
    databaseUrl,
    port,
    logLevel: env.LOG_LEVEL ?? 'info',
    swaggerEnabled: parseFlag(env.SWAGGER_ENABLED, env.NODE_ENV !== 'production'),
  };
}

/** 'true'/'1' → true, 'false'/'0' → false, unset → fallback; anything else is a startup error. */
function parseFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new Error(`SWAGGER_ENABLED must be true or false, got ${value}`);
}
