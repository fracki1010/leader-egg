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
import { Product, displayName } from '../../products/model.js';
import { Customer } from '../../customers/model.js';
import { Supplier } from '../../suppliers/model.js';
import { StockTransaction } from '../../inventory/transaction-model.js';
import { resetLoginRateLimits } from '../../auth/rate-limit.js';

/**
 * Platform-run punto cero.
 *
 * A platform (super) admin reads and runs the FULL punto cero FOR a specific
 * tenant. Every read/write must land in the target tenant's database only —
 * these tests provision two tenants and prove scoping, the `force` reset
 * semantics, the auth guard and the unchanged tenant-facing one-time behavior.
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

const scoped = <T>(tenant: ITenant, fn: () => T): T =>
  runWithTenancy(
    { connection: getTenantConnection(tenant.dbName), tenantId: String(tenant._id) },
    fn
  );

interface TenantFixtures {
  productId: string;
  productName: string;
  customerId: string;
  customerName: string;
  supplierId: string;
  supplierName: string;
}

/**
 * Adds a distinct customer + supplier to a tenant and returns the ids of the
 * referenced product/customer/supplier. Provisioning already seeds the 10
 * products (zero stock) and the walk-in customer.
 */
const seedBusinessData = async (tenant: ITenant, suffix: string): Promise<TenantFixtures> =>
  scoped(tenant, async () => {
    const product = await Product.findOne({ variety: 'blanco', caliber: 'chico' });
    if (!product) throw new Error('Seeded product not found');
    const customer = await Customer.create({
      name: `Cliente ${suffix}`,
      type: 'B2C',
      phone: '555-0000',
      address: `Calle ${suffix} 1`
    });
    const supplier = await Supplier.create({ name: `Proveedor ${suffix}` });
    return {
      productId: String(product._id),
      productName: displayName(product),
      customerId: String(customer._id),
      customerName: customer.name,
      supplierId: String(supplier._id),
      supplierName: supplier.name
    };
  });

const provisionPair = async (): Promise<{ acme: ITenant; globex: ITenant }> => {
  const acme = await provisionTenant({ ...ACME });
  const globex = await provisionTenant({ ...GLOBEX });
  return { acme, globex };
};

interface PuntoCeroView {
  tenant: { id: string; name: string; slug: string };
  state: {
    finalized: boolean;
    finalizedAt: string | null;
    openingBalances: { cash: number; mp: number; bank: number };
    openingBalancesSetAt: { cash: string | null; mp: string | null; bank: string | null };
  };
  products: Array<{ id: string; name: string; maplesPerCajon: number; stock: number }>;
  customers: Array<{ id: string; name: string; openingDebt: number }>;
  suppliers: Array<{ id: string; name: string; openingDebt: number }>;
}

const getView = async (tenantId: string): Promise<PuntoCeroView> => {
  const response = await request
    .get(`/api/v1/platform/tenants/${tenantId}/punto-cero`)
    .set(auth())
    .expect(200);
  return response.body as PuntoCeroView;
};

const postSetup = (tenantId: string, body: Record<string, unknown>) =>
  request
    .post(`/api/v1/platform/tenants/${tenantId}/punto-cero`)
    .set(auth())
    .send(body);

