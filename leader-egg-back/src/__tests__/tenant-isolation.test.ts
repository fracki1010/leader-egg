import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

import { startTestDatabase, stopTestDatabase, clearDatabase } from './helpers.js';
import { app } from '../app.js';
import { env } from '../config/env.js';
import { provisionTenant, suspendTenant } from '../tenancy/tenants.js';
import { getTenantConnection } from '../tenancy/registry.js';
import { getMasterConnection, platformDbName } from '../tenancy/master.js';
import { runWithTenancy } from '../tenancy/context.js';
import { Product } from '../modules/products/model.js';
import { Customer } from '../modules/customers/model.js';

/**
 * End-to-end tenant isolation suite.
 *
 * This is the guard for the whole database-per-tenant architecture: it drives
 * the REAL Express app through supertest against a real (in-memory) MongoDB,
 * provisions two tenants, and proves that every read, write and cross-reference
 * is confined to the caller's tenant database.
 *
 * If someone breaks the scoped-model resolution (e.g. a model stops using
 * `createScopedModel`, or `runWithTenancy` is dropped from `authenticate`),
 * these assertions MUST fail.
 */

const request = supertest(app);

const ACME = {
  name: 'Acme Corp',
  slug: 'acme',
  adminName: 'Acme Admin',
  adminEmail: 'admin@acme.test',
  adminPassword: 'acme-secret-123'
} as const;

const GLOBEX = {
  name: 'Globex',
  slug: 'globex',
  adminName: 'Globex Admin',
  adminEmail: 'admin@globex.test',
  adminPassword: 'globex-secret-123'
} as const;

/** Product removed from globex so the two tenants have different product sets. */
const GLOBEX_MISSING_PRODUCT = { variety: 'castaño', caliber: 'surtido' } as const;

const ACME_EXTRA_CUSTOMER = {
  name: 'Acme Extra Customer',
  type: 'B2C',
  phone: '555-0001',
  address: 'Acme Street 1'
} as const;

const WALK_IN_NAME = 'Puesto (mostrador)';

/** Drops every `tenant_*` database created by provisioning. */
const dropTenantDatabases = async (): Promise<void> => {
  const admin = mongoose.connection.db!.admin();
  const { databases } = await admin.listDatabases();
  for (const db of databases) {
    if (db.name?.startsWith('tenant_')) {
      await mongoose.connection.useDb(db.name).dropDatabase();
    }
  }
};

const bearer = (token: string): string => `Bearer ${token}`;

interface LoginResponse {
  token: string;
  user: { _id: string; email: string; role: string };
  tenant: { id: string; name: string; slug: string };
}

const login = async (email: string, password: string): Promise<LoginResponse> => {
  const response = await request.post('/api/v1/auth/login').send({ email, password }).expect(200);
  return response.body as LoginResponse;
};

/** Product `_id`s stored in a tenant DB, read directly (bypassing the API). */
const productIdsInTenantDb = async (
  connection: mongoose.Connection,
  tenantId: string
): Promise<string[]> =>
  runWithTenancy({ connection, tenantId }, async () => {
    const products = await Product.find().select('_id');
    return products.map((p) => p._id.toString()).sort();
  });

/**
 * Provisions the two tenants and makes them distinguishable:
 *  - globex is missing one product (`castaño-surtido`) → 9 products vs acme's 10
 *  - acme gets an extra customer
 *
 * Returns the tenant docs, connections, tokens and the created customer id.
 */
const provisionPair = async () => {
  const acme = await provisionTenant({ ...ACME });
  const globex = await provisionTenant({ ...GLOBEX });

  const acmeConn = getTenantConnection(acme.dbName);
  const globexConn = getTenantConnection(globex.dbName);

  // Differentiate globex's product set (10 → 9) directly on its own DB.
  await runWithTenancy({ connection: globexConn, tenantId: String(globex._id) }, () =>
    Product.deleteOne(GLOBEX_MISSING_PRODUCT)
  );

  const acmeLogin = await login(ACME.adminEmail, ACME.adminPassword);
  const globexLogin = await login(GLOBEX.adminEmail, GLOBEX.adminPassword);

  // Extra acme customer created through the real API (exercises the tenant path).
  const created = await request
    .post('/api/v1/customers')
    .set('Authorization', bearer(acmeLogin.token))
    .send(ACME_EXTRA_CUSTOMER)
    .expect(201);

  return {
    acme,
    globex,
    acmeConn,
    globexConn,
    acmeLogin,
    globexLogin,
    acmeToken: acmeLogin.token,
    globexToken: globexLogin.token,
    acmeExtraCustomerId: created.body._id as string
  };
};

/**
 * Creates one order in acme: adds an active price for acme's first product and
 * then creates a walk-in order as acme's admin. Returns the created ids.
 */
