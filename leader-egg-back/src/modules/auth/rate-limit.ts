import type { Request } from 'express';
import { ipKeyGenerator, MemoryStore, rateLimit, type Store } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { env } from '../../config/env.js';
import { AppError } from '../../middleware/error-handler.js';
import { getBlacklist, getRedisClient } from './blacklist.js';

/**
 * Brute-force protection for the two public login endpoints.
 *
 * Both `POST /v1/auth/login` (tenant) and `POST /v1/platform/auth/login`
 * (platform) were previously unthrottled. Each gets its own limiter, keyed by
 * client IP + normalized email, so a single attacker cannot lock out every user
 * from one IP, nor rotate emails freely behind the same IP.
 *
 * Storage:
 *  - When `REDIS_URL` is configured the shared Redis client (created by the
 *    token blacklist) backs a `RedisStore`.
 *  - Otherwise express-rate-limit's in-memory store is used.
 *
 * SINGLE-CONTAINER CAVEAT: the in-memory store is process-local. It is correct
 * only while the API runs as a SINGLE container. If the service is scaled to
 * multiple replicas, each replica counts independently and the effective limit
 * becomes `max × replicas`. Configure `REDIS_URL` before scaling out.
 */

/** In-memory stores created here, so tests can reset all buckets in one call. */
const memoryStores: MemoryStore[] = [];

/** Normalizes the submitted email so "A@B.com" and "a@b.com" share a bucket. */
const normalizedEmail = (request: Request): string => {
  const body = request.body as { email?: unknown } | undefined;
  return typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
};

/**
 * Key = client IP + normalized email. `ipKeyGenerator` collapses IPv6
 * addresses to their subnet so a single host cannot bypass the limit by
 * rotating addresses. Requests without an email fall back to `anonymous` so
 * they still share one bucket per IP.
 */
const loginKeyGenerator = (request: Request): string => {
  const ip = ipKeyGenerator(request.ip ?? '');
  const email = normalizedEmail(request) || 'anonymous';
  return `${ip}:${email}`;
};

/**
 * Builds the limiter store: a Redis store when the shared client is available,
 * otherwise an explicit in-memory store (kept referenced for test resets).
 */
const buildStore = (prefix: string): Store => {
  // Initialise the shared blacklist client (only created when REDIS_URL is set)
  // before asking for it — otherwise it is `null` on a cold start.
  getBlacklist();
  const redis = getRedisClient();
  if (redis) {
    return new RedisStore({
      prefix,
      // ioredis forwards raw commands through `.call(command, args)`.
      sendCommand: (command: string, ...args: string[]) =>
        redis.call(command, args) as unknown as Promise<RedisReply>
    });
  }

  const store = new MemoryStore();
  memoryStores.push(store);
  return store;
};

interface LoginLimiterConfig {
  windowMs: number;
  max: number;
  prefix: string;
}

/**
 * Builds a login limiter. Successful logins do NOT consume the budget
 * (`skipSuccessfulRequests`) so legitimate users are never locked out by their
 * own correct attempts; only failures (401/400/403) count.
 */
export const createLoginRateLimiter = ({
  windowMs,
  max,
  prefix
}: LoginLimiterConfig) => {
  return rateLimit({
    windowMs,
    limit: max,
    // Standard IETF headers instead of the deprecated X-RateLimit-* set.
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: loginKeyGenerator,
    store: buildStore(prefix),
    handler: (_request, _response, next) => {
      const minutes = Math.max(1, Math.ceil(windowMs / 60_000));
      const unit = minutes === 1 ? 'minuto' : 'minutos';
      next(new AppError(`Demasiados intentos. Probá de nuevo en ${minutes} ${unit}.`, 429));
    }
  });
};

/** Tenant login limiter — `POST /v1/auth/login`. */
export const loginRateLimiter = createLoginRateLimiter({
  windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
  max: env.LOGIN_RATE_LIMIT_MAX,
  prefix: 'rl:login:'
});

/** Platform login limiter — `POST /v1/platform/auth/login` (stricter). */
export const platformLoginRateLimiter = createLoginRateLimiter({
  windowMs: env.PLATFORM_LOGIN_RATE_LIMIT_WINDOW_MS,
  max: env.PLATFORM_LOGIN_RATE_LIMIT_MAX,
  prefix: 'rl:platform-login:'
});

/**
 * Clears every in-memory rate-limit bucket.
 *
 * Intended for tests (per-test isolation) and local debugging. With the Redis
 * store this is a no-op — keys there expire with their window; use the
 * limiter's `resetKey(key)` to clear a single bucket.
 */
export const resetLoginRateLimits = (): void => {
  for (const store of memoryStores) {
    void store.resetAll();
  }
};
