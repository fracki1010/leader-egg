import Redis from 'ioredis';
import { env } from '../../config/env.js';

// ── Interface (T1) ──────────────────────────────────────────────────────────

export interface TokenBlacklist {
  add(jti: string, ttlSeconds: number): Promise<void>;
  has(jti: string): Promise<boolean>;
  clear(): Promise<void>;
}

// ── InMemory implementation (T2) ────────────────────────────────────────────

export class InMemoryTokenBlacklist implements TokenBlacklist {
  private revoked = new Set<string>();

  async add(jti: string, _ttlSeconds: number): Promise<void> {
    this.revoked.add(jti);
  }

  async has(jti: string): Promise<boolean> {
    return this.revoked.has(jti);
  }

  async clear(): Promise<void> {
    this.revoked.clear();
  }
}

// ── Redis implementation (T3) ───────────────────────────────────────────────

export class RedisTokenBlacklist implements TokenBlacklist {
  constructor(private redis: Redis) {}

  async add(jti: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    await this.redis.set(`revoked:${jti}`, '1', 'EX', ttlSeconds);
  }

  async has(jti: string): Promise<boolean> {
    return (await this.redis.exists(`revoked:${jti}`)) === 1;
  }

  async clear(): Promise<void> {
    const keys = await this.redis.keys('revoked:*');
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}

// ── Factory + singleton (T4) ────────────────────────────────────────────────

let redisClient: Redis | null = null;
let instance: TokenBlacklist | null = null;

export const createBlacklist = (): TokenBlacklist => {
  if (env.REDIS_URL) {
    redisClient = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 3
    });
    return new RedisTokenBlacklist(redisClient);
  }
  return new InMemoryTokenBlacklist();
};

export const getBlacklist = (): TokenBlacklist => {
  if (!instance) {
    instance = createBlacklist();
  }
  return instance;
};

export const getRedisClient = (): Redis | null => redisClient;

export const resetBlacklist = async (): Promise<void> => {
  if (instance) {
    await instance.clear();
  }
};
