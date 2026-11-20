import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import mongoose, { Types } from 'mongoose';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  seedDriverUser,
  loginAs
} from './helpers.js';
import { app } from '../app.js';
import { Order } from '../modules/orders/model.js';
import { Payment } from '../modules/payments/model.js';
import { Expense } from '../modules/expenses/model.js';
import { CashAdjustment } from '../modules/cash-adjustments/model.js';
import { Purchase } from '../modules/purchases/model.js';
import { Return } from '../modules/returns/model.js';
import { BusinessConfig } from '../modules/config/model.js';
import { provisionTenant } from '../tenancy/tenants.js';

const request = supertest(app);

interface MovementBody {
  id: string;
  date: string;
  type: string;
  account: string;
  amount: number;
  description: string;
  reference: string | null;
}

interface MovementsResponse {
  movements: MovementBody[];
  total: number;
  page: number;
  limit: number;
  totals: { in: number; out: number; net: number };
}

interface SummaryResponse {
  accounts: { cash: number; mp: number; bank: number; total: number };
  today: { in: number; out: number; net: number };
}

/** Drops every `tenant_*` database created by provisioning (test cleanup). */
const dropTenantDatabases = async (): Promise<void> => {
  const admin = mongoose.connection.db!.admin();
  const { databases } = await admin.listDatabases();
  for (const db of databases) {
    if (db.name?.startsWith('tenant_')) {
      await mongoose.connection.useDb(db.name).dropDatabase();
    }
  }
};

const daysAgo = (days: number): Date => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

const orderPayload = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  orderNumber: `ORD-CASH-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  customerId: new Types.ObjectId(),
  customerName: 'Cliente Caja',
  channel: 'phone',
  items: [
    {
      productId: new Types.ObjectId(),
      productName: 'Blanco',
      quantity: 5,
      unitPrice: 25,
      subtotal: 125
    }
  ],
  totalAmount: 125,
  status: 'delivered',
  paymentStatus: 'unpaid',
  paidAmount: 0,
  balance: 125,
  dueDate: null,
  ...overrides
});

const purchasePayload = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  purchaseNumber: `PUR-CASH-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  supplierId: new Types.ObjectId(),
  date: new Date(),
  items: [
    {
      productId: new Types.ObjectId(),
      productName: 'Blanco',
      unit: 'maple',
      quantity: 1,
      quantityMaples: 1,
      unitCost: 100,
      unitCostPerMaple: 100,
      subtotal: 100
    }
  ],
  totalCost: 100,
  status: 'pending',
  createdBy: 'admin',
  ...overrides
});

