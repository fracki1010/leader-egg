import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import supertest from 'supertest';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { startTestDatabase, stopTestDatabase, clearDatabase } from '../../../__tests__/helpers.js';
import { app } from '../../../app.js';
import { provisionTenant } from '../../../tenancy/tenants.js';
import { PlatformAdmin, type ITenant } from '../../../tenancy/master-models.js';
import { getTenantConnection } from '../../../tenancy/registry.js';
import { runWithTenancy } from '../../../tenancy/context.js';
import { Product } from '../../products/model.js';
import { Customer } from '../../customers/model.js';
import { Inventory } from '../../inventory/model.js';
import { BusinessConfig } from '../../config/model.js';
import { User } from '../../auth/model.js';
import { resetLoginRateLimits } from '../../auth/rate-limit.js';

/**
 * Platform tenant-data reset.
 *
 * `POST /v1/platform/tenants/:id/reset` clears ONE tenant's business collections
 * while keeping reference data, zeroing stock in place and resetting the
 * business config. These tests prove the exact keep/delete/zero semantics, the
 * slug guard, idempotency and the platform-only auth.
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

const scoped = <T>(tenant: ITenant, fn: () => T): T =>
  runWithTenancy(
    { connection: getTenantConnection(tenant.dbName), tenantId: String(tenant._id) },
    fn
  );

interface SeedSummary {
  productId: string;
  customerId: string;
  productCount: number;
  customerCount: number;
  userCount: number;
}

/**
 * Seeds one tenant with business data: an order/payment/expense history, stock
 * on a seeded product, a finalized business config and a customer with opening
 * debt. Heavy/append-only collections are inserted with the raw driver.
 */
const seedTenant = async (tenant: ITenant): Promise<SeedSummary> => {
  const connection = getTenantConnection(tenant.dbName);
  const db = connection.db!;

  const summary = await scoped(tenant, async () => {
    const product = await Product.findOne({ variety: 'blanco', caliber: 'chico' });
    if (!product) throw new Error('Seeded product not found');

    await Inventory.updateOne({ productId: product._id }, { $set: { quantity: 40 } });

    const customer = await Customer.create({
      name: 'Cliente con deuda',
      type: 'B2C',
      phone: '555-1234',
      address: 'Calle 1',
      openingDebt: 2500
    });

    await User.create({
      name: 'Reset Admin',
      email: `reset-${tenant.slug}@test.com`,
      passwordHash: 'not-a-real-hash',
      role: 'admin'
    });

    await BusinessConfig.create({
      openingCash: 9000,
      openingBalances: { cash: 9000, mp: 500, bank: 200 },
      openingBalancesSetAt: { cash: new Date(), mp: new Date(), bank: new Date() },
      puntoCeroFinalized: true,
      puntoCeroFinalizedAt: new Date()
    });

    return {
      productId: String(product._id),
      customerId: String(customer._id),
      productCount: await Product.countDocuments(),
      customerCount: await Customer.countDocuments(),
      userCount: await User.countDocuments()
    };
  });

  await db.collection('orders').insertMany([
    { orderNumber: 'ORD-1', customerId: new mongoose.Types.ObjectId() },
    { orderNumber: 'ORD-2', customerId: new mongoose.Types.ObjectId() }
  ]);
  await db
    .collection('payments')
    .insertOne({ orderId: new mongoose.Types.ObjectId(), amount: 100, method: 'cash' });
  await db.collection('expenses').insertOne({
    amount: 50,
    category: 'other',
    account: 'cash',
    description: 'Test expense',
    createdBy: 'tester'
  });
  await db.collection('purchases').insertOne({ amount: 10 });
  await db.collection('dailycloses').insertOne({ date: new Date() });

  return summary;
};

const postReset = (tenantId: string, body: Record<string, unknown>) =>
  request.post(`/api/v1/platform/tenants/${tenantId}/reset`).set(auth()).send(body);

