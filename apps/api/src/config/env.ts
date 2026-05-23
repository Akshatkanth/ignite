import { z } from 'zod';

function parseBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
  }

  return undefined;
}

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  // Database
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars').optional(),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars').optional(),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars').optional(),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // Worker runtime
  ENABLE_DEPLOYMENT_WORKER: z.preprocess(parseBoolean, z.boolean().default(true)),

  // Preview screenshot capture target (optional)
  DEPLOYMENT_PREVIEW_URL: z.string().url().optional(),

  // Active deployment runtime URL/port for local container screenshots (optional)
  DEPLOYMENT_RUNTIME_URL: z.string().url().optional(),
  DEPLOYMENT_RUNTIME_PORT: z.coerce.number().int().positive().optional(),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000), // 15 min
  RATE_LIMIT_MAX: z.coerce.number().default(100),
});

function validateEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    result.error.issues.forEach((issue) => {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    });
    process.exit(1);
  }

  const data = result.data;
  const masterSecret = data.JWT_SECRET;
  const accessSecret = data.JWT_ACCESS_SECRET ?? (masterSecret ? `${masterSecret}:access` : undefined);
  const refreshSecret = data.JWT_REFRESH_SECRET ?? (masterSecret ? `${masterSecret}:refresh` : undefined);

  if (!accessSecret || !refreshSecret) {
    console.error('❌ Invalid environment variables:');
    console.error('  - JWT_ACCESS_SECRET: provide JWT_ACCESS_SECRET or JWT_SECRET');
    console.error('  - JWT_REFRESH_SECRET: provide JWT_REFRESH_SECRET or JWT_SECRET');
    process.exit(1);
  }

  return {
    ...data,
    JWT_ACCESS_SECRET: accessSecret,
    JWT_REFRESH_SECRET: refreshSecret,
  };
}

export const env = validateEnv();
export type Env = z.infer<typeof envSchema>;
