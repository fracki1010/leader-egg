import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { startTestDatabase, stopTestDatabase, clearDatabase } from '../../../__tests__/helpers.js';
import { app } from '../../../app.js';
import { env } from '../../../config/env.js';
import { provisionTenant } from '../../../tenancy/tenants.js';
import { getTenantConnection } from '../../../tenancy/registry.js';
import { runWithTenancy } from '../../../tenancy/context.js';
import { Product } from '../../products/model.js';

const request = supertest(app);

const dropTenantDatabases = async (): Promise<void> => {
  const admin = mongoose.connection.db!.admin();
  const { databases } = await admin.listDatabases();
  for (const db of databases) {
    if (db.name?.startsWith('tenant_')) {
      await mongoose.connection.useDb(db.name).dropDatabase();
    }
  }
};

describe('Tenant-aware authentication', () => {
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
  });

  it('routes login to the tenant and carries tenantId in the token', async () => {
    const t1 = await provisionTenant({
      name: 'Tenant One',
      slug: 't-one',
      adminName: 'Admin One',
      adminEmail: 'admin1@t.com',
      adminPassword: 'secret123'
    });

    const response = await request
      .post('/api/v1/auth/login')
      .send({ email: 'admin1@t.com', password: 'secret123' })
      .expect(200);

    expect(response.body.tenant).toMatchObject({
      id: String(t1._id),
      name: 'Tenant One',
      slug: 't-one'
    });

    const decoded = jwt.verify(response.body.token, env.JWT_SECRET, {
      audience: 'tenant'
    }) as { tenantId: string };
    expect(decoded.tenantId).toBe(String(t1._id));
  });

  it('reads only the requesting tenant data (isolation)', async () => {
    const t1 = await provisionTenant({
      name: 'Tenant One',
      slug: 't-one',
      adminName: 'Admin One',
      adminEmail: 'admin1@t.com',
      adminPassword: 'secret123'
    });
    const t2 = await provisionTenant({
      name: 'Tenant Two',
      slug: 't-two',
      adminName: 'Admin Two',
      adminEmail: 'admin2@t.com',
      adminPassword: 'secret123'
    });

    // Wipe tenant 2's products so the two tenants are clearly distinguishable.
    await runWithTenancy(
      { connection: getTenantConnection(t2.dbName), tenantId: String(t2._id) },
      () => Product.deleteMany({})
    );

    const t1Login = await request
      .post('/api/v1/auth/login')
      .send({ email: 'admin1@t.com', password: 'secret123' })
      .expect(200);
    const t2Login = await request
      .post('/api/v1/auth/login')
      .send({ email: 'admin2@t.com', password: 'secret123' })
      .expect(200);

    const t1Products = await request
      .get('/api/v1/products')
      .set('Authorization', `Bearer ${t1Login.body.token}`)
      .expect(200);
    const t2Products = await request
      .get('/api/v1/products')
      .set('Authorization', `Bearer ${t2Login.body.token}`)
      .expect(200);

    expect(t1Products.body).toHaveLength(10);
    expect(t2Products.body).toHaveLength(0);
  });

  it('fails closed (401) for a token without tenantId', async () => {
    const tokenWithoutTenant = jwt.sign(
      { userId: new mongoose.Types.ObjectId().toString(), role: 'admin', jti: randomUUID() },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    await request
      .get('/api/v1/products')
      .set('Authorization', `Bearer ${tokenWithoutTenant}`)
      .expect(401);
  });
});