const createAcmeOrder = async (acmeToken: string) => {
  const auth = bearer(acmeToken);

  const products = await request.get('/api/v1/products').set('Authorization', auth).expect(200);
  const productId = products.body[0]._id as string;

  const customers = await request.get('/api/v1/customers').set('Authorization', auth).expect(200);
  const walkIn = (customers.body as Array<{ _id: string; name: string }>).find(
    (c) => c.name === WALK_IN_NAME
  );
  if (!walkIn) throw new Error('Walk-in customer not found for acme');

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await request
    .post(`/api/v1/products/${productId}/prices`)
    .set('Authorization', auth)
    .send({ price: 30, effectiveFrom: yesterday })
    .expect(201);

  const order = await request
    .post('/api/v1/orders')
    .set('Authorization', auth)
    .send({
      customerId: walkIn._id,
      channel: 'phone',
      items: [{ productId, quantity: 1 }],
      bypassCreditCheck: true
    })
    .expect(201);

  return { orderId: order.body._id as string, productId, customerId: walkIn._id };
};

describe('Tenant isolation (end-to-end)', () => {
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

  it('routes login to the right tenant and signs a distinct tenantId per admin', async () => {
    const { acme, globex, acmeLogin, globexLogin } = await provisionPair();

    const acmePayload = jwt.verify(acmeLogin.token, env.JWT_SECRET, {
      audience: 'tenant'
    }) as { tenantId: string };
    const globexPayload = jwt.verify(globexLogin.token, env.JWT_SECRET, {
      audience: 'tenant'
    }) as { tenantId: string };

    // Routing by human email → the tenant that owns that account.
    expect(acmePayload.tenantId).toBe(String(acme._id));
    expect(globexPayload.tenantId).toBe(String(globex._id));
    expect(acmePayload.tenantId).not.toBe(globexPayload.tenantId);

    // The human email is carried on the login response, tied to the same tenant.
    expect(acmeLogin.user.email).toBe(ACME.adminEmail);
    expect(acmeLogin.tenant.slug).toBe('acme');
    expect(globexLogin.user.email).toBe(GLOBEX.adminEmail);
    expect(globexLogin.tenant.slug).toBe('globex');
  });

  it('returns only the caller tenant products (zero overlap between tenants)', async () => {
    const { acme, globex, acmeConn, globexConn, acmeToken, globexToken } = await provisionPair();

    const acmeApi = await request
      .get('/api/v1/products')
      .set('Authorization', bearer(acmeToken))
      .expect(200);
    const globexApi = await request
      .get('/api/v1/products')
      .set('Authorization', bearer(globexToken))
      .expect(200);

    const acmeApiIds = (acmeApi.body as Array<{ _id: string }>).map((p) => p._id).sort();
    const globexApiIds = (globexApi.body as Array<{ _id: string }>).map((p) => p._id).sort();

    const acmeDbIds = await productIdsInTenantDb(acmeConn, String(acme._id));
    const globexDbIds = await productIdsInTenantDb(globexConn, String(globex._id));

    // Exact sets: the API returns precisely the documents in that tenant's DB.
    expect(acmeApiIds).toEqual(acmeDbIds);
    expect(globexApiIds).toEqual(globexDbIds);

    // Known, deterministic counts (acme seeded 10, globex had 1 removed).
    expect(acmeApiIds).toHaveLength(10);
    expect(globexApiIds).toHaveLength(9);

    // ZERO overlap — the money assertion.
    const overlap = acmeApiIds.filter((id) => globexApiIds.includes(id));
    expect(overlap).toHaveLength(0);
    expect(new Set(acmeApiIds).size + new Set(globexApiIds).size).toBe(acmeApiIds.length + globexApiIds.length);
  });

  it('does not leak a tenant customer to another tenant', async () => {
    const { acmeToken, globexToken, acmeExtraCustomerId } = await provisionPair();

    const acmeCustomers = await request
      .get('/api/v1/customers')
      .set('Authorization', bearer(acmeToken))
      .expect(200);
    const globexCustomers = await request
      .get('/api/v1/customers')
      .set('Authorization', bearer(globexToken))
      .expect(200);

    const acmeIds = (acmeCustomers.body as Array<{ _id: string }>).map((c) => c._id);
    const globexIds = (globexCustomers.body as Array<{ _id: string }>).map((c) => c._id);

    // acme has the seeded walk-in customer plus the extra one; globex only walk-in.
    expect(acmeIds).toContain(acmeExtraCustomerId);
    expect(acmeIds).toHaveLength(2);
    expect(globexIds).toHaveLength(1);
    expect(globexIds).not.toContain(acmeExtraCustomerId);
  });

  it('confines writes to the tenant that performed them', async () => {
    const { globexToken, acmeToken } = await provisionPair();

    const globexBefore = await request
      .get('/api/v1/products')
      .set('Authorization', bearer(globexToken))
      .expect(200);

    // Write as acme (price + order) — both must land in acme's DB only.
    await createAcmeOrder(acmeToken);

    const globexAfter = await request
      .get('/api/v1/products')
      .set('Authorization', bearer(globexToken))
      .expect(200);
    const globexOrders = await request
      .get('/api/v1/orders')
      .set('Authorization', bearer(globexToken))
      .expect(200);
    const acmeOrders = await request
      .get('/api/v1/orders')
      .set('Authorization', bearer(acmeToken))
      .expect(200);

    // globex's product list is untouched...
    expect((globexAfter.body as unknown[]).length).toBe((globexBefore.body as unknown[]).length);
    expect((globexAfter.body as unknown[]).length).toBe(9);

    // ...and the order acme created is invisible to globex.
    expect(globexOrders.body.total).toBe(0);
    expect(globexOrders.body.items).toHaveLength(0);
    expect(acmeOrders.body.total).toBe(1);
  });

  it('fails closed for tokens without a tenant and for suspended tenants', async () => {
    const { globex } = await provisionPair();

    // (a) A syntactically valid token missing `tenantId` → 401.
    const tenantless = jwt.sign(
      { userId: new mongoose.Types.ObjectId().toString(), role: 'admin', jti: randomUUID() },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    await request.get('/api/v1/products').set('Authorization', bearer(tenantless)).expect(401);

    // (b) A token whose tenantId is unknown → 401.
    const unknownTenant = jwt.sign(
      { userId: new mongoose.Types.ObjectId().toString(), role: 'admin', tenantId: new mongoose.Types.ObjectId().toString(), jti: randomUUID() },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    await request.get('/api/v1/products').set('Authorization', bearer(unknownTenant)).expect(401);

    // (c) A valid token for a tenant suspended after it was issued → 403.
    const globexLogin = await login(GLOBEX.adminEmail, GLOBEX.adminPassword);
    await suspendTenant(String(globex._id));
    await request
      .get('/api/v1/products')
      .set('Authorization', bearer(globexLogin.token))
      .expect(403);
  });

  it('does not resolve a cross-tenant ObjectId (404, never the other tenant data)', async () => {
    const { globexToken, acmeToken, acmeExtraCustomerId } = await provisionPair();
    const { orderId, productId } = await createAcmeOrder(acmeToken);

    // acme's own references resolve for acme...
    await request
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', bearer(acmeToken))
      .expect(200);
    await request
      .get(`/api/v1/products/${productId}`)
      .set('Authorization', bearer(acmeToken))
      .expect(200);

    // ...but never for globex (existence is not leaked either).
    await request
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', bearer(globexToken))
      .expect(404);
    await request
      .get(`/api/v1/products/${productId}`)
      .set('Authorization', bearer(globexToken))
      .expect(404);
    await request
      .get(`/api/v1/customers/${acmeExtraCustomerId}`)
      .set('Authorization', bearer(globexToken))
      .expect(404);
  });

  it('executes queries against tenant_<slug> databases, never the platform DB', async () => {
    const { acme, globex, acmeConn, globexConn, acmeToken } = await provisionPair();

    // Provisioning derives `tenant_<slug>` and hands back the cached connection
    // for exactly that database.
    expect(acme.dbName).toBe('tenant_acme');
    expect(globex.dbName).toBe('tenant_globex');
    expect(acmeConn.name).toBe('tenant_acme');
    expect(globexConn.name).toBe('tenant_globex');

    // Distinct connections, and neither is the default/base connection.
    expect(acmeConn).not.toBe(globexConn);
    expect(acmeConn).not.toBe(mongoose.connection);
    expect(globexConn).not.toBe(mongoose.connection);

    // `useDb(..., { useCache: true })` returns the same cached connection.
    expect(getTenantConnection(acme.dbName)).toBe(acmeConn);

    // The platform (master) DB is its own database and holds NO tenant data.
    const master = getMasterConnection();
    expect(master.name).toBe(platformDbName);
    expect(master).not.toBe(mongoose.connection);
    expect(await master.db!.collection('products').countDocuments()).toBe(0);
    expect(await master.db!.collection('orders').countDocuments()).toBe(0);

    // The requested products really live on the acme connection.
    const api = await request
      .get('/api/v1/products')
      .set('Authorization', bearer(acmeToken))
      .expect(200);
    const servedIds = (api.body as Array<{ _id: string }>).map((p) => p._id).sort();
    const acmeDbIds = await productIdsInTenantDb(acmeConn, String(acme._id));
    expect(servedIds).toEqual(acmeDbIds);
  });
});