describe('Unified cash movements — /api/v1/cash', () => {
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
    await dropTenantDatabases();
    const admin = await seedAdminUser();
    const driver = await seedDriverUser();
    adminToken = await loginAs(request, admin.email, admin.password);
    driverToken = await loginAs(request, driver.email, driver.password);
  });

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });

  describe('Auth guard', () => {
    it('returns 401 without a token', async () => {
      await request.get('/api/v1/cash/movements').expect(401);
      await request.get('/api/v1/cash/summary').expect(401);
    });

    it('returns 403 for a non-admin (driver) role', async () => {
      await request
        .get('/api/v1/cash/movements')
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(403);
      await request
        .get('/api/v1/cash/summary')
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(403);
    });
  });

  describe('GET /movements', () => {
    it('lists one movement of every type with the correct sign, account and type (date DESC)', async () => {
      const order = await Order.create(
        orderPayload({
          orderNumber: 'ORD-20261016-001',
          paymentStatus: 'paid',
          paidAmount: 100,
          balance: 0
        })
      );

      // payment (+100 cash) — 3 days ago
      await Payment.create({
        orderId: order._id,
        amount: 100,
        method: 'cash',
        account: 'cash',
        date: daysAgo(3)
      });
      // expense (−40 mp) — 2 days ago
      await Expense.create({
        amount: 40,
        category: 'fuel',
        account: 'mp',
        date: daysAgo(2),
        description: 'Nafta',
        createdBy: 'admin'
      });
      // adjustment (+200 cash) — 1 day ago
      await CashAdjustment.create({
        account: 'cash',
        amount: 200,
        reason: 'correction',
        date: daysAgo(1),
        createdBy: new Types.ObjectId()
      });
      // purchase split payment (cash −60 / mp −40) — 4 days ago
      const groupId = 'split-1';
      await Purchase.create(
        purchasePayload({
          purchaseNumber: 'PUR-20261016-001',
          date: daysAgo(4),
          paidAmount: 100,
          paymentStatus: 'paid',
          paymentMethod: 'transfer',
          account: 'mp',
          payments: [
            { method: 'cash', account: 'cash', amount: 60, date: daysAgo(4), groupId },
            { method: 'transfer', account: 'mp', amount: 40, date: daysAgo(4), groupId }
          ]
        })
      );
      // refund (−25 cash) — today
      await Return.create({
        orderId: order._id,
        customerId: new Types.ObjectId(),
        date: new Date(),
        items: [
          {
            productId: new Types.ObjectId(),
            productName: 'Blanco',
            quantity: 1,
            unit: 'maple',
            mapleQty: 1,
            unitPrice: 25,
            subtotal: 25
          }
        ],
        returnedAmount: 25,
        refundAmount: 25,
        refundAccount: 'cash',
        reason: 'difference',
        effect: 'refund_cash',
        createdBy: 'admin'
      });

      const res = await request.get('/api/v1/cash/movements').set(auth()).expect(200);
      const body = res.body as MovementsResponse;

      // 1 payment + 1 expense + 1 adjustment + 2 purchase lines + 1 refund = 6
      expect(body.total).toBe(6);
      expect(body.movements).toHaveLength(6);

      const byType = (type: string) => body.movements.filter((m) => m.type === type);
      expect(byType('payment')).toHaveLength(1);
      expect(byType('expense')).toHaveLength(1);
      expect(byType('adjustment')).toHaveLength(1);
      expect(byType('purchase_payment')).toHaveLength(2);
      expect(byType('refund')).toHaveLength(1);

      // Signs and accounts.
      const payment = byType('payment')[0]!;
      expect(payment.amount).toBe(100);
      expect(payment.account).toBe('cash');
      expect(payment.description).toBe('Cobro ORD-20261016-001');
      expect(payment.reference).toBe('ORD-20261016-001');

      const expense = byType('expense')[0]!;
      expect(expense.amount).toBe(-40);
      expect(expense.account).toBe('mp');
      expect(expense.description).toBe('Gasto: Nafta');

      const adjustment = byType('adjustment')[0]!;
      expect(adjustment.amount).toBe(200);
      expect(adjustment.account).toBe('cash');
      expect(adjustment.description).toBe('Ajuste de caja: Corrección');

      const purchaseLines = byType('purchase_payment');
      expect(purchaseLines.map((m) => m.account).sort()).toEqual(['cash', 'mp']);
      expect(purchaseLines.find((m) => m.account === 'cash')!.amount).toBe(-60);
      expect(purchaseLines.find((m) => m.account === 'mp')!.amount).toBe(-40);
      expect(purchaseLines[0]!.description).toBe('Pago compra PUR-20261016-001');

      const refund = byType('refund')[0]!;
      expect(refund.amount).toBe(-25);
      expect(refund.account).toBe('cash');
      expect(refund.description).toContain('Devolución');

      // Sorted by date DESC.
      const times = body.movements.map((m) => new Date(m.date).getTime());
      const sorted = [...times].sort((a, b) => b - a);
      expect(times).toEqual(sorted);
      // Newest (today's refund) first.
      expect(body.movements[0]!.type).toBe('refund');
    });

    it('keeps a negative adjustment signed as-is', async () => {
      await CashAdjustment.create({
        account: 'mp',
        amount: -30,
        reason: 'missing',
        date: new Date(),
        createdBy: new Types.ObjectId()
      });

      const res = await request
        .get('/api/v1/cash/movements?type=adjustment')
        .set(auth())
        .expect(200);

      const body = res.body as MovementsResponse;
      expect(body.movements).toHaveLength(1);
      expect(body.movements[0]!.amount).toBe(-30);
      expect(body.movements[0]!.account).toBe('mp');
    });

    it('filters by account and type', async () => {
      await CashAdjustment.create([
        { account: 'cash', amount: 100, reason: 'found', date: daysAgo(1), createdBy: new Types.ObjectId() },
        { account: 'mp', amount: -50, reason: 'missing', date: daysAgo(1), createdBy: new Types.ObjectId() }
      ]);
      await Expense.create({
        amount: 20,
        category: 'fuel',
        account: 'cash',
        date: daysAgo(1),
        description: 'Combustible',
        createdBy: 'admin'
      });

      const byAccount = await request
        .get('/api/v1/cash/movements?account=cash')
        .set(auth())
        .expect(200);
      expect((byAccount.body as MovementsResponse).total).toBe(2);
      expect(
        (byAccount.body as MovementsResponse).movements.every((m) => m.account === 'cash')
      ).toBe(true);

      const byType = await request
        .get('/api/v1/cash/movements?type=expense')
        .set(auth())
        .expect(200);
      expect((byType.body as MovementsResponse).total).toBe(1);
      expect((byType.body as MovementsResponse).movements[0]!.type).toBe('expense');
    });

    it('filters by from/to date range', async () => {
      await CashAdjustment.create([
        { account: 'cash', amount: 10, reason: 'found', date: daysAgo(10), createdBy: new Types.ObjectId() },
        { account: 'cash', amount: 20, reason: 'found', date: daysAgo(5), createdBy: new Types.ObjectId() },
        { account: 'cash', amount: 30, reason: 'found', date: new Date(), createdBy: new Types.ObjectId() }
      ]);

      const res = await request
        .get(`/api/v1/cash/movements?from=${daysAgo(7).toISOString()}&to=${new Date().toISOString()}`)
        .set(auth())
        .expect(200);

      expect((res.body as MovementsResponse).total).toBe(2);
    });

    it('returns 400 when from > to', async () => {
      await request
        .get(`/api/v1/cash/movements?from=${new Date().toISOString()}&to=${daysAgo(7).toISOString()}`)
        .set(auth())
        .expect(400);
    });

    it('paginates and reports the correct total and totals', async () => {
      await CashAdjustment.create([
        { account: 'cash', amount: 100, reason: 'found', date: daysAgo(3), createdBy: new Types.ObjectId() },
        { account: 'cash', amount: -40, reason: 'missing', date: daysAgo(2), createdBy: new Types.ObjectId() },
        { account: 'cash', amount: 10, reason: 'found', date: daysAgo(1), createdBy: new Types.ObjectId() }
      ]);

      const page1 = await request
        .get('/api/v1/cash/movements?page=1&limit=2')
        .set(auth())
        .expect(200);
      const body1 = page1.body as MovementsResponse;
      expect(body1.total).toBe(3);
      expect(body1.movements).toHaveLength(2);
      expect(body1.page).toBe(1);
      expect(body1.limit).toBe(2);
      // Totals cover the FULL filtered set, not just the page.
      expect(body1.totals).toEqual({ in: 110, out: 40, net: 70 });

      const page2 = await request
        .get('/api/v1/cash/movements?page=2&limit=2')
        .set(auth())
        .expect(200);
      const body2 = page2.body as MovementsResponse;
      expect(body2.movements).toHaveLength(1);
      expect(body2.total).toBe(3);
    });

    it('caps limit at 200 and defaults to 50', async () => {
      const res = await request.get('/api/v1/cash/movements?limit=500').set(auth()).expect(400);
      expect(res.status).toBe(400);

      const def = await request.get('/api/v1/cash/movements').set(auth()).expect(200);
      expect((def.body as MovementsResponse).limit).toBe(50);
    });
  });

  describe('GET /summary', () => {
    it('accounts equals the dashboard saldos and today reflects a movement made today', async () => {
      await BusinessConfig.create({
        openingCash: 1000,
        openingBalances: { cash: 1000, mp: 500, bank: 2000 }
      });

      const order = await Order.create(
        orderPayload({ paymentStatus: 'paid', paidAmount: 100, balance: 0 })
      );
      await Payment.create({
        orderId: order._id,
        amount: 100,
        method: 'cash',
        account: 'cash',
        date: new Date()
      });
      await Expense.create({
        amount: 40,
        category: 'fuel',
        account: 'cash',
        date: new Date(),
        description: 'Nafta',
        createdBy: 'admin'
      });
      await CashAdjustment.create({
        account: 'bank',
        amount: 300,
        reason: 'correction',
        date: daysAgo(2),
        createdBy: new Types.ObjectId()
      });

      const [cashRes, dashRes] = await Promise.all([
        request.get('/api/v1/cash/summary').set(auth()).expect(200),
        request.get('/api/v1/dashboard/summary').set(auth()).expect(200)
      ]);

      const summary = cashRes.body as SummaryResponse;
      const saldos = dashRes.body.saldos as {
        efectivo: number;
        mercadopago: number;
        banco: number;
        total: number;
      };

      expect(summary.accounts).toEqual({
        cash: saldos.efectivo,
        mp: saldos.mercadopago,
        bank: saldos.banco,
        total: saldos.total
      });

      // cash: 1000 + 100 payment − 40 expense = 1060; bank: 2000 + 300 = 2300.
      expect(summary.accounts.cash).toBe(1060);
      expect(summary.accounts.bank).toBe(2300);

      // Today: +100 payment, −40 expense → in 100, out 40, net 60.
      expect(summary.today).toEqual({ in: 100, out: 40, net: 60 });
    });

    it('reports an all-zero summary when there is no data', async () => {
      const res = await request.get('/api/v1/cash/summary').set(auth()).expect(200);
      const summary = res.body as SummaryResponse;
      expect(summary.accounts).toEqual({ cash: 0, mp: 0, bank: 0, total: 0 });
      expect(summary.today).toEqual({ in: 0, out: 0, net: 0 });
    });
  });

  describe('Purchase split payment', () => {
    it('produces two movements attributed to cash and mp', async () => {
      const groupId = 'split-two';
      await Purchase.create(
        purchasePayload({
          purchaseNumber: 'PUR-SPLIT-TWO',
          paidAmount: 100,
          paymentStatus: 'paid',
          paymentMethod: 'transfer',
          account: 'mp',
          payments: [
            { method: 'cash', account: 'cash', amount: 60, date: new Date(), groupId },
            { method: 'transfer', account: 'mp', amount: 40, date: new Date(), groupId }
          ]
        })
      );

      const res = await request
        .get('/api/v1/cash/movements?type=purchase_payment')
        .set(auth())
        .expect(200);

      const body = res.body as MovementsResponse;
      expect(body.total).toBe(2);

      const cash = body.movements.find((m) => m.account === 'cash')!;
      const mp = body.movements.find((m) => m.account === 'mp')!;
      expect(cash.amount).toBe(-60);
      expect(mp.amount).toBe(-40);
      expect(body.totals).toEqual({ in: 0, out: 100, net: -100 });
    });
  });

  describe('Tenant isolation', () => {
    it('does not leak movements to another tenant', async () => {
      await CashAdjustment.create({
        account: 'cash',
        amount: 777,
        reason: 'found',
        date: new Date(),
        createdBy: new Types.ObjectId()
      });

      const other = await provisionTenant({
        name: 'Other Co',
        slug: 'other-co',
        adminName: 'Other Admin',
        adminEmail: 'admin@other.test',
        adminPassword: 'other-secret-123'
      });

      const login = await request
        .post('/api/v1/auth/login')
        .send({ email: 'admin@other.test', password: 'other-secret-123' })
        .expect(200);

      const res = await request
        .get('/api/v1/cash/movements')
        .set('Authorization', `Bearer ${login.body.token}`)
        .expect(200);

      const body = res.body as MovementsResponse;
      expect(body.total).toBe(0);
      expect(body.movements).toEqual([]);
      expect(body.totals).toEqual({ in: 0, out: 0, net: 0 });
      expect(String(other._id)).toBeDefined();
    });
  });
});