describe('Platform tenant reset API — /api/v1/platform/tenants/:id/reset', () => {
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

  it('clears business data, keeps reference data, zeroes stock and resets config', async () => {
    const acme = await provisionTenant({ ...ACME });
    const seeded = await seedTenant(acme);

    const response = await postReset(String(acme._id), { confirm: 'acme' }).expect(200);
    const body = response.body as {
      tenant: { id: string; name: string; slug: string };
      deleted: Record<string, number>;
      kept: Record<string, number>;
      inventoryZeroed: number;
      customerDebtsZeroed: boolean;
      configReset: boolean;
    };

    expect(body.tenant).toEqual({
      id: String(acme._id),
      name: 'Acme Eggs',
      slug: 'acme'
    });
    expect(body.deleted).toMatchObject({
      orders: 2,
      payments: 1,
      expenses: 1,
      purchases: 1,
      dailycloses: 1
    });
    expect(body.kept.customers).toBe(seeded.customerCount);
    expect(body.kept.users).toBe(seeded.userCount);
    expect(body.kept.products).toBe(seeded.productCount);
    expect(body.inventoryZeroed).toBeGreaterThanOrEqual(1);
    expect(body.customerDebtsZeroed).toBe(false);
    expect(body.configReset).toBe(true);

    await scoped(acme, async () => {
      const db = getTenantConnection(acme.dbName).db!;
      expect(await db.collection('orders').countDocuments()).toBe(0);
      expect(await db.collection('payments').countDocuments()).toBe(0);
      expect(await db.collection('expenses').countDocuments()).toBe(0);
      expect(await db.collection('purchases').countDocuments()).toBe(0);
      expect(await db.collection('dailycloses').countDocuments()).toBe(0);
      expect(await Customer.countDocuments()).toBe(seeded.customerCount);
      expect(await User.countDocuments()).toBe(seeded.userCount);
      expect(await Product.countDocuments()).toBe(seeded.productCount);

      const inventory = await Inventory.findOne({ productId: seeded.productId });
      expect(inventory?.quantity).toBe(0);

      const config = await BusinessConfig.findOne();
      expect(config).not.toBeNull();
      expect(config?.puntoCeroFinalized).toBe(false);
      expect(config?.puntoCeroFinalizedAt ?? null).toBeNull();
      expect(config?.openingCash).toBe(0);
      expect(config?.openingBalances?.cash).toBe(0);
      expect(config?.openingBalances?.mp).toBe(0);
      expect(config?.openingBalances?.bank).toBe(0);
      // Every one-time opening-balance lock is cleared by the reset.
      expect(config?.openingBalancesSetAt?.cash ?? null).toBeNull();
      expect(config?.openingBalancesSetAt?.mp ?? null).toBeNull();
      expect(config?.openingBalancesSetAt?.bank ?? null).toBeNull();

      // Customer debt is kept unless the caller explicitly opts in.
      const customer = await Customer.findById(seeded.customerId);
      expect(customer?.openingDebt).toBe(2500);
    });
  });

  it('zeroes customer opening debts when zeroCustomerDebt is true', async () => {
    const acme = await provisionTenant({ ...ACME });
    const seeded = await seedTenant(acme);

    const response = await postReset(String(acme._id), {
      confirm: 'acme',
      zeroCustomerDebt: true
    }).expect(200);

    expect(response.body.customerDebtsZeroed).toBe(true);

    await scoped(acme, async () => {
      const customer = await Customer.findById(seeded.customerId);
      expect(customer?.openingDebt).toBe(0);
    });
  });

  it('rejects a wrong confirmation and deletes nothing', async () => {
    const acme = await provisionTenant({ ...ACME });
    await seedTenant(acme);

    const response = await postReset(String(acme._id), { confirm: 'wrong-slug' }).expect(400);
    expect(response.body.error).toBe('Confirmation slug does not match the tenant slug');

    await scoped(acme, async () => {
      const orders = await getTenantConnection(acme.dbName)
        .db!.collection('orders')
        .countDocuments();
      expect(orders).toBe(2);
      const config = await BusinessConfig.findOne();
      expect(config?.puntoCeroFinalized).toBe(true);
    });
  });

  it('is idempotent: a second run succeeds and reports zero deletions', async () => {
    const acme = await provisionTenant({ ...ACME });
    await seedTenant(acme);

    await postReset(String(acme._id), { confirm: 'acme' }).expect(200);

    const second = await postReset(String(acme._id), { confirm: 'acme' }).expect(200);
    const deleted = second.body.deleted as Record<string, number>;
    expect(Object.keys(deleted).length).toBeGreaterThan(0);
    expect(Object.values(deleted).every((count) => count === 0)).toBe(true);
  });

  it('rejects a tenant token (401)', async () => {
    const acme = await provisionTenant({ ...ACME });
    await seedTenant(acme);

    const tenantLogin = await request
      .post('/api/v1/auth/login')
      .send({ email: ACME.adminEmail, password: ACME.adminPassword })
      .expect(200);
    const tenantToken = tenantLogin.body.token as string;

    await request
      .post(`/api/v1/platform/tenants/${String(acme._id)}/reset`)
      .set('Authorization', `Bearer ${tenantToken}`)
      .send({ confirm: 'acme' })
      .expect(401);

    await scoped(acme, async () => {
      expect(await getTenantConnection(acme.dbName).db!.collection('orders').countDocuments()).toBe(
        2
      );
    });
  });
});