describe('Platform punto cero API — /api/v1/platform/tenants/:id/punto-cero', () => {
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

  describe('GET', () => {
    it("returns only tenant A's products/customers/suppliers and unfinalized state", async () => {
      const { acme, globex } = await provisionPair();
      const fixturesA = await seedBusinessData(acme, 'Acme');
      const fixturesB = await seedBusinessData(globex, 'Globex');

      const view = await getView(String(acme._id));

      expect(view.tenant).toEqual({
        id: String(acme._id),
        name: 'Acme Eggs',
        slug: 'acme'
      });
      expect(view.state).toEqual({
        finalized: false,
        finalizedAt: null,
        openingBalances: { cash: 0, mp: 0, bank: 0 },
        openingBalancesSetAt: { cash: null, mp: null, bank: null }
      });

      // All 10 seeded products, zero stock, deterministic name ordering.
      expect(view.products).toHaveLength(10);
      expect(view.products.every((p) => p.stock === 0)).toBe(true);
      expect(view.products.find((p) => p.id === fixturesA.productId)).toMatchObject({
        name: fixturesA.productName,
        maplesPerCajon: 12,
        stock: 0
      });
      const productNames = view.products.map((p) => p.name);
      expect(productNames).toEqual([...productNames].sort((a, b) => a.localeCompare(b)));

      // A's customer/supplier present; B's absent.
      expect(view.customers.find((c) => c.id === fixturesA.customerId)).toEqual({
        id: fixturesA.customerId,
        name: fixturesA.customerName,
        openingDebt: 0
      });
      expect(view.customers.find((c) => c.id === fixturesB.customerId)).toBeUndefined();
      expect(view.suppliers.find((s) => s.id === fixturesA.supplierId)).toMatchObject({
        name: fixturesA.supplierName,
        openingDebt: 0
      });
      expect(view.suppliers.find((s) => s.id === fixturesB.supplierId)).toBeUndefined();
      // B's product ids (a separate DB) never appear in A's list.
      expect(view.products.find((p) => p.id === fixturesB.productId)).toBeUndefined();

      const customerNames = view.customers.map((c) => c.name);
      expect(customerNames).toEqual([...customerNames].sort((a, b) => a.localeCompare(b)));
      const supplierNames = view.suppliers.map((s) => s.name);
      expect(supplierNames).toEqual([...supplierNames].sort((a, b) => a.localeCompare(b)));
    });

    it('returns 404 for an unknown tenant and 401 without a platform token', async () => {
      await request
        .get(`/api/v1/platform/tenants/${new mongoose.Types.ObjectId()}/punto-cero`)
        .set(auth())
        .expect(404);

      await request.get('/api/v1/platform/tenants/whatever/punto-cero').expect(401);
    });
  });

  describe('POST', () => {
    it("runs punto cero for tenant A and leaves tenant B untouched", async () => {
      const { acme, globex } = await provisionPair();
      const fixturesA = await seedBusinessData(acme, 'Acme');
      const fixturesB = await seedBusinessData(globex, 'Globex');

      const response = await postSetup(String(acme._id), {
        stock: [{ productId: fixturesA.productId, quantity: 50 }],
        openingBalances: { cash: 1000, mp: 200, bank: 50 },
        clientDebts: [{ customerId: fixturesA.customerId, amount: 3000 }],
        supplierDebts: [{ supplierId: fixturesA.supplierId, amount: 700 }]
      }).expect(200);

      const body = response.body as PuntoCeroView;
      expect(body.tenant.id).toBe(String(acme._id));
      expect(body.state.finalized).toBe(true);
      expect(typeof body.state.finalizedAt).toBe('string');
      expect(body.state.openingBalances).toEqual({ cash: 1000, mp: 200, bank: 50 });
      // Every positive balance written by the setup is locked.
      expect(body.state.openingBalancesSetAt.cash).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(body.state.openingBalancesSetAt.mp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(body.state.openingBalancesSetAt.bank).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(body.products.find((p) => p.id === fixturesA.productId)?.stock).toBe(50);
      expect(body.customers.find((c) => c.id === fixturesA.customerId)?.openingDebt).toBe(3000);
      expect(body.suppliers.find((s) => s.id === fixturesA.supplierId)?.openingDebt).toBe(700);

      // The opening transaction records the platform marker, not a tenant user.
      const openingTxns = await scoped(acme, () =>
        StockTransaction.find({ type: 'opening', productId: fixturesA.productId })
      );
      expect(openingTxns).toHaveLength(1);
      expect(openingTxns[0]!.createdBy).toMatch(/^platform:/);

      // Tenant B keeps its own, untouched (zero) state.
      const viewB = await getView(String(globex._id));
      expect(viewB.state).toEqual({
        finalized: false,
        finalizedAt: null,
        openingBalances: { cash: 0, mp: 0, bank: 0 },
        openingBalancesSetAt: { cash: null, mp: null, bank: null }
      });
      expect(viewB.products.every((p) => p.stock === 0)).toBe(true);
      expect(viewB.customers.find((c) => c.id === fixturesB.customerId)?.openingDebt).toBe(0);
      expect(viewB.suppliers.find((s) => s.id === fixturesB.supplierId)?.openingDebt).toBe(0);

      // And A's data is not visible through B's GET.
      expect(viewB.customers.find((c) => c.id === fixturesA.customerId)).toBeUndefined();
      expect(viewB.suppliers.find((s) => s.id === fixturesA.supplierId)).toBeUndefined();
      expect(viewB.products.find((p) => p.id === fixturesA.productId)).toBeUndefined();
    });

    it('re-runs only with force: true, overwriting the values and appending opening rows', async () => {
      const { acme } = await provisionPair();
      const fixtures = await seedBusinessData(acme, 'Acme');

      await postSetup(String(acme._id), {
        stock: [{ productId: fixtures.productId, quantity: 50 }],
        openingBalances: { cash: 1000, mp: 200, bank: 50 },
        clientDebts: [{ customerId: fixtures.customerId, amount: 3000 }]
      }).expect(200);

      // Second run WITHOUT force → 409 and nothing changes.
      const conflict = await postSetup(String(acme._id), {
        openingBalances: { cash: 999 },
        stock: [{ productId: fixtures.productId, quantity: 7 }],
        clientDebts: [{ customerId: fixtures.customerId, amount: 11 }]
      }).expect(409);
      expect(conflict.body.error).toBe('Punto cero ya fue finalizado');

      let view = await getView(String(acme._id));
      expect(view.state.openingBalances).toEqual({ cash: 1000, mp: 200, bank: 50 });
      expect(view.products.find((p) => p.id === fixtures.productId)?.stock).toBe(50);
      expect(view.customers.find((c) => c.id === fixtures.customerId)?.openingDebt).toBe(3000);

      // Forced run → 200 and the provided values overwrite the previous ones.
      const forced = await postSetup(String(acme._id), {
        force: true,
        openingBalances: { cash: 999 },
        stock: [{ productId: fixtures.productId, quantity: 7 }],
        clientDebts: [{ customerId: fixtures.customerId, amount: 11 }]
      }).expect(200);

      const forcedBody = forced.body as PuntoCeroView;
      expect(forcedBody.state.finalized).toBe(true);
      expect(forcedBody.state.openingBalances).toEqual({ cash: 999, mp: 200, bank: 50 });
      // Force overwrites and re-locks the written accounts.
      expect(forcedBody.state.openingBalancesSetAt.cash).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(forcedBody.state.openingBalancesSetAt.mp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(forcedBody.state.openingBalancesSetAt.bank).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(forcedBody.products.find((p) => p.id === fixtures.productId)?.stock).toBe(7);
      expect(forcedBody.customers.find((c) => c.id === fixtures.customerId)?.openingDebt).toBe(11);

      view = await getView(String(acme._id));
      expect(view.state.openingBalances.cash).toBe(999);
      expect(view.products.find((p) => p.id === fixtures.productId)?.stock).toBe(7);

      // Append-only ledger: the forced run added a second opening row.
      const openingTxns = await scoped(acme, () =>
        StockTransaction.find({ type: 'opening', productId: fixtures.productId })
      );
      expect(openingTxns).toHaveLength(2);
    });

    it('returns 404 for an unknown product reference', async () => {
      const { acme } = await provisionPair();

      const response = await postSetup(String(acme._id), {
        stock: [{ productId: new mongoose.Types.ObjectId().toString(), quantity: 5 }]
      }).expect(404);
      expect(response.body.error).toBe('Product not found');

      const view = await getView(String(acme._id));
      expect(view.state.finalized).toBe(false);
    });
  });

  describe('Auth guard', () => {
    it('rejects a tenant token (401) and accepts a platform token (200)', async () => {
      const { acme } = await provisionPair();

      const tenantLogin = await request
        .post('/api/v1/auth/login')
        .send({ email: ACME.adminEmail, password: ACME.adminPassword })
        .expect(200);
      const tenantToken = tenantLogin.body.token as string;

      await request
        .get(`/api/v1/platform/tenants/${String(acme._id)}/punto-cero`)
        .set('Authorization', `Bearer ${tenantToken}`)
        .expect(401);

      await request
        .post(`/api/v1/platform/tenants/${String(acme._id)}/punto-cero`)
        .set('Authorization', `Bearer ${tenantToken}`)
        .send({ openingCash: 1 })
        .expect(401);

      await request
        .get(`/api/v1/platform/tenants/${String(acme._id)}/punto-cero`)
        .set(auth())
        .expect(200);
    });
  });

  describe('Tenant-facing regression', () => {
    it('keeps POST /v1/setup/punto-cero one-time (409 after a platform finalize)', async () => {
      const { acme } = await provisionPair();
      const fixtures = await seedBusinessData(acme, 'Acme');

      await postSetup(String(acme._id), {
        openingBalances: { cash: 1000 },
        stock: [{ productId: fixtures.productId, quantity: 10 }],
        force: true
      }).expect(200);

      const tenantLogin = await request
        .post('/api/v1/auth/login')
        .send({ email: ACME.adminEmail, password: ACME.adminPassword })
        .expect(200);
      const tenantToken = tenantLogin.body.token as string;

      const response = await request
        .post('/api/v1/setup/punto-cero')
        .set('Authorization', `Bearer ${tenantToken}`)
        .send({ openingCash: 1 })
        .expect(409);
      expect(response.body.error).toBe('Punto cero ya fue finalizado');
    });
  });
});
