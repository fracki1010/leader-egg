import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { startTestDatabase, stopTestDatabase, clearDatabase } from '../../../__tests__/helpers.js';
import { app } from '../../../app.js';
import { env } from '../../../config/env.js';
import { PlatformAdmin } from '../../../tenancy/master-models.js';
import { provisionTenant } from '../../../tenancy/tenants.js';
import { resetLoginRateLimits } from '../rate-limit.js';

/**
 * Login rate limiting.
 *
 * Limits are configured small in `src/__tests__/env-setup.ts` so these tests
 * stay fast and deterministic. Every test resets the in-memory buckets, so no
 * rate-limit state leaks between tests (or test files — each file gets its own
 * module graph and store).
 */

const request = supertest(app);

/** Tenant login budget configured for the test environment. */
const TENANT_MAX = env.LOGIN_RATE_LIMIT_MAX;
/** Platform login budget configured for the test environment. */
const PLATFORM_MAX = env.PLATFORM_LOGIN_RATE_LIMIT_MAX;

const TENANT_EMAIL = 'admin@rate-limit.test';
const TENANT_PASSWORD = 'correct-secret';
const PLATFORM_EMAIL = 'platform@rate-limit.test';
const PLATFORM_PASSWORD = 'platform-secret';

/** Give the async `skipSuccessfulRequests` decrement a chance to run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));

const dropTenantDatabases = async (): Promise<void> => {
  const admin = mongoose.connection.db!.admin();
  const { databases } = await admin.listDatabases();
  for (const db of databases) {
    if (db.name?.startsWith('tenant_')) {
      await mongoose.connection.useDb(db.name).dropDatabase();
    }
  }
};

const attemptTenantLogin = (password: string) =>
  request.post('/api/v1/auth/login').send({ email: TENANT_EMAIL, password });

const attemptPlatformLogin = (password: string) =>
  request.post('/api/v1/platform/auth/login').send({ email: PLATFORM_EMAIL, password });

const provisionTestTenant = async (): Promise<void> => {
  await provisionTenant({
    name: 'Rate Limit Tenant',
    slug: 'rate-limit-tenant',
    adminName: 'Rate Limit Admin',
    adminEmail: TENANT_EMAIL,
    adminPassword: TENANT_PASSWORD
  });
};

const seedPlatformAdmin = async (): Promise<void> => {
  const passwordHash = await bcrypt.hash(PLATFORM_PASSWORD, 10);
  await PlatformAdmin.create({ name: 'Platform Admin', email: PLATFORM_EMAIL, passwordHash });
};

describe('Login rate limiting', () => {
  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await dropTenantDatabases();
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
    await dropTenantDatabases();
    resetLoginRateLimits();
    await provisionTestTenant();
    await seedPlatformAdmin();
  });

  it('blocks the tenant login after too many failed attempts (429)', async () => {
    for (let i = 0; i < TENANT_MAX; i += 1) {
      await attemptTenantLogin('wrong-password').expect(401);
    }

    const blocked = await attemptTenantLogin('wrong-password').expect(429);

    expect(blocked.body.error).toMatch(/demasiados intentos/i);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('does not count a successful login against the budget', async () => {
    // Use every slot but one.
    for (let i = 0; i < TENANT_MAX - 1; i += 1) {
      await attemptTenantLogin('wrong-password').expect(401);
    }

    // A correct login passes and must NOT consume the remaining budget…
    await attemptTenantLogin(TENANT_PASSWORD).expect(200);
    await flush();

    // …so one more failure is still allowed (401, never 429). If the success
    // had counted, this request would already be over the limit.
    await attemptTenantLogin('wrong-password').expect(401);
  });

  it('keeps the tenant and platform limits independent', async () => {
    // Exhaust the platform budget…
    for (let i = 0; i < PLATFORM_MAX; i += 1) {
      await attemptPlatformLogin('wrong-password').expect(401);
    }
    await attemptPlatformLogin('wrong-password').expect(429);

    // …the tenant limiter is untouched and a fresh failure is still within budget.
    await attemptTenantLogin(TENANT_PASSWORD).expect(200);
    await attemptTenantLogin('wrong-password').expect(401);
  });

  it('does not throttle non-login routes', async () => {
    for (let i = 0; i < 25; i += 1) {
      await request.get('/api/health').expect(200);
    }
  });
});
