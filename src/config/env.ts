import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MONGO_URI: z.string().trim().min(1).url().default('mongodb://127.0.0.1:27017/leader_egg'),
  // Platform (master) database name. Holds only the tenant registry, the
  // platform-wide email index, and platform admins — never tenant business data.
  PLATFORM_DB: z.string().trim().min(1).default('leader_egg_platform'),
  CORS_ORIGIN: z.union([z.literal('*'), z.string().trim().min(1).url()]).default('*'),
  JWT_SECRET: z.string().trim().min(16),
  // Optional dedicated secret for platform (super-tenant) tokens. When unset,
  // it is derived as `${JWT_SECRET}__platform` so a leaked tenant secret does
  // not automatically mint platform tokens. Set a distinct random value in
  // production. Changing it invalidates all existing platform sessions.
  PLATFORM_JWT_SECRET: z.string().trim().min(16).optional(),
  JWT_EXPIRES_IN: z.string().trim().min(1).default('24h'),
  REDIS_URL: z.string().url().optional(),
  // Number of trusted reverse-proxy hops in front of the app (Caddy = 1).
  // Required for `req.ip` to reflect the real client behind the proxy, which
  // the login rate limiter keys on. Set to "false" to disable entirely.
  TRUST_PROXY: z.string().trim().default('1'),
  // Login rate limiting. Tenant login defaults to 10 attempts / 15 min; the
  // platform login is stricter (5 / 15 min) because it guards the master panel.
  LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  PLATFORM_LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  PLATFORM_LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  NOMINATIM_BASE_URL: z.string().trim().min(1).url().default('https://nominatim.openstreetmap.org'),
  GEOCODE_USER_AGENT: z.string().trim().min(1).default('leader-egg-app/1.0 (contact@leaderegg.com)'),
  // In-app AI assistant (read-only). The whole feature is disabled when no API
  // key is configured, so these stay optional and never break the app. An empty
  // string is treated as "not configured" (common in deploy templates).
  AGENT_API_KEY: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).optional()
  ),
  AGENT_BASE_URL: z.string().trim().min(1).url().default('https://api.deepseek.com/v1'),
  AGENT_MODEL: z.string().trim().min(1).default('deepseek-chat'),
  AGENT_MAX_TOKENS: z.coerce.number().int().positive().default(600),
  // Conversation messages replayed to the model on every turn (user/assistant
  // text only; tool traces are never replayed).
  AGENT_HISTORY_MESSAGES: z.coerce.number().int().positive().default(8),
  AGENT_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(40),
  AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  // Groq's gpt-oss models emit reasoning tokens that count against TPM. "low"
  // keeps a normal business turn inside the free tier; omit for providers
  // that do not support the field.
  AGENT_REASONING_EFFORT: z.enum(['low', 'medium', 'high']).optional()
});

const result = envSchema.safeParse({
  PORT: process.env.PORT,
  NODE_ENV: process.env.NODE_ENV,
  MONGO_URI: process.env.MONGO_URI,
  PLATFORM_DB: process.env.PLATFORM_DB,
  CORS_ORIGIN: process.env.CORS_ORIGIN,
  JWT_SECRET: process.env.JWT_SECRET,
  PLATFORM_JWT_SECRET: process.env.PLATFORM_JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
  REDIS_URL: process.env.REDIS_URL,
  TRUST_PROXY: process.env.TRUST_PROXY,
  LOGIN_RATE_LIMIT_WINDOW_MS: process.env.LOGIN_RATE_LIMIT_WINDOW_MS,
  LOGIN_RATE_LIMIT_MAX: process.env.LOGIN_RATE_LIMIT_MAX,
  PLATFORM_LOGIN_RATE_LIMIT_WINDOW_MS: process.env.PLATFORM_LOGIN_RATE_LIMIT_WINDOW_MS,
  PLATFORM_LOGIN_RATE_LIMIT_MAX: process.env.PLATFORM_LOGIN_RATE_LIMIT_MAX,
  NOMINATIM_BASE_URL: process.env.NOMINATIM_BASE_URL,
  GEOCODE_USER_AGENT: process.env.GEOCODE_USER_AGENT,
  AGENT_API_KEY: process.env.AGENT_API_KEY,
  AGENT_BASE_URL: process.env.AGENT_BASE_URL,
  AGENT_MODEL: process.env.AGENT_MODEL,
  AGENT_MAX_TOKENS: process.env.AGENT_MAX_TOKENS,
  AGENT_HISTORY_MESSAGES: process.env.AGENT_HISTORY_MESSAGES,
  AGENT_RATE_LIMIT_PER_HOUR: process.env.AGENT_RATE_LIMIT_PER_HOUR,
  AGENT_TIMEOUT_MS: process.env.AGENT_TIMEOUT_MS,
  AGENT_REASONING_EFFORT: process.env.AGENT_REASONING_EFFORT
});

if (!result.success) {
  const details = result.error.issues
    .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = result.data;
