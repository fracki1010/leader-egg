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
import { Payment } from '../modules/payments/model.js';
import { CustomerCharge } from '../modules/customer-charges/model.js';
import { CashAdjustment } from '../modules/cash-adjustments/model.js';
import { Customer } from '../modules/customers/model.js';
import { provisionTenant } from '../tenancy/tenants.js';
import { getTenantConnection } from '../tenancy/registry.js';
import { runWithTenancy } from '../tenancy/context.js';

const request = supertest(app);

const auth = (token: string): string => `Bearer ${token}`;

let sequence = 0;

/** Minimal non-cancelled order with an outstanding balance. */
const orderPayload = (
  customerId: Types.ObjectId,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  orderNumber: `ORD-CP-${++sequence}-${Math.random().toString(36).slice(2, 7)}`,
  customerId,
  customerName: 'Cliente',
  channel: 'phone',
  items: [
    {
      productId: new Types.ObjectId(),
      productName: 'Blanco',
      quantity: 1,
      unitPrice: 100,
      subtotal: 100
    }
  ],
  totalAmount: 100,
  status: 'delivered',
  paymentStatus: 'unpaid',
  paidAmount: 0,
  balance: 100,
  dueDate: null,
  ...overrides
});

/**
 * Creates an order with an explicit `createdAt` (the FIFO ordering key).
 * Mongoose timestamps may override the value on create, so it is re-applied
 * directly on the collection to keep the sort deterministic.
 */
const makeOrder = async (
  customerId: Types.ObjectId,
  balance: number,
  createdAt: Date,
  overrides: Record<string, unknown> = {}
) => {
  const order = await Order.create(
    orderPayload(customerId, {
      balance,
      totalAmount: balance,
      paidAmount: 0,
      createdAt,
      ...overrides
    })
  );
  await Order.updateOne({ _id: order._id }, { $set: { createdAt } }, { timestamps: false });
  return order;
};

interface AllocationBody {
  orderId: string;
  orderNumber: string;
  date: string;
  applied: number;
  balanceBefore: number;
  balanceAfter: number;
}

interface CustomerPaymentBody {
  applied: number;
  unapplied: number;
  allocations: AllocationBody[];
  nonOrderApplied: number;
}

const pay = (
  customerId: string,
  token: string,
  body: Record<string, unknown>
) =>
  request
    .post(`/api/v1/customers/${customerId}/payments`)
    .set('Authorization', auth(token))
    .send(body);

/** Seeds a manual charge (cuenta corriente debt not tied to any order). */
const makeManualCharge = async (customerId: string, amount: number, type: 'charge' | 'credit' = 'charge') =>
  CustomerCharge.create({
    customerId: new Types.ObjectId(customerId),
    type,
    amount,
    reason: 'manual_debt',
    source: 'manual',
    createdBy: new Types.ObjectId()
  });

/** Reads the consolidated account summary through the real API. */
const getSummary = async (customerId: string, token: string) => {
  const response = await request
    .get(`/api/v1/accounts/${customerId}/movements`)
    .set('Authorization', auth(token))
    .expect(200);
  return response.body.summary as { outstandingBalance: number };
};

