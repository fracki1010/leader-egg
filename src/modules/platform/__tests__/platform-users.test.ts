import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import supertest from 'supertest';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { startTestDatabase, stopTestDatabase, clearDatabase } from '../../../__tests__/helpers.js';
import { app } from '../../../app.js';
import { provisionTenant } from '../../../tenancy/tenants.js';
import { EmailIndex, PlatformAdmin, type ITenant } from '../../../tenancy/master-models.js';
import { getTenantConnection } from '../../../tenancy/registry.js';
import { runWithTenancy } from '../../../tenancy/context.js';
import { User } from '../../auth/model.js';
import { resetLoginRateLimits } from '../../auth/rate-limit.js';

/**
 * Platform-wide user management.
 *
 * A platform admin lists and mutates users ACROSS every tenant. Each mutation
 * opens the owning tenant's connection explicitly (never leaking the platform
 * request into a tenant ALS scope). These tests prove cross-tenant reads,
 * tenant-scoped writes, EmailIndex consistency and the last-admin guard.
 */

const request = supertest(app);

const PLATFORM_EMAIL = 'platform@test.com';
const PLATFORM_PASSWORD = 'platform-secret';

const ACME = {
  name: 'Acme Eggs',
  slug: 'acme',
  adminName: 'Acme Admin',
  adminEmail: 'admin@acme.com',
  adminPassword: 'acme-secret'
} as const;

const GLOBEX = {
  name: 'Globex',
  slug: 'globex',
  adminName: 'Globex Admin',
  adminEmail: 'admin@globex.com',
  adminPassword: 'globex-secret'
} as const;

let platformToken: string;

const auth = () => ({ Authorization: `Bearer ${platformToken}` });

/** Drops every `tenant_*` database so each test starts from a clean slate. */
const dropTenantDatabases = async (): Promise<void> => {
  const admin = mongoose.connection.db!.admin();
  const { databases } = await admin.listDatabases();
  for (const db of databases) {
    if (db.name?.startsWith('tenant_')) {
      await mongoose.connection.useDb(db.name).dropDatabase();
    }
  }
};

const provisionPair = async (): Promise<{ acme: ITenant; globex: ITenant }> => {
  const acme = await provisionTenant({ ...ACME });
  const globex = await provisionTenant({ ...GLOBEX });
  return { acme, globex };
};

interface ApiUser {
  id: string;
  name: string;
  email: string;
  role: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  createdAt: string;
  passwordHash?: string;
}

const listUsers = async (query = ''): Promise<ApiUser[]> => {
  const response = await request.get(`/api/v1/platform/users${query}`).set(auth()).expect(200);
  return response.body as ApiUser[];
};

const createUser = async (
  payload: Record<string, unknown>
): Promise<ApiUser> => {
  const response = await request
    .post('/api/v1/platform/users')
    .set(auth())
    .send(payload)
    .expect(201);
  return response.body.user as ApiUser;
};

