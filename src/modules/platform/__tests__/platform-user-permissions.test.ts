import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { startTestDatabase, stopTestDatabase, clearDatabase } from '../../../__tests__/helpers.js';
import { app } from '../../../app.js';
import { provisionTenant } from '../../../tenancy/tenants.js';
import { PlatformAdmin, type ITenant } from '../../../tenancy/master-models.js';
import { ALL_PERMISSIONS } from '../../auth/permissions.js';
import { resetLoginRateLimits } from '../../auth/rate-limit.js';

/**
 * Platform user management + per-module permissions.
 *
 * Mirrors the tenant-side rules across a provisioned tenant: defaults on create,
 * persistence on patch, non-admin normalization and the last-user-manager guard.
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

let platformToken: string;

const auth = () => ({ Authorization: `Bearer ${platformToken}` });

interface ApiUser {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
  tenantId: string;
  tenantSlug: string;
}

const dropTenantDatabases = async (): Promise<void> => {
  const admin = mongoose.connection.db!.admin();
  const { databases } = await admin.listDatabases();
  for (const db of databases) {
    if (db.name?.startsWith('tenant_')) {
      await mongoose.connection.useDb(db.name).dropDatabase();
    }
  }
};

const listUsers = async (tenant: ITenant): Promise<ApiUser[]> => {
  const response = await request
    .get(`/api/v1/platform/users?tenant=${String(tenant._id)}`)
    .set(auth())
    .expect(200);
  return response.body as ApiUser[];
};

const createUser = async (payload: Record<string, unknown>): Promise<ApiUser> => {
  const response = await request
    .post('/api/v1/platform/users')
    .set(auth())
    .send(payload)
    .expect(201);
  return response.body.user as ApiUser;
};

describe('Platform users API — permissions', () => {
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

  it('includes permissions in the platform user list', async () => {
    const acme = await provisionTenant({ ...ACME });

    const users = await listUsers(acme);
    const admin = users.find((u) => u.email === ACME.adminEmail);

    expect(admin?.permissions).toEqual(ALL_PERMISSIONS);
  });

  it('defaults a new admin to the full set and normalizes non-admin roles to []', async () => {
    const acme = await provisionTenant({ ...ACME });

    const admin = await createUser({
      tenantId: String(acme._id),
      name: 'Second Admin',
      email: 'admin2@acme.com',
      password: 'secret123',
      role: 'admin'
    });
    expect(admin.permissions).toEqual(ALL_PERMISSIONS);

    const driver = await createUser({
      tenantId: String(acme._id),
      name: 'Driver',
      email: 'driver@acme.com',
      password: 'secret123',
      role: 'driver',
      permissions: ['orders.manage']
    });
    expect(driver.permissions).toEqual([]);
  });

  it('persists a permissions update on an admin', async () => {
    const acme = await provisionTenant({ ...ACME });
    const admin = await createUser({
      tenantId: String(acme._id),
      name: 'Second Admin',
      email: 'admin2@acme.com',
      password: 'secret123',
      role: 'admin'
    });

    const patched = await request
      .patch(`/api/v1/platform/users/${admin.id}`)
      .set(auth())
      .send({ tenantId: String(acme._id), permissions: ['orders.view'] })
      .expect(200);

    expect(patched.body.user.permissions).toEqual(['orders.view']);

    const users = await listUsers(acme);
    expect(users.find((u) => u.id === admin.id)?.permissions).toEqual(['orders.view']);
  });

  it('ignores permissions for a non-admin on update', async () => {
    const acme = await provisionTenant({ ...ACME });
    const driver = await createUser({
      tenantId: String(acme._id),
      name: 'Driver',
      email: 'driver@acme.com',
      password: 'secret123',
      role: 'driver'
    });

    const patched = await request
      .patch(`/api/v1/platform/users/${driver.id}`)
      .set(auth())
      .send({ tenantId: String(acme._id), permissions: ['stock.view'] })
      .expect(200);

    expect(patched.body.user.permissions).toEqual([]);
  });

  it('refuses to strip users.manage from the last admin (409)', async () => {
    const acme = await provisionTenant({ ...ACME });
    const users = await listUsers(acme);
    const admin = users.find((u) => u.email === ACME.adminEmail);
    expect(admin).toBeDefined();

    const response = await request
      .patch(`/api/v1/platform/users/${admin!.id}`)
      .set(auth())
      .send({ tenantId: String(acme._id), permissions: ['orders.view'] })
      .expect(409);

    expect(response.body.error).toMatch(/user management/i);
  });

  it('clears permissions when an admin is demoted to a non-admin role', async () => {
    const acme = await provisionTenant({ ...ACME });
    const admin = await createUser({
      tenantId: String(acme._id),
      name: 'Second Admin',
      email: 'admin2@acme.com',
      password: 'secret123',
      role: 'admin'
    });

    const patched = await request
      .patch(`/api/v1/platform/users/${admin.id}`)
      .set(auth())
      .send({ tenantId: String(acme._id), role: 'driver' })
      .expect(200);

    expect(patched.body.user.role).toBe('driver');
    expect(patched.body.user.permissions).toEqual([]);
  });
});
