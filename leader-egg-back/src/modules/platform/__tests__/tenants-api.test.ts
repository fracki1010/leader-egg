import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import supertest from 'supertest';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { startTestDatabase, stopTestDatabase, clearDatabase } from '../../../__tests__/helpers.js';
import { app } from '../../../app.js';
import { PlatformAdmin } from '../../../tenancy/master-models.js';

const request = supertest(app);

const PLATFORM_EMAIL = 'platform@test.com';
const PLATFORM_PASSWORD = 'platform-secret';

let platformToken: string;

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

const tenantExists = async (dbName: string): Promise<boolean> => {
  const { databases } = await mongoose.connection.db!.admin().listDatabases();
  return databases.map((db) => db.name).includes(dbName);
};

const createPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'Acme Eggs',
  slug: 'acme',
  adminName: 'Acme Admin',
  adminEmail: 'admin@acme.com',
  adminPassword: 'secret123',
  ...overrides
});

describe('Platform tenants API — /api/v1/platform/tenants', () => {
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

    const passwordHash = await bcrypt.hash(PLATFORM_PASSWORD, 10);
    await PlatformAdmin.create({ name: 'Platform Admin', email: PLATFORM_EMAIL, passwordHash });

    const login = await request
      .post('/api/v1/platform/auth/login')
      .send({ email: PLATFORM_EMAIL, password: PLATFORM_PASSWORD })
      .expect(200);
    platformToken = login.body.token;
  });

  afterEach(async () => {
    await dropTenantDatabases();
  });

  describe('POST /tenants', () => {
    it('provisions a tenant and returns 201 with the tenant', async () => {
      const response = await request
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${platformToken}`)
        .send(createPayload())
        .expect(201);

      expect(response.body.tenant).toMatchObject({
        name: 'Acme Eggs',
        slug: 'acme',
        dbName: 'tenant_acme',
        active: true
      });
      expect(await tenantExists('tenant_acme')).toBe(true);
    });

    it('returns 409 on a duplicate slug', async () => {
      await request
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${platformToken}`)
        .send(createPayload())
        .expect(201);

      const response = await request
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${platformToken}`)
        .send(createPayload({ adminEmail: 'other@acme.com' }))
        .expect(409);

      expect(response.body.error).toMatch(/slug|database name/i);
    });
  });

  describe('GET /tenants', () => {
    it('lists the created tenant with a per-tenant user count', async () => {
      await request
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${platformToken}`)
        .send(createPayload())
        .expect(201);

      const response = await request
        .get('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${platformToken}`)
        .expect(200);

      const acme = (response.body as Array<Record<string, unknown>>).find(
        (t) => t.slug === 'acme'
      );
      expect(acme).toBeDefined();
      expect(acme).toMatchObject({ dbName: 'tenant_acme', active: true, userCount: 1 });
    });
  });

  describe('PATCH /tenants/:id', () => {
    it('suspends a tenant and blocks its users from logging in', async () => {
      const created = await request
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${platformToken}`)
        .send(createPayload())
        .expect(201);

      const tenantId = created.body.tenant.id as string;

      const patched = await request
        .patch(`/api/v1/platform/tenants/${tenantId}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ active: false })
        .expect(200);

      expect(patched.body.tenant.active).toBe(false);

      // Tenant users can no longer log in.
      const loginResponse = await request
        .post('/api/v1/auth/login')
        .send({ email: 'admin@acme.com', password: 'secret123' })
        .expect(403);
      expect(loginResponse.body.error).toMatch(/suspend/i);
    });

    it('renames a tenant', async () => {
      const created = await request
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${platformToken}`)
        .send(createPayload())
        .expect(201);

      const tenantId = created.body.tenant.id as string;

      const patched = await request
        .patch(`/api/v1/platform/tenants/${tenantId}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ name: 'Acme Renamed' })
        .expect(200);

      expect(patched.body.tenant).toMatchObject({
        name: 'Acme Renamed',
        slug: 'acme',
        dbName: 'tenant_acme'
      });
    });
  });

  describe('DELETE /tenants/:id', () => {
    it('rejects a mismatched confirmation (400)', async () => {
      const created = await request
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${platformToken}`)
        .send(createPayload())
        .expect(201);

      const tenantId = created.body.tenant.id as string;

      await request
        .delete(`/api/v1/platform/tenants/${tenantId}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ confirm: 'wrong-slug' })
        .expect(400);

      expect(await tenantExists('tenant_acme')).toBe(true);
    });

    it('drops the tenant database with a matching confirmation (204)', async () => {
      const created = await request
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${platformToken}`)
        .send(createPayload())
        .expect(201);

      const tenantId = created.body.tenant.id as string;

      await request
        .delete(`/api/v1/platform/tenants/${tenantId}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ confirm: 'acme' })
        .expect(204);

      expect(await tenantExists('tenant_acme')).toBe(false);
    });
  });
});