describe('Platform users API — /api/v1/platform/users', () => {
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

    const passwordHash = await bcrypt.hash(PLATFORM_PASSWORD, 10);
    await PlatformAdmin.create({ name: 'Platform Admin', email: PLATFORM_EMAIL, passwordHash });

    const login = await request
      .post('/api/v1/platform/auth/login')
      .send({ email: PLATFORM_EMAIL, password: PLATFORM_PASSWORD })
      .expect(200);
    platformToken = login.body.token as string;
  });

  afterEach(async () => {
    await dropTenantDatabases();
  });

  describe('GET /users', () => {
    it('lists users from ALL tenants with their company, never exposing the password hash', async () => {
      const { acme, globex } = await provisionPair();

      const users = await listUsers();

      const acmeAdmin = users.find((u) => u.email === ACME.adminEmail);
      expect(acmeAdmin).toMatchObject({
        role: 'admin',
        tenantId: String(acme._id),
        tenantName: 'Acme Eggs',
        tenantSlug: 'acme'
      });
      expect(acmeAdmin?.passwordHash).toBeUndefined();

      const globexAdmin = users.find((u) => u.email === GLOBEX.adminEmail);
      expect(globexAdmin).toMatchObject({
        tenantId: String(globex._id),
        tenantName: 'Globex',
        tenantSlug: 'globex'
      });

      // Deterministic order: tenant name first (Acme Eggs before Globex).
      const acmeIndex = users.findIndex((u) => u.email === ACME.adminEmail);
      const globexIndex = users.findIndex((u) => u.email === GLOBEX.adminEmail);
      expect(acmeIndex).toBeLessThan(globexIndex);
    });

    it('filters to a single tenant via ?tenant=', async () => {
      const { acme } = await provisionPair();

      const users = await listUsers(`?tenant=${String(acme._id)}`);

      expect(users.length).toBeGreaterThan(0);
      expect(users.every((u) => u.tenantId === String(acme._id))).toBe(true);
      expect(users.find((u) => u.email === GLOBEX.adminEmail)).toBeUndefined();
    });

    it('searches name/email case-insensitively via ?search=', async () => {
      await provisionPair();

      const users = await listUsers('?search=GLOBEX');

      expect(users.length).toBe(1);
      expect(users[0]?.email).toBe(GLOBEX.adminEmail);
    });
  });

  describe('PATCH /users/:id', () => {
    it('changes the role in the right tenant and leaves the other tenant untouched', async () => {
      const { acme, globex } = await provisionPair();

      const acmeDriver = await createUser({
        tenantId: String(acme._id),
        name: 'Acme Driver',
        email: 'driver@acme.com',
        password: 'driver-secret',
        role: 'driver'
      });
      await createUser({
        tenantId: String(globex._id),
        name: 'Globex Driver',
        email: 'driver@globex.com',
        password: 'driver-secret',
        role: 'driver'
      });

      const patched = await request
        .patch(`/api/v1/platform/users/${acmeDriver.id}`)
        .set(auth())
        .send({ tenantId: String(acme._id), role: 'viewer' })
        .expect(200);

      expect(patched.body.user).toMatchObject({ role: 'viewer', tenantSlug: 'acme' });

      const globexUsers = await listUsers(`?tenant=${String(globex._id)}`);
      expect(globexUsers.find((u) => u.email === 'driver@globex.com')?.role).toBe('driver');
    });

    it('updates the user name', async () => {
      const { acme } = await provisionPair();

      const driver = await createUser({
        tenantId: String(acme._id),
        name: 'Old Name',
        email: 'rename@acme.com',
        password: 'driver-secret',
        role: 'driver'
      });

      const patched = await request
        .patch(`/api/v1/platform/users/${driver.id}`)
        .set(auth())
        .send({ tenantId: String(acme._id), name: 'New Name' })
        .expect(200);

      expect(patched.body.user.name).toBe('New Name');
    });
  });

  describe('DELETE /users/:id', () => {
    it('removes the user and its EmailIndex row', async () => {
      const { acme } = await provisionPair();

      const driver = await createUser({
        tenantId: String(acme._id),
        name: 'To Delete',
        email: 'bye@acme.com',
        password: 'driver-secret',
        role: 'driver'
      });

      expect(await EmailIndex.countDocuments({ userId: driver.id })).toBe(1);

      await request
        .delete(`/api/v1/platform/users/${driver.id}?tenant=${String(acme._id)}`)
        .set(auth())
        .expect(204);

      expect(await EmailIndex.countDocuments({ userId: driver.id })).toBe(0);
      const remaining = await listUsers(`?tenant=${String(acme._id)}`);
      expect(remaining.find((u) => u.id === driver.id)).toBeUndefined();
    });

    it('refuses to delete the last admin of a tenant (400)', async () => {
      const { acme } = await provisionPair();

      const users = await listUsers(`?tenant=${String(acme._id)}`);
      const admin = users.find((u) => u.email === ACME.adminEmail);
      expect(admin).toBeDefined();

      const response = await request
        .delete(`/api/v1/platform/users/${admin!.id}?tenant=${String(acme._id)}`)
        .set(auth())
        .expect(400);

      expect(response.body.error).toMatch(/admin/i);
      // The admin and its EmailIndex row are untouched.
      expect(await EmailIndex.countDocuments({ email: ACME.adminEmail })).toBe(1);
    });
  });

  describe('POST /users', () => {
    it('creates a user + EmailIndex in the target tenant', async () => {
      const { globex } = await provisionPair();

      const created = await createUser({
        tenantId: String(globex._id),
        name: 'New Globex',
        email: 'new@globex.com',
        password: 'secret123',
        role: 'driver'
      });

      expect(created).toMatchObject({
        email: 'new@globex.com',
        role: 'driver',
        tenantSlug: 'globex'
      });
      expect(await EmailIndex.countDocuments({ email: 'new@globex.com' })).toBe(1);

      const users = await listUsers(`?tenant=${String(globex._id)}`);
      expect(users.find((u) => u.email === 'new@globex.com')).toBeDefined();
    });

    it('returns 409 on a duplicate email and never leaves the user behind', async () => {
      const { globex } = await provisionPair();

      const response = await request
        .post('/api/v1/platform/users')
        .set(auth())
        .send({
          tenantId: String(globex._id),
          name: 'Duplicate',
          email: ACME.adminEmail,
          password: 'secret123',
          role: 'viewer'
        })
        .expect(409);

      expect(response.body.error).toMatch(/already registered/i);

      // Rollback: the duplicate email never landed in the globex DB.
      const orphan = await runWithTenancy(
        { connection: getTenantConnection(globex.dbName), tenantId: String(globex._id) },
        () => User.findOne({ email: ACME.adminEmail })
      );
      expect(orphan).toBeNull();
    });
  });

  describe('POST /users/:id/reset-password', () => {
    it('resets the password: the new one logs in and the old one fails', async () => {
      const { acme } = await provisionPair();

      const users = await listUsers(`?tenant=${String(acme._id)}`);
      const admin = users.find((u) => u.email === ACME.adminEmail);
      expect(admin).toBeDefined();

      const newPassword = 'brand-new-secret';
      await request
        .post(`/api/v1/platform/users/${admin!.id}/reset-password`)
        .set(auth())
        .send({ tenantId: String(acme._id), newPassword })
        .expect(204);

      await request
        .post('/api/v1/auth/login')
        .send({ email: ACME.adminEmail, password: newPassword })
        .expect(200);

      await request
        .post('/api/v1/auth/login')
        .send({ email: ACME.adminEmail, password: ACME.adminPassword })
        .expect(401);
    });
  });
});