describe('Customer-level payments (FIFO allocation)', () => {
  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await dropTenantDatabases();
    await stopTestDatabase();
  });

  // ─── API behaviour ─────────────────────────────────────────────────────────

  describe('API', () => {
    let adminToken: string;
    let driverToken: string;

    beforeEach(async () => {
      await clearDatabase();
      const admin = await seedAdminUser();
      const driver = await seedDriverUser();
      adminToken = await loginAs(request, admin.email, admin.password);
      driverToken = await loginAs(request, driver.email, driver.password);
    });

    it('allocates oldest-first across three open orders', async () => {
      const customer = await createTestCustomer();
      const customerId = String(customer._id);
      const cid = new Types.ObjectId(customerId);

      const order1 = await makeOrder(cid, 8000, new Date('2026-01-01T10:00:00.000Z'));
      const order2 = await makeOrder(cid, 12000, new Date('2026-01-03T10:00:00.000Z'));
      const order3 = await makeOrder(cid, 5000, new Date('2026-01-05T10:00:00.000Z'));

      const response = await pay(customerId, adminToken, { amount: 12000, method: 'cash' }).expect(201);
      const body = response.body as CustomerPaymentBody;

      expect(body.applied).toBe(12000);
      expect(body.unapplied).toBe(0);
      expect(body.allocations).toHaveLength(2);

      expect(body.allocations[0]).toMatchObject({
        orderId: order1._id.toString(),
        orderNumber: order1.orderNumber,
        date: new Date('2026-01-01T10:00:00.000Z').toISOString(),
        applied: 8000,
        balanceBefore: 8000,
        balanceAfter: 0
      });
      expect(body.allocations[1]).toMatchObject({
        orderId: order2._id.toString(),
        orderNumber: order2.orderNumber,
        applied: 4000,
        balanceBefore: 12000,
        balanceAfter: 8000
      });

      const [fresh1, fresh2, fresh3] = await Promise.all([
        Order.findById(order1._id),
        Order.findById(order2._id),
        Order.findById(order3._id)
      ]);

      expect(fresh1).toMatchObject({ paymentStatus: 'paid', paidAmount: 8000, balance: 0 });
      expect(fresh2).toMatchObject({ paymentStatus: 'partial', paidAmount: 4000, balance: 8000 });
      expect(fresh3).toMatchObject({ paymentStatus: 'unpaid', paidAmount: 0, balance: 5000 });

      // One Payment row per order touched.
      const payments = await Payment.find({
        orderId: { $in: [order1._id, order2._id, order3._id] }
      }).sort({ amount: -1 });
      expect(payments).toHaveLength(2);
      expect(payments.map((p) => p.amount).sort((a, b) => b - a)).toEqual([8000, 4000]);
      expect(payments.every((p) => p.method === 'cash')).toBe(true);
      expect(payments.every((p) => p.account === 'cash')).toBe(true);
    });

    it('pays every order when the amount equals the total open debt', async () => {
      const customer = await createTestCustomer();
      const customerId = String(customer._id);
      const cid = new Types.ObjectId(customerId);

      const order1 = await makeOrder(cid, 8000, new Date('2026-01-01T10:00:00.000Z'));
      const order2 = await makeOrder(cid, 12000, new Date('2026-01-03T10:00:00.000Z'));
      const order3 = await makeOrder(cid, 5000, new Date('2026-01-05T10:00:00.000Z'));
      const total = 8000 + 12000 + 5000;

      const response = await pay(customerId, adminToken, { amount: total, method: 'transfer' }).expect(201);
      const body = response.body as CustomerPaymentBody;

      expect(body.applied).toBe(total);
      expect(body.unapplied).toBe(0);
      expect(body.allocations.map((a) => a.orderId)).toEqual([
        order1._id.toString(),
        order2._id.toString(),
        order3._id.toString()
      ]);
      expect(body.allocations.every((a) => a.balanceAfter === 0)).toBe(true);

      const orders = await Order.find({ customerId: cid });
      expect(orders.every((o) => o.paymentStatus === 'paid' && o.balance === 0)).toBe(true);
      expect(await Payment.countDocuments({})).toBe(3);
    });

    it('rejects an overpayment with 400 and writes nothing', async () => {
      const customer = await createTestCustomer();
      const customerId = String(customer._id);
      const cid = new Types.ObjectId(customerId);

      const order1 = await makeOrder(cid, 8000, new Date('2026-01-01T10:00:00.000Z'));
      const order2 = await makeOrder(cid, 12000, new Date('2026-01-03T10:00:00.000Z'));
      const total = 20000;

      const response = await pay(customerId, adminToken, { amount: total + 1, method: 'cash' }).expect(400);
      expect(String(response.body.error)).toMatch(/exceeds/i);
      expect(String(response.body.error)).toContain(String(total));

      const [fresh1, fresh2] = await Promise.all([
        Order.findById(order1._id),
        Order.findById(order2._id)
      ]);
      expect(fresh1).toMatchObject({ balance: 8000, paidAmount: 0, paymentStatus: 'unpaid' });
      expect(fresh2).toMatchObject({ balance: 12000, paidAmount: 0, paymentStatus: 'unpaid' });
      expect(await Payment.countDocuments({})).toBe(0);
    });

    it('ignores cancelled and fully-paid orders', async () => {
      const customer = await createTestCustomer();
      const customerId = String(customer._id);
      const cid = new Types.ObjectId(customerId);

      const cancelled = await makeOrder(cid, 5000, new Date('2026-01-01T10:00:00.000Z'), {
        status: 'cancelled'
      });
      const paid = await makeOrder(cid, 0, new Date('2026-01-02T10:00:00.000Z'), {
        totalAmount: 5000,
        paidAmount: 5000,
        paymentStatus: 'paid'
      });
      const open = await makeOrder(cid, 8000, new Date('2026-01-03T10:00:00.000Z'));

      const response = await pay(customerId, adminToken, { amount: 8000, method: 'cash' }).expect(201);
      const body = response.body as CustomerPaymentBody;

      expect(body.allocations).toHaveLength(1);
      expect(body.allocations[0]).toMatchObject({
        orderId: open._id.toString(),
        applied: 8000,
        balanceAfter: 0
      });

      const [freshCancelled, freshPaid] = await Promise.all([
        Order.findById(cancelled._id),
        Order.findById(paid._id)
      ]);
      expect(freshCancelled).toMatchObject({ balance: 5000, paidAmount: 0 });
      expect(freshPaid).toMatchObject({ balance: 0, paidAmount: 5000 });
    });

    it('sorts oldest-first even when orders are created out of chronological order', async () => {
      const customer = await createTestCustomer();
      const customerId = String(customer._id);
      const cid = new Types.ObjectId(customerId);

      // Created first, but NEWER date.
      const newer = await makeOrder(cid, 5000, new Date('2026-03-10T10:00:00.000Z'));
      // Created second, but OLDER date — must be paid first.
      const older = await makeOrder(cid, 5000, new Date('2026-02-01T10:00:00.000Z'));

      const response = await pay(customerId, adminToken, { amount: 5000, method: 'cash' }).expect(201);
      const body = response.body as CustomerPaymentBody;

      expect(body.allocations).toHaveLength(1);
      expect(body.allocations[0]!.orderId).toBe(older._id.toString());

      const [freshOlder, freshNewer] = await Promise.all([
        Order.findById(older._id),
        Order.findById(newer._id)
      ]);
      expect(freshOlder).toMatchObject({ balance: 0, paymentStatus: 'paid' });
      expect(freshNewer).toMatchObject({ balance: 5000, paymentStatus: 'unpaid' });
    });

    it('returns 409 when the customer has no debt at all', async () => {
      const customer = await createTestCustomer();
      const customerId = String(customer._id);

      const response = await pay(customerId, adminToken, { amount: 100, method: 'cash' }).expect(409);
      expect(String(response.body.error)).toMatch(/no pending debt/i);
      expect(await Payment.countDocuments({})).toBe(0);
      expect(await CashAdjustment.countDocuments({})).toBe(0);
    });

    // ─── Non-order debt (manual charges + opening debt) ─────────────────────

    it('settles a manual-charge-only debt with a credit and one cash adjustment', async () => {
      const customer = await createTestCustomer();
      const customerId = String(customer._id);
      await makeManualCharge(customerId, 5000);

      const response = await pay(customerId, adminToken, { amount: 5000, method: 'cash' }).expect(201);
      const body = response.body as CustomerPaymentBody;

      expect(body.applied).toBe(5000);
      expect(body.unapplied).toBe(0);
      expect(body.allocations).toHaveLength(0);
      expect(body.nonOrderApplied).toBe(5000);

      // One credit charge for the applied amount — no order payments.
      const credits = await CustomerCharge.find({ customerId: new Types.ObjectId(customerId), type: 'credit' });
      expect(credits).toHaveLength(1);
      expect(credits[0]!.amount).toBe(5000);
      expect(await Payment.countDocuments({})).toBe(0);

      // Exactly one cash adjustment for the non-order money (no double count).
      const adjustments = await CashAdjustment.find({});
      expect(adjustments).toHaveLength(1);
      expect(adjustments[0]!.amount).toBe(5000);
      expect(adjustments[0]!.account).toBe('cash');

      const summary = await getSummary(customerId, adminToken);
      expect(summary.outstandingBalance).toBe(0);
    });

    it('rejects a payment above the TOTAL debt and writes nothing', async () => {
      const customer = await createTestCustomer();
      const customerId = String(customer._id);
      await makeManualCharge(customerId, 5000);
      const customerBefore = await Customer.findById(customerId);

      const response = await pay(customerId, adminToken, { amount: 5001, method: 'cash' }).expect(400);
      expect(String(response.body.error)).toMatch(/exceeds/i);
      expect(String(response.body.error)).toContain('5000');

      // Nothing written: no payment, no credit, no adjustment.
      expect(await Payment.countDocuments({})).toBe(0);
      expect(await CustomerCharge.countDocuments({ type: 'credit' })).toBe(0);
      expect(await CashAdjustment.countDocuments({})).toBe(0);
      expect(await CustomerCharge.countDocuments({})).toBe(1);

      const customerAfter = await Customer.findById(customerId);
      expect(customerAfter!.openingDebt).toBe(customerBefore!.openingDebt);
    });

    it('partially settles a manual-only debt with a credit for exactly the paid amount', async () => {
      const customer = await createTestCustomer();
      const customerId = String(customer._id);
      await makeManualCharge(customerId, 5000);

      const response = await pay(customerId, adminToken, { amount: 2000, method: 'transfer' }).expect(201);
      const body = response.body as CustomerPaymentBody;

      expect(body.nonOrderApplied).toBe(2000);
      expect(body.allocations).toHaveLength(0);

      const credits = await CustomerCharge.find({ customerId: new Types.ObjectId(customerId), type: 'credit' });
      expect(credits).toHaveLength(1);
      expect(credits[0]!.amount).toBe(2000);

      const adjustments = await CashAdjustment.find({});
      expect(adjustments).toHaveLength(1);
      expect(adjustments[0]!.amount).toBe(2000);
      expect(adjustments[0]!.account).toBe('mp');

      const summary = await getSummary(customerId, adminToken);
      expect(summary.outstandingBalance).toBe(3000);
    });

    it('allocates to an open order first, then the manual debt remainder', async () => {
      const customer = await createTestCustomer();
      const customerId = String(customer._id);
      const cid = new Types.ObjectId(customerId);

      const order = await makeOrder(cid, 100, new Date('2026-01-01T10:00:00.000Z'));
      await makeManualCharge(customerId, 50);

      const response = await pay(customerId, adminToken, { amount: 150, method: 'cash' }).expect(201);
      const body = response.body as CustomerPaymentBody;

      expect(body.applied).toBe(150);
      expect(body.unapplied).toBe(0);
      expect(body.allocations).toHaveLength(1);
      expect(body.allocations[0]).toMatchObject({
        orderId: order._id.toString(),
        applied: 100,
        balanceAfter: 0
      });
      // The remainder goes to the manual debt, not another order payment.
      expect(body.nonOrderApplied).toBe(50);

      const freshOrder = await Order.findById(order._id);
      expect(freshOrder).toMatchObject({ balance: 0, paymentStatus: 'paid' });
      expect(await Payment.countDocuments({})).toBe(1);

      const credits = await CustomerCharge.find({ customerId: cid, type: 'credit' });
      expect(credits).toHaveLength(1);
      expect(credits[0]!.amount).toBe(50);

      // One Payment (order) + one CashAdjustment (non-order remainder).
      const adjustments = await CashAdjustment.find({});
      expect(adjustments).toHaveLength(1);
      expect(adjustments[0]!.amount).toBe(50);

      const summary = await getSummary(customerId, adminToken);
      expect(summary.outstandingBalance).toBe(0);
    });

    it('settles opening debt with no orders and records the cash adjustment', async () => {
      const customer = await createTestCustomer({ openingDebt: 500 });
      const customerId = String(customer._id);

      const response = await pay(customerId, adminToken, { amount: 500, method: 'cash' }).expect(201);
      const body = response.body as CustomerPaymentBody;

      expect(body.applied).toBe(500);
      expect(body.allocations).toHaveLength(0);
      expect(body.nonOrderApplied).toBe(500);

      const freshCustomer = await Customer.findById(customerId);
      expect(freshCustomer!.openingDebt).toBe(0);

      // Opening debt needs no CustomerCharge credit; cash is still recorded.
      expect(await CustomerCharge.countDocuments({})).toBe(0);
      const adjustments = await CashAdjustment.find({});
      expect(adjustments).toHaveLength(1);
      expect(adjustments[0]!.amount).toBe(500);

      const summary = await getSummary(customerId, adminToken);
      expect(summary.outstandingBalance).toBe(0);
    });

    it('rejects non-admin access (403) and unknown customers (404)', async () => {
      const customer = await createTestCustomer();
      const customerId = String(customer._id);
      await makeOrder(new Types.ObjectId(customerId), 1000, new Date('2026-01-01T10:00:00.000Z'));

      await request
        .post(`/api/v1/customers/${customerId}/payments`)
        .send({ amount: 100, method: 'cash' })
        .expect(401);

      await pay(customerId, driverToken, { amount: 100, method: 'cash' }).expect(403);

      await pay(new Types.ObjectId().toString(), adminToken, { amount: 100, method: 'cash' }).expect(404);

      // Nothing was written by the rejected attempts.
      expect(await Payment.countDocuments({})).toBe(0);
    });

    it('validates the payload (amount and method)', async () => {
      const customer = await createTestCustomer();
      const customerId = String(customer._id);
      await makeOrder(new Types.ObjectId(customerId), 1000, new Date('2026-01-01T10:00:00.000Z'));

      await pay(customerId, adminToken, { amount: 0, method: 'cash' }).expect(400);
      await pay(customerId, adminToken, { amount: -5, method: 'cash' }).expect(400);
      await pay(customerId, adminToken, { amount: 100 }).expect(400);
    });
  });

  // ─── Tenant isolation ──────────────────────────────────────────────────────

  const ACME = {
    name: 'Acme Payments',
    slug: 'acme-payments',
    adminName: 'Acme Admin',
    adminEmail: 'admin@acme-payments.test',
    adminPassword: 'acme-secret-123'
  } as const;

  const GLOBEX = {
    name: 'Globex Payments',
    slug: 'globex-payments',
    adminName: 'Globex Admin',
    adminEmail: 'admin@globex-payments.test',
    adminPassword: 'globex-secret-123'
  } as const;

  const login = async (email: string, password: string): Promise<string> => {
    const response = await request.post('/api/v1/auth/login').send({ email, password }).expect(200);
    return response.body.token as string;
  };

  describe('Tenant isolation', () => {
    beforeEach(async () => {
      await dropTenantDatabases();
    });

    it('never touches another tenant when allocating a payment', async () => {
      const acme = await provisionTenant({ ...ACME });
      const globex = await provisionTenant({ ...GLOBEX });
      const acmeToken = await login(ACME.adminEmail, ACME.adminPassword);
      const globexToken = await login(GLOBEX.adminEmail, GLOBEX.adminPassword);

      // Customer in each tenant via the real API.
      const acmeCustomer = await request
        .post('/api/v1/customers')
        .set('Authorization', auth(acmeToken))
        .send({ name: 'Cliente Acme', type: 'B2C', phone: '555-1000', address: 'Acme St 1' })
        .expect(201);
      const globexCustomer = await request
        .post('/api/v1/customers')
        .set('Authorization', auth(globexToken))
        .send({ name: 'Cliente Globex', type: 'B2C', phone: '555-2000', address: 'Globex St 1' })
        .expect(201);

      const acmeCustomerId = acmeCustomer.body._id as string;
      const globexCustomerId = globexCustomer.body._id as string;

      const acmeConn = getTenantConnection(acme.dbName);
      const globexConn = getTenantConnection(globex.dbName);

      const acmeOrder = await runWithTenancy(
        { connection: acmeConn, tenantId: String(acme._id) },
        () =>
          Order.create(
            orderPayload(new Types.ObjectId(acmeCustomerId), {
              customerName: 'Cliente Acme',
              balance: 8000,
              totalAmount: 8000
            })
          )
      );
      const globexOrder = await runWithTenancy(
        { connection: globexConn, tenantId: String(globex._id) },
        () =>
          Order.create(
            orderPayload(new Types.ObjectId(globexCustomerId), {
              customerName: 'Cliente Globex',
              balance: 5000,
              totalAmount: 5000
            })
          )
      );

      // Pay tenant A's customer in full.
      const payment = await pay(acmeCustomerId, acmeToken, { amount: 8000, method: 'cash' }).expect(201);
      expect((payment.body as CustomerPaymentBody).applied).toBe(8000);

      // A's order is settled...
      const acmeOrderAfter = await request
        .get(`/api/v1/orders/${acmeOrder._id.toString()}`)
        .set('Authorization', auth(acmeToken))
        .expect(200);
      expect(acmeOrderAfter.body).toMatchObject({ balance: 0, paidAmount: 8000, paymentStatus: 'paid' });

      // ...and tenant B's order and payments are untouched.
      const globexOrderAfter = await request
        .get(`/api/v1/orders/${globexOrder._id.toString()}`)
        .set('Authorization', auth(globexToken))
        .expect(200);
      expect(globexOrderAfter.body).toMatchObject({ balance: 5000, paidAmount: 0, paymentStatus: 'unpaid' });

      const globexPaymentCount = await runWithTenancy(
        { connection: globexConn, tenantId: String(globex._id) },
        () => Payment.countDocuments({})
      );
      expect(globexPaymentCount).toBe(0);

      // B cannot pay A's customer — existence is not leaked across tenants.
      await pay(acmeCustomerId, globexToken, { amount: 1, method: 'cash' }).expect(404);
    });
  });
});

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
