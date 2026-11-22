import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import mongoose, { Types } from 'mongoose';

import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  seedDriverUser,
  loginAs,
  createTestCustomer,
  app
} from './helpers.js';
import { Order } from '../modules/orders/model.js';
import { provisionTenant } from '../tenancy/tenants.js';

const request = supertest(app);

const auth = (token: string): string => `Bearer ${token}`;

/** Minimal non-cancelled order with an outstanding balance. */
const orderPayload = (customerId: Types.ObjectId, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  orderNumber: `ORD-CHG-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  customerId,
  customerName: 'Cliente',
  channel: 'phone',
  items: [{ productId: new Types.ObjectId(), productName: 'Blanco', quantity: 5, unitPrice: 25, subtotal: 125 }],
  totalAmount: 3000,
  status: 'delivered',
  paymentStatus: 'unpaid',
  paidAmount: 0,
  balance: 3000,
  dueDate: null,
  ...overrides
});

interface ChargeBody {
  _id: string;
  customerId: string;
  type: 'charge' | 'credit';
  amount: number;
  reason: string;
  source: string;
}

/** API-level CRUD, balance propagation, auth and append-only guarantees. */
describe('Customer charges — manual debt (cuenta corriente)', () => {
  let adminToken: string;
  let driverToken: string;

  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await dropTenantDatabases();
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  describe('API', () => {
    beforeEach(async () => {
      const admin = await seedAdminUser();
      const driver = await seedDriverUser();
      adminToken = await loginAs(request, admin.email, admin.password);
      driverToken = await loginAs(request, driver.email, driver.password);
    });

    it('creates a charge for a customer with no orders and reflects it everywhere', async () => {
    const customer = await createTestCustomer({ name: 'Solo Fiado' });
    const customerId = String(customer._id);

    const created = await request
      .post(`/api/v1/customers/${customerId}/charges`)
      .set('Authorization', auth(adminToken))
      .send({ type: 'charge', amount: 5000, reason: 'manual_debt', note: 'Fiado inicial' })
      .expect(201);

    const body = created.body as ChargeBody;
    expect(body.type).toBe('charge');
    expect(body.amount).toBe(5000);
    expect(body.reason).toBe('manual_debt');
    expect(body.source).toBe('manual');
    expect(body.customerId).toBe(customerId);

    // creditService / customer outstanding includes the manual term.
    const outstanding = await request
      .get(`/api/v1/orders/customers/${customerId}/outstanding`)
      .set('Authorization', auth(adminToken))
      .expect(200);
    expect(outstanding.body.outstandingBalance).toBe(5000);

    // Accounts list: the charge-only customer appears as its own row.
    const accounts = await request
      .get('/api/v1/accounts')
      .set('Authorization', auth(adminToken))
      .expect(200);
    const row = (accounts.body.items as Array<Record<string, unknown>>).find(
      (r) => r.customerId === customerId
    );
    expect(row).toBeDefined();
    expect(row!.outstandingBalance).toBe(5000);
    expect(row!.openOrdersCount).toBe(0);

    // Dashboard total + debtor count.
    const dashboard = await request
      .get('/api/v1/dashboard/summary')
      .set('Authorization', auth(adminToken))
      .expect(200);
    expect(dashboard.body.porCobrar).toBe(5000);
    expect(dashboard.body.clientesDeudores).toBe(1);

    // Ledger: the manual charge is a visible movement and the summary is right.
    const movements = await request
      .get(`/api/v1/accounts/${customerId}/movements`)
      .set('Authorization', auth(adminToken))
      .expect(200);
    expect(movements.body.summary.outstandingBalance).toBe(5000);
    const chargeMovement = (movements.body.movements as Array<Record<string, unknown>>).find(
      (m) => m.type === 'charge'
    );
    expect(chargeMovement).toMatchObject({
      type: 'charge',
      description: 'Deuda manual',
      amount: 5000,
      sign: '+'
    });
  });

  it('adds the manual charge on top of an order balance with no double count', async () => {
    const customer = await createTestCustomer({ name: 'Mixto' });
    const customerId = String(customer._id);
    const customerObjectId = new Types.ObjectId(customerId);

    await Order.create(orderPayload(customerObjectId));

    await request
      .post(`/api/v1/customers/${customerId}/charges`)
      .set('Authorization', auth(adminToken))
      .send({ type: 'charge', amount: 2000, reason: 'adjustment' })
      .expect(201);

    const outstanding = await request
      .get(`/api/v1/orders/customers/${customerId}/outstanding`)
      .set('Authorization', auth(adminToken))
      .expect(200);
    expect(outstanding.body.outstandingBalance).toBe(5000); // 3000 order + 2000 charge

    const accounts = await request
      .get('/api/v1/accounts')
      .set('Authorization', auth(adminToken))
      .expect(200);
    const row = (accounts.body.items as Array<Record<string, unknown>>).find(
      (r) => r.customerId === customerId
    );
    expect(row!.outstandingBalance).toBe(5000);

    const dashboard = await request
      .get('/api/v1/dashboard/summary')
      .set('Authorization', auth(adminToken))
      .expect(200);
    expect(dashboard.body.porCobrar).toBe(5000);
    expect(dashboard.body.clientesDeudores).toBe(1);

    const deuda = (dashboard.body.deudas as Array<Record<string, unknown>>).find(
      (d) => d.customerId === customerId
    );
    expect(deuda).toMatchObject({ totalDebt: 5000 });
  });

  it('reduces the outstanding balance with a credit (forgiveness)', async () => {
    const customer = await createTestCustomer({ name: 'Con Crédito' });
    const customerId = String(customer._id);

    await request
      .post(`/api/v1/customers/${customerId}/charges`)
      .set('Authorization', auth(adminToken))
      .send({ type: 'charge', amount: 5000, reason: 'manual_debt' })
      .expect(201);
    await request
      .post(`/api/v1/customers/${customerId}/charges`)
      .set('Authorization', auth(adminToken))
      .send({ type: 'credit', amount: 2000, reason: 'forgiveness' })
      .expect(201);

    const outstanding = await request
      .get(`/api/v1/orders/customers/${customerId}/outstanding`)
      .set('Authorization', auth(adminToken))
      .expect(200);
    expect(outstanding.body.outstandingBalance).toBe(3000); // 5000 − 2000

    const dashboard = await request
      .get('/api/v1/dashboard/summary')
      .set('Authorization', auth(adminToken))
      .expect(200);
    expect(dashboard.body.porCobrar).toBe(3000);

    // Ledger shows both rows.
    const movements = await request
      .get(`/api/v1/accounts/${customerId}/movements`)
      .set('Authorization', auth(adminToken))
      .expect(200);
    const types = (movements.body.movements as Array<{ type: string }>).map((m) => m.type);
    expect(types).toContain('charge');
    expect(types).toContain('credit');
    expect(movements.body.summary.outstandingBalance).toBe(3000);
  });

  it('lists the charge history for a customer', async () => {
    const customer = await createTestCustomer({ name: 'Historial' });
    const customerId = String(customer._id);

    await request
      .post(`/api/v1/customers/${customerId}/charges`)
      .set('Authorization', auth(adminToken))
      .send({ type: 'charge', amount: 100, reason: 'manual_debt' })
      .expect(201);
    await request
      .post(`/api/v1/customers/${customerId}/charges`)
      .set('Authorization', auth(adminToken))
      .send({ type: 'charge', amount: 250, reason: 'other' })
      .expect(201);

    const list = await request
      .get(`/api/v1/customers/${customerId}/charges`)
      .set('Authorization', auth(adminToken))
      .expect(200);
    expect(list.body).toHaveLength(2);
    expect((list.body as Array<{ amount: number }>).map((c) => c.amount).sort()).toEqual([100, 250]);
  });

  it('rejects unauthenticated and non-admin access (403 for driver)', async () => {
    const customer = await createTestCustomer({ name: 'Permisos' });
    const customerId = String(customer._id);

    await request
      .post(`/api/v1/customers/${customerId}/charges`)
      .send({ type: 'charge', amount: 100, reason: 'manual_debt' })
      .expect(401);

    await request
      .post(`/api/v1/customers/${customerId}/charges`)
      .set('Authorization', auth(driverToken))
      .send({ type: 'charge', amount: 100, reason: 'manual_debt' })
      .expect(403);

    await request
      .get(`/api/v1/customers/${customerId}/charges`)
      .set('Authorization', auth(driverToken))
      .expect(403);
  });

  it('is append-only — there are no update or delete routes', async () => {
    const customer = await createTestCustomer({ name: 'Append Only' });
    const customerId = String(customer._id);

    const created = await request
      .post(`/api/v1/customers/${customerId}/charges`)
      .set('Authorization', auth(adminToken))
      .send({ type: 'charge', amount: 100, reason: 'manual_debt' })
      .expect(201);
    const chargeId = (created.body as ChargeBody)._id;

    await request
      .put(`/api/v1/customers/${customerId}/charges/${chargeId}`)
      .set('Authorization', auth(adminToken))
      .send({ amount: 1 })
      .expect(404);
    await request
      .delete(`/api/v1/customers/${customerId}/charges/${chargeId}`)
      .set('Authorization', auth(adminToken))
      .expect(404);
  });

  it('validates the payload (amount must be positive)', async () => {
    const customer = await createTestCustomer({ name: 'Inválido' });
    const customerId = String(customer._id);

    await request
      .post(`/api/v1/customers/${customerId}/charges`)
      .set('Authorization', auth(adminToken))
      .send({ type: 'charge', amount: 0, reason: 'manual_debt' })
      .expect(400);

    await request
      .post(`/api/v1/customers/${customerId}/charges`)
      .set('Authorization', auth(adminToken))
      .send({ type: 'charge', amount: -100, reason: 'manual_debt' })
      .expect(400);
  });

  it('returns 404 for an unknown customer', async () => {
    const unknownId = new Types.ObjectId().toString();

    await request
      .post(`/api/v1/customers/${unknownId}/charges`)
      .set('Authorization', auth(adminToken))
      .send({ type: 'charge', amount: 100, reason: 'manual_debt' })
      .expect(404);

    await request
      .get(`/api/v1/customers/${unknownId}/charges`)
      .set('Authorization', auth(adminToken))
      .expect(404);
  });
});

// ─── Tenant isolation ───────────────────────────────────────────────────────

const ACME = {
  name: 'Acme Charges',
  slug: 'acme-charges',
  adminName: 'Acme Admin',
  adminEmail: 'admin@acme-charges.test',
  adminPassword: 'acme-secret-123'
} as const;

const GLOBEX = {
  name: 'Globex Charges',
  slug: 'globex-charges',
  adminName: 'Globex Admin',
  adminEmail: 'admin@globex-charges.test',
  adminPassword: 'globex-secret-123'
} as const;

const dropTenantDatabases = async (): Promise<void> => {
  const admin = mongoose.connection.db!.admin();
  const { databases } = await admin.listDatabases();
  for (const db of databases) {
    if (db.name?.startsWith('tenant_')) {
      await mongoose.connection.useDb(db.name).dropDatabase();
    }
  }
};

const login = async (email: string, password: string): Promise<string> => {
  const response = await request.post('/api/v1/auth/login').send({ email, password }).expect(200);
  return response.body.token as string;
};

describe('Customer charges — tenant isolation', () => {
  beforeEach(async () => {
    await dropTenantDatabases();
  });

  it('never leaks a charge across tenants', async () => {
    await provisionTenant({ ...ACME });
    await provisionTenant({ ...GLOBEX });
    const acmeToken = await login(ACME.adminEmail, ACME.adminPassword);
    const globexToken = await login(GLOBEX.adminEmail, GLOBEX.adminPassword);

    // Tenant A: create a customer and a charge on it.
    const customer = await request
      .post('/api/v1/customers')
      .set('Authorization', auth(acmeToken))
      .send({ name: 'Cliente Acme', type: 'B2C', phone: '555-1000', address: 'Acme St 1' })
      .expect(201);
    const acmeCustomerId = customer.body._id as string;

    await request
      .post(`/api/v1/customers/${acmeCustomerId}/charges`)
      .set('Authorization', auth(acmeToken))
      .send({ type: 'charge', amount: 5000, reason: 'manual_debt' })
      .expect(201);

    // A sees it.
    const acmeAccounts = await request
      .get('/api/v1/accounts')
      .set('Authorization', auth(acmeToken))
      .expect(200);
    const acmeRow = (acmeAccounts.body.items as Array<Record<string, unknown>>).find(
      (r) => r.customerId === acmeCustomerId
    );
    expect(acmeRow!.outstandingBalance).toBe(5000);

    // B cannot see the customer nor its charges — cross-tenant ObjectId → 404.
    await request
      .get(`/api/v1/customers/${acmeCustomerId}/charges`)
      .set('Authorization', auth(globexToken))
      .expect(404);
    await request
      .post(`/api/v1/customers/${acmeCustomerId}/charges`)
      .set('Authorization', auth(globexToken))
      .send({ type: 'charge', amount: 999, reason: 'manual_debt' })
      .expect(404);

    // B's account list is empty — no charge leaked into the tenant.
    const globexAccounts = await request
      .get('/api/v1/accounts')
      .set('Authorization', auth(globexToken))
      .expect(200);
    expect(globexAccounts.body.total).toBe(0);
  });
  });
});
