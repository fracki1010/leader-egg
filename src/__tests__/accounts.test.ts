import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { Types } from 'mongoose';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  seedDriverUser,
  seedProducts,
  loginAs,
  createCreditCustomer,
  createTestCustomer
} from './helpers.js';
import { app } from '../app.js';
import { Order } from '../modules/orders/model.js';
import { Payment } from '../modules/payments/model.js';
import { Return } from '../modules/returns/model.js';
import { CustomerCharge } from '../modules/customer-charges/model.js';

const request = supertest(app);

const daysAgo = (days: number): Date => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

/** Minimal order doc with caller-controlled financials (same shape as dashboard tests). */
const orderPayload = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  orderNumber: `ORD-ACC-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  customerId: new Types.ObjectId(),
  customerName: 'Cliente Genérico',
  channel: 'phone',
  items: [{ productId: new Types.ObjectId(), productName: 'Blanco', quantity: 5, unitPrice: 25, subtotal: 125 }],
  totalAmount: 125,
  status: 'delivered',
  paymentStatus: 'unpaid',
  paidAmount: 0,
  balance: 125,
  dueDate: null,
  ...overrides
});

describe('Accounts — GET /api/v1/accounts', () => {
  let adminToken: string;
  let driverToken: string;

  beforeAll(async () => { await startTestDatabase(); });
  afterAll(async () => { await stopTestDatabase(); });

  beforeEach(async () => {
    await clearDatabase();
    await seedProducts();
    const admin = await seedAdminUser();
    const driver = await seedDriverUser();
    adminToken = await loginAs(request, admin.email, admin.password);
    driverToken = await loginAs(request, driver.email, driver.password);
  });

  describe('Auth guard', () => {
    it('returns 401 without token', async () => {
      await request.get('/api/v1/accounts').expect(401);
    });

    it('returns 403 for driver (admin-only)', async () => {
      await request
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(403);
    });
  });

  describe('Consolidated rows', () => {
    it('sums outstanding balances, counts open orders and excludes cancelled', async () => {
      const customerA = await createCreditCustomer(100000, 30, { name: 'Cuenta A' });
      const customerB = await createCreditCustomer(100000, 30, { name: 'Cuenta B' });
      const customerC = await createCreditCustomer(100000, 30, { name: 'Cuenta C' });
      const idA = new Types.ObjectId(customerA._id as string);
      const idB = new Types.ObjectId(customerB._id as string);
      const idC = new Types.ObjectId(customerC._id as string);

      await Order.create([
        // A: two open orders → 125 + 200 = 325, 2 open orders, 4 totalSpent-hundreds
        orderPayload({ customerId: idA, customerName: 'Cuenta A', totalAmount: 125, balance: 125 }),
        orderPayload({ customerId: idA, customerName: 'Cuenta A', totalAmount: 250, paymentStatus: 'partial', paidAmount: 50, balance: 200 }),
        // B: one open order → 75
        orderPayload({ customerId: idB, customerName: 'Cuenta B', totalAmount: 75, balance: 75 }),
        // C: fully paid → balance 0 but still an account row
        orderPayload({ customerId: idC, customerName: 'Cuenta C', totalAmount: 999, paymentStatus: 'paid', paidAmount: 999, balance: 0 }),
        // Cancelled with balance → excluded from totals
        orderPayload({ customerId: idB, customerName: 'Cuenta B', totalAmount: 500, status: 'cancelled', balance: 500 })
      ]);

      const res = await request
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.total).toBe(3);
      const rows = res.body.items as Array<Record<string, unknown>>;
      const rowA = rows.find((r) => r.customerId === idA.toString());
      const rowB = rows.find((r) => r.customerId === idB.toString());
      const rowC = rows.find((r) => r.customerId === idC.toString());

      expect(rowA).toMatchObject({
        customerName: 'Cuenta A',
        type: 'B2C',
        outstandingBalance: 325,
        openOrdersCount: 2,
        totalSpent: 375, // 125 + 250
        creditLimit: 100000,
        creditUsedPct: 0, // 325/100000 rounds to 0%
        status: 'active'
      });

      expect(rowB).toMatchObject({
        customerName: 'Cuenta B',
        outstandingBalance: 75,
        openOrdersCount: 1,
        totalSpent: 75 // cancelled 500 excluded
      });

      expect(rowC).toMatchObject({
        customerName: 'Cuenta C',
        outstandingBalance: 0,
        openOrdersCount: 0,
        totalSpent: 999
      });

      // Default sort: outstandingBalance desc → A (325), B (75), C (0)
      const ids = (rows as Array<{ customerId: string }>).map((r) => r.customerId);
      expect(ids).toEqual([idA.toString(), idB.toString(), idC.toString()]);
    });

    it('computes overdueAmount and maxDaysOverdue from dueDate', async () => {
      const customer = await createCreditCustomer(50000, 30, { name: 'Moroso' });
      const customerId = new Types.ObjectId(customer._id as string);

      await Order.create([
        // 10 days overdue → 125
        orderPayload({ customerId, customerName: 'Moroso', totalAmount: 125, balance: 125, dueDate: daysAgo(10) }),
        // 5 days overdue but paid → excluded
        orderPayload({ customerId, customerName: 'Moroso', totalAmount: 200, paymentStatus: 'paid', paidAmount: 200, balance: 0, dueDate: daysAgo(5) }),
        // future due date → not overdue
        orderPayload({ customerId, customerName: 'Moroso', totalAmount: 300, balance: 300, dueDate: daysAgo(-5) }),
        // overdue + cancelled → excluded from the group entirely
        orderPayload({ customerId, customerName: 'Moroso', totalAmount: 400, status: 'cancelled', balance: 400, dueDate: daysAgo(3) })
      ]);

      const res = await request
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const row = (res.body.items as Array<Record<string, unknown>>)[0]!;
      expect(row.overdueAmount).toBe(125);
      expect(row.maxDaysOverdue).toBe(10);
      // Outstanding still includes the future-due order
      expect(row.outstandingBalance).toBe(425);
    });

    it('includes a charge-only customer (no orders) and folds the manual charge in', async () => {
      const customer = await createCreditCustomer(50000, 30, { name: 'Solo Manual' });
      const customerId = new Types.ObjectId(customer._id as string);

      await CustomerCharge.create({
        customerId,
        type: 'charge',
        amount: 5000,
        reason: 'manual_debt',
        source: 'manual',
        createdBy: new Types.ObjectId()
      });

      const res = await request
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const row = (res.body.items as Array<Record<string, unknown>>).find(
        (r) => r.customerId === customerId.toString()
      );
      expect(row).toBeDefined();
      expect(row!.outstandingBalance).toBe(5000);
      expect(row!.openOrdersCount).toBe(0);
    });

    it('reports hasPendingOrders when a pending/assigned order exists', async () => {
      const customer = await createCreditCustomer(50000, 30, { name: 'Con Pendientes' });
      const customerId = new Types.ObjectId(customer._id as string);

      await Order.create([
        orderPayload({ customerId, customerName: 'Con Pendientes', totalAmount: 100, balance: 100, status: 'pending' }),
        orderPayload({ customerId, customerName: 'Con Pendientes', totalAmount: 50, balance: 50, status: 'delivered' })
      ]);

      const res = await request
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const row = (res.body.items as Array<Record<string, unknown>>)[0]!;
      expect(row.hasPendingOrders).toBe(true);
      expect(row.lastOrderDate).not.toBeNull();
    });
  });

  describe('Filters and pagination', () => {
    const seedThreeCustomers = async (): Promise<{ debtorId: string; overdueId: string; inactiveId: string }> => {
      const debtor = await createCreditCustomer(50000, 30, { name: 'Deudor Activo' });
      const overdue = await createCreditCustomer(50000, 30, { name: 'Moroso Activo' });
      const inactive = await createCreditCustomer(50000, 30, { name: 'Inactivo Con Saldo', status: 'inactive' });

      const debtorId = new Types.ObjectId(debtor._id as string);
      const overdueId = new Types.ObjectId(overdue._id as string);
      const inactiveId = new Types.ObjectId(inactive._id as string);

      await Order.create([
        orderPayload({ customerId: debtorId, customerName: 'Deudor Activo', totalAmount: 100, balance: 100, dueDate: daysAgo(-10) }),
        orderPayload({ customerId: overdueId, customerName: 'Moroso Activo', totalAmount: 200, balance: 200, dueDate: daysAgo(7) }),
        orderPayload({ customerId: inactiveId, customerName: 'Inactivo Con Saldo', totalAmount: 300, balance: 300, dueDate: daysAgo(1) })
      ]);

      return {
        debtorId: debtorId.toString(),
        overdueId: overdueId.toString(),
        inactiveId: inactiveId.toString()
      };
    };

    it('onlyDebtors=true keeps only customers with balance > 0', async () => {
      const { debtorId } = await seedThreeCustomers();
      // Add a fully paid customer that must disappear with the filter
      const paid = await createCreditCustomer(50000, 30, { name: 'Al Día' });
      await Order.create(orderPayload({
        customerId: new Types.ObjectId(paid._id as string),
        customerName: 'Al Día',
        totalAmount: 50,
        paymentStatus: 'paid',
        paidAmount: 50,
        balance: 0
      }));

      const res = await request
        .get('/api/v1/accounts?onlyDebtors=true')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.total).toBe(3);
      const ids = (res.body.items as Array<{ customerId: string }>).map((r) => r.customerId);
      expect(ids).toContain(debtorId);
      expect(ids).not.toContain(paid._id as string);
    });

    it('overdueOnly=true keeps only customers with overdueAmount > 0', async () => {
      const { debtorId, overdueId } = await seedThreeCustomers();

      const res = await request
        .get('/api/v1/accounts?overdueOnly=true')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.total).toBe(2); // Moroso Activo (7d) + Inactivo Con Saldo (1d)
      const ids = (res.body.items as Array<{ customerId: string }>).map((r) => r.customerId);
      expect(ids).toContain(overdueId);
      expect(ids).not.toContain(debtorId);
    });

    it('search filters by customer name (case-insensitive)', async () => {
      await seedThreeCustomers();

      const res = await request
        .get('/api/v1/accounts?search=moroso')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect((res.body.items as Array<Record<string, unknown>>)[0]!.customerName).toBe('Moroso Activo');
    });

    it('status=inactive filters by customer status', async () => {
      const { inactiveId } = await seedThreeCustomers();

      const res = await request
        .get('/api/v1/accounts?status=inactive')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect((res.body.items as Array<Record<string, unknown>>)[0]!.customerId).toBe(inactiveId);
    });

    it('paginates with limit/page and reports the real total', async () => {
      await seedThreeCustomers();

      const res = await request
        .get('/api/v1/accounts?limit=2&page=1')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.total).toBe(3);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(2);
      expect((res.body.items as unknown[]).length).toBe(2);

      const res2 = await request
        .get('/api/v1/accounts?limit=2&page=2')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect((res2.body.items as unknown[]).length).toBe(1);
    });

    it('sort=name orders alphabetically', async () => {
      await seedThreeCustomers();

      const res = await request
        .get('/api/v1/accounts?sort=name')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const names = (res.body.items as Array<{ customerName: string }>).map((r) => r.customerName);
      expect(names).toEqual(['Deudor Activo', 'Inactivo Con Saldo', 'Moroso Activo']);
    });

    it('sort=overdue orders by overdueAmount desc', async () => {
      await seedThreeCustomers();

      const res = await request
        .get('/api/v1/accounts?sort=overdue')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const overdueAmounts = (res.body.items as Array<{ overdueAmount: number }>).map((r) => r.overdueAmount);
      // Inactivo 300 (1d overdue) > Moroso 200 (7d overdue) > Deudor 0 (future)
      expect(overdueAmounts).toEqual([300, 200, 0]);
    });
  });
});

describe('Accounts — GET /api/v1/accounts/:customerId/movements', () => {
  let adminToken: string;
  let driverToken: string;

  beforeAll(async () => { await startTestDatabase(); });
  afterAll(async () => { await stopTestDatabase(); });

  beforeEach(async () => {
    await clearDatabase();
    await seedProducts();
    const admin = await seedAdminUser();
    const driver = await seedDriverUser();
    adminToken = await loginAs(request, admin.email, admin.password);
    driverToken = await loginAs(request, driver.email, driver.password);
  });

  it('returns 403 for driver (admin-only)', async () => {
    const customer = await createTestCustomer();
    await request
      .get(`/api/v1/accounts/${customer._id}/movements`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(403);
  });

  it('returns 404 for an unknown customer', async () => {
    await request
      .get(`/api/v1/accounts/${new Types.ObjectId()}/movements`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('merges order and payment entries sorted newest first with a correct summary', async () => {
    const customer = await createCreditCustomer(100000, 30, { name: 'Libro Mayor' });
    const customerId = new Types.ObjectId(customer._id as string);

    const orderOld = await Order.create(orderPayload({
      customerId,
      customerName: 'Libro Mayor',
      orderNumber: 'ORD-ACC-0001',
      totalAmount: 400,
      balance: 400,
      dueDate: daysAgo(10),
      createdAt: daysAgo(20)
    }));
    const orderNew = await Order.create(orderPayload({
      customerId,
      customerName: 'Libro Mayor',
      orderNumber: 'ORD-ACC-0002',
      totalAmount: 250,
      paymentStatus: 'partial',
      paidAmount: 100,
      balance: 150,
      dueDate: daysAgo(-5),
      createdAt: daysAgo(3)
    }));

    await Payment.create([
      { orderId: orderOld._id, amount: 100, method: 'cash', date: daysAgo(15) },
      { orderId: orderNew._id, amount: 100, method: 'transfer', reference: 'TRF-001', date: daysAgo(1) }
    ]);

    const res = await request
      .get(`/api/v1/accounts/${customerId}/movements`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as {
      customer: { name: string; type: string; status: string };
      summary: Record<string, unknown>;
      movements: Array<Record<string, unknown>>;
      orders: { items: unknown[]; total: number };
      payments: unknown[];
    };

    // Customer block
    expect(body.customer.name).toBe('Libro Mayor');
    expect(body.customer.status).toBe('active');

    // Summary: outstanding = 400 + 150 = 550, open = 2, overdue only orderOld = 400
    expect(body.summary).toMatchObject({
      outstandingBalance: 550,
      openOrdersCount: 2,
      overdueAmount: 400,
      maxDaysOverdue: 10,
      totalSpent: 650 // 400 + 250
    });
    expect(body.summary.lastOrderDate).not.toBeNull();

    // Movements: 4 entries (2 orders + 2 payments), newest first by date
    const movements = body.movements;
    expect(movements).toHaveLength(4);
    const dates = movements.map((m) => new Date(m.date as string).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));

    // Newest first: transfer payment (1d) → orderNew (3d) → cash payment (15d) → orderOld (20d)
    expect(movements[0]).toMatchObject({ type: 'payment', amount: 100, method: 'transfer', sign: '-', reference: 'TRF-001' });
    expect(movements[1]).toMatchObject({ type: 'order', amount: 250, sign: '+', description: 'Pedido #ORD-ACC-0002' });
    expect(movements[2]).toMatchObject({ type: 'payment', amount: 100, method: 'cash', sign: '-' });
    expect(movements[3]).toMatchObject({ type: 'order', amount: 400, sign: '+', description: 'Pedido #ORD-ACC-0001' });

    // Open orders: both unpaid/partial, oldest balance first
    expect(body.orders.total).toBe(2);
    const openItems = body.orders.items as Array<{ balance: number; orderNumber: string }>;
    expect(openItems.map((o) => o.orderNumber)).toEqual(['ORD-ACC-0002', 'ORD-ACC-0001']);
    expect(openItems[0]!.balance).toBe(150);

    // Payments block: both, newest first
    expect(body.payments).toHaveLength(2);
  });

  it('includes return movements in the ledger with negative amount', async () => {
    const customer = await createCreditCustomer(50000, 30, { name: 'Con Devolución' });
    const customerId = new Types.ObjectId(customer._id as string);

    const order = await Order.create(orderPayload({
      customerId,
      customerName: 'Con Devolución',
      orderNumber: 'ORD-ACC-RET',
      totalAmount: 125,
      paymentStatus: 'paid',
      paidAmount: 75,
      balance: 0,
      returnedAmount: 50
    }));

    await Return.create({
      orderId: order._id,
      customerId,
      date: new Date(),
      items: [{
        productId: new Types.ObjectId(),
        productName: 'Blanco',
        quantity: 2,
        unit: 'maple',
        mapleQty: 2,
        unitPrice: 25,
        subtotal: 50
      }],
      returnedAmount: 50,
      refundAmount: 0,
      reason: 'difference',
      effect: 'reduce_debt',
      createdBy: 'admin'
    });

    const res = await request
      .get(`/api/v1/accounts/${customerId}/movements`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const movements = res.body.movements as Array<Record<string, unknown>>;
    const returnMovement = movements.find((m) => m.type === 'return');
    expect(returnMovement).toMatchObject({
      type: 'return',
      description: 'Devolución #ORD-ACC-RET',
      amount: 50,
      sign: '-'
    });
    expect(returnMovement!.date).toBeDefined();
  });

  it('includes manual charge/credit movements in the ledger and summary', async () => {
    const customer = await createCreditCustomer(50000, 30, { name: 'Con Débito Manual' });
    const customerIdStr = String(customer._id);
    const customerId = new Types.ObjectId(customerIdStr);

    await Order.create(orderPayload({
      customerId,
      customerName: 'Con Débito Manual',
      orderNumber: 'ORD-ACC-MAN',
      totalAmount: 3000,
      balance: 3000
    }));

    await CustomerCharge.create([
      { customerId, type: 'charge', amount: 2000, reason: 'manual_debt', source: 'manual', createdBy: new Types.ObjectId() },
      { customerId, type: 'credit', amount: 500, reason: 'forgiveness', source: 'manual', createdBy: new Types.ObjectId() }
    ]);

    const res = await request
      .get(`/api/v1/accounts/${customerIdStr}/movements`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Summary: 3000 order + 2000 charge − 500 credit = 4500
    expect(res.body.summary.outstandingBalance).toBe(4500);

    const movements = res.body.movements as Array<Record<string, unknown>>;
    const charge = movements.find((m) => m.type === 'charge');
    const credit = movements.find((m) => m.type === 'credit');
    expect(charge).toMatchObject({ description: 'Deuda manual', amount: 2000, sign: '+' });
    expect(credit).toMatchObject({ description: 'Crédito', amount: 500, sign: '-' });
  });

  it('returns zero summary and empty ledger for a customer without orders', async () => {
    const customer = await createCreditCustomer(50000, 30, { name: 'Sin Movimientos' });
    const customerId = new Types.ObjectId(customer._id as string);

    const res = await request
      .get(`/api/v1/accounts/${customerId}/movements`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.summary.outstandingBalance).toBe(0);
    expect(res.body.summary.openOrdersCount).toBe(0);
    expect(res.body.summary.overdueAmount).toBe(0);
    expect(res.body.movements).toEqual([]);
    expect(res.body.orders.total).toBe(0);
    expect(res.body.payments).toEqual([]);
  });

  it('excludes cancelled orders from the ledger but keeps them out of balances', async () => {
    const customer = await createCreditCustomer(50000, 30, { name: 'Con Cancelada' });
    const customerId = new Types.ObjectId(customer._id as string);

    await Order.create([
      orderPayload({ customerId, customerName: 'Con Cancelada', orderNumber: 'ORD-ACC-CCC', totalAmount: 100, balance: 100 }),
      orderPayload({ customerId, customerName: 'Con Cancelada', orderNumber: 'ORD-ACC-X', totalAmount: 999, balance: 999, status: 'cancelled' })
    ]);

    const res = await request
      .get(`/api/v1/accounts/${customerId}/movements`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const movements = res.body.movements as Array<{ description: string }>;
    expect(movements).toHaveLength(1);
    expect(movements[0]!.description).toBe('Pedido #ORD-ACC-CCC');
    expect(res.body.summary.outstandingBalance).toBe(100);
  });
});