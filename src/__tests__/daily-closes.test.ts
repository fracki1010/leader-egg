import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { Types } from 'mongoose';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  seedDriverUser,
  seedPuestoUser,
  loginAs
} from './helpers.js';
import { app } from '../app.js';
import { Order } from '../modules/orders/model.js';
import { Payment } from '../modules/payments/model.js';
import { Expense } from '../modules/expenses/model.js';
import { Return } from '../modules/returns/model.js';
import { DailyClose } from '../modules/daily-closes/model.js';
import { Purchase } from '../modules/purchases/model.js';

const request = supertest(app);
const API = '/api/v1/daily-closes';

interface DaySummaryBody {
  date: string;
  ventasHoy: number;
  efectivo: number;
  transferencia: number;
  fiado: number;
  gastos: number;
  maplesVendidos: number;
  resultado: number;
  pagosProveedor: number;
  systemCash: number;
}

interface DailyCloseBody {
  _id: string;
  date: string;
  channel: 'reparto' | 'puesto';
  systemCash: number;
  countedCash: number;
  difference: number;
  notes?: string;
  summary: Omit<DaySummaryBody, 'date' | 'systemCash'>;
  closedBy: string;
}

const daysAgo = (days: number): Date => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

const dateKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const localMidnight = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);

const orderPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  orderNumber: `ORD-DC-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  customerId: new Types.ObjectId(),
  customerName: 'Cliente Cierre',
  channel: 'phone',
  items: [
    {
      productId: new Types.ObjectId(),
      productName: 'Blanco',
      quantity: 5,
      unit: 'maple',
      mapleQty: 5,
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

const returnPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  orderId: new Types.ObjectId(),
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
  reason: 'difference',
  effect: 'refund_cash',
  createdBy: 'admin',
  ...overrides
});

describe('Daily Closes — /api/v1/daily-closes', () => {
  let adminToken: string;
  let driverToken: string;
  let puestoToken: string;

  beforeAll(async () => { await startTestDatabase(); });
  afterAll(async () => { await stopTestDatabase(); });

  beforeEach(async () => {
    await clearDatabase();
    const admin = await seedAdminUser();
    const driver = await seedDriverUser();
    const puesto = await seedPuestoUser();
    adminToken = await loginAs(request, admin.email, admin.password);
    driverToken = await loginAs(request, driver.email, driver.password);
    puestoToken = await loginAs(request, puesto.email, puesto.password);
  });

  describe('Auth guard', () => {
    it('returns 401 without a token', async () => {
      const res = await request.get(`${API}/preview`);
      expect(res.status).toBe(401);
    });

    it('returns 403 for a driver token', async () => {
      const res = await request
        .get(`${API}/preview`)
        .set('Authorization', `Bearer ${driverToken}`);
      expect(res.status).toBe(403);
    });

    it('allows a puesto token on preview', async () => {
      const res = await request
        .get(`${API}/preview`)
        .set('Authorization', `Bearer ${puestoToken}`);
      expect(res.status).toBe(200);
    });
  });

  describe('GET /preview', () => {
    it('computes the day aggregates without persisting (S1 + S4)', async () => {
      const cashOrder = await Order.create(orderPayload({
        totalAmount: 200,
        balance: 70,
        items: [{
          productId: new Types.ObjectId(),
          productName: 'Blanco',
          quantity: 25,
          unit: 'maple',
          mapleQty: 25,
          unitPrice: 8,
          subtotal: 200
        }]
      }));
      await Order.create(orderPayload({
        totalAmount: 100,
        balance: 50,
        items: [{
          productId: new Types.ObjectId(),
          productName: 'Castaño',
          quantity: 15,
          unit: 'maple',
          mapleQty: 15,
          unitPrice: 6.67,
          subtotal: 100
        }]
      }));
      // Cancelled + yesterday orders must be excluded (sales use the BUSINESS
      // date, so the fixture moves `orderDate`, not just `createdAt`).
      await Order.create(orderPayload({ totalAmount: 999, balance: 999, status: 'cancelled' }));
      await Order.create(orderPayload({
        totalAmount: 888,
        balance: 888,
        orderDate: daysAgo(1),
        createdAt: daysAgo(1)
      }));

      await Payment.create([
        { orderId: cashOrder._id, amount: 100, method: 'cash', date: new Date() },
        { orderId: cashOrder._id, amount: 50, method: 'transfer', date: new Date() }
      ]);
      await Expense.create({
        amount: 20,
        category: 'fuel',
        date: new Date(),
        description: 'Combustible',
        createdBy: 'admin'
      });
      // Refund must reference a scoped (reparto) order of the day — design D5.
      await Return.create(returnPayload({ orderId: cashOrder._id, refundAmount: 10, effect: 'refund_cash' }));

      const res = await request
        .get(`${API}/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const body = res.body as DaySummaryBody;
      expect(body.efectivo).toBe(100);
      expect(body.transferencia).toBe(50);
      expect(body.gastos).toBe(20);
      expect(body.ventasHoy).toBe(300);
      expect(body.fiado).toBe(120);
      expect(body.maplesVendidos).toBe(40);
      expect(body.resultado).toBe(280);
      expect(body.systemCash).toBe(70); // 100 − 20 − 10
      expect(body.date).toBe(dateKey(new Date()));

      // Preview must not persist.
      expect(await DailyClose.countDocuments()).toBe(0);
      await request
        .get(`${API}/${body.date}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('systemCash subtracts only cash refunds (S2)', async () => {
      const order = await Order.create(orderPayload({ totalAmount: 0, balance: 0 }));
      await Payment.create({ orderId: order._id, amount: 100, method: 'cash', date: new Date() });
      await Expense.create({
        amount: 20,
        category: 'fuel',
        date: new Date(),
        description: 'Combustible',
        createdBy: 'admin'
      });
      await Return.create(returnPayload({ orderId: order._id, refundAmount: 10, effect: 'refund_cash' }));
      await Return.create(returnPayload({ orderId: order._id, refundAmount: 30, effect: 'refund_transfer' }));

      const res = await request
        .get(`${API}/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect((res.body as DaySummaryBody).systemCash).toBe(70);
    });

    it('nets a same-day cash refund to zero: payment in, refund adjustment out', async () => {
      const paidAmount = 100;
      const order = await Order.create(orderPayload({
        status: 'pending',
        totalAmount: 150,
        paidAmount,
        balance: 50
      }));
      await Payment.create({ orderId: order._id, amount: paidAmount, method: 'cash', date: new Date() });

      // Real cancellation path: records a negative `CashAdjustment` refund.
      await request
        .patch(`/api/v1/orders/${order._id.toString()}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled', moneyAction: 'refund_cash' })
        .expect(200);

      const res = await request
        .get(`${API}/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const body = res.body as DaySummaryBody;
      // The money moved that day: payment in the drawer, refund out.
      expect(body.efectivo).toBe(paidAmount);
      expect(body.systemCash).toBe(0); // NOT −paidAmount
      // The sale itself never counts.
      expect(body.ventasHoy).toBe(0);
      expect(body.fiado).toBe(0);
      expect(body.maplesVendidos).toBe(0);
    });

    it('keeps the cash when a paid order is cancelled without a refund', async () => {
      const paidAmount = 100;
      const order = await Order.create(orderPayload({
        status: 'pending',
        totalAmount: 150,
        paidAmount,
        balance: 50
      }));
      await Payment.create({ orderId: order._id, amount: paidAmount, method: 'cash', date: new Date() });

      await request
        .patch(`/api/v1/orders/${order._id.toString()}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled', moneyAction: 'none' })
        .expect(200);

      const res = await request
        .get(`${API}/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const body = res.body as DaySummaryBody;
      // No refund adjustment: the cash stayed in the drawer.
      expect(body.efectivo).toBe(paidAmount);
      expect(body.systemCash).toBe(paidAmount);
      expect(body.ventasHoy).toBe(0);
    });

    it('never counts a cancelled order in the sales metrics', async () => {
      await Order.create(orderPayload({
        status: 'cancelled',
        totalAmount: 999,
        balance: 999,
        paidAmount: 200
      }));

      const res = await request
        .get(`${API}/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const body = res.body as DaySummaryBody;
      expect(body.ventasHoy).toBe(0);
      expect(body.fiado).toBe(0);
      expect(body.maplesVendidos).toBe(0);
    });

    it('returns all zeros for a day with no movements (S7)', async () => {
      const res = await request
        .get(`${API}/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const body = res.body as DaySummaryBody;
      expect(body).toMatchObject({
        ventasHoy: 0,
        efectivo: 0,
        transferencia: 0,
        fiado: 0,
        gastos: 0,
        maplesVendidos: 0,
        resultado: 0,
        pagosProveedor: 0,
        systemCash: 0
      });
    });

    it('attributes a cash-method payment to its explicit account, not the drawer (mp)', async () => {
      const order = await Order.create(orderPayload());
      await Payment.create({
        orderId: order._id,
        amount: 100,
        method: 'cash',
        account: 'mp',
        date: new Date()
      });

      const res = await request
        .get(`${API}/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const body = res.body as DaySummaryBody;
      expect(body.efectivo).toBe(0);
      expect(body.transferencia).toBe(100);
      expect(body.systemCash).toBe(0);
    });

    it('counts only cash-account expenses against the drawer', async () => {
      const order = await Order.create(orderPayload());
      await Payment.create({ orderId: order._id, amount: 100, method: 'cash', date: new Date() });
      await Expense.create({
        amount: 40,
        category: 'fuel',
        account: 'mp',
        date: new Date(),
        description: 'Combustible MP',
        createdBy: 'admin'
      });

      const mpOnly = await request
        .get(`${API}/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect((mpOnly.body as DaySummaryBody).gastos).toBe(0);
      expect((mpOnly.body as DaySummaryBody).systemCash).toBe(100);

      await Expense.create({
        amount: 25,
        category: 'fuel',
        account: 'cash',
        date: new Date(),
        description: 'Combustible efectivo',
        createdBy: 'admin'
      });

      const withCash = await request
        .get(`${API}/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect((withCash.body as DaySummaryBody).gastos).toBe(25);
      expect((withCash.body as DaySummaryBody).systemCash).toBe(75);
    });

    it('attributes refunds to their resolved account, not their effect', async () => {
      const order = await Order.create(orderPayload());
      await Payment.create({ orderId: order._id, amount: 100, method: 'cash', date: new Date() });

      // A transfer-marked refund actually paid from cash hits the drawer…
      await Return.create(returnPayload({
        orderId: order._id,
        refundAmount: 10,
        effect: 'refund_transfer',
        refundAccount: 'cash'
      }));
      // …while a cash-marked refund paid from the bank does not.
      await Return.create(returnPayload({
        orderId: order._id,
        refundAmount: 30,
        effect: 'refund_cash',
        refundAccount: 'bank'
      }));

      const res = await request
        .get(`${API}/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const body = res.body as DaySummaryBody;
      expect(body.efectivo).toBe(100);
      expect(body.systemCash).toBe(90); // 100 − 10 cash refund
    });

    it('subtracts cash supplier payments from systemCash (pagosProveedor)', async () => {
      const order = await Order.create(orderPayload());
      await Payment.create({ orderId: order._id, amount: 100, method: 'cash', date: new Date() });

      await Purchase.create({
        purchaseNumber: `PUR-DC-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        supplierId: new Types.ObjectId(),
        date: new Date(),
        items: [{
          productId: new Types.ObjectId(),
          productName: 'Blanco',
          unit: 'maple',
          quantity: 1,
          quantityMaples: 1,
          unitCost: 50,
          unitCostPerMaple: 50,
          subtotal: 50
        }],
        totalCost: 50,
        status: 'pending',
        paymentStatus: 'paid',
        paymentMethod: 'cash',
        account: 'cash',
        paidAmount: 50,
        payments: [{
          method: 'cash',
          account: 'cash',
          amount: 50,
          date: new Date(),
          groupId: 'dc-test-group'
        }],
        createdBy: 'admin'
      });

      const res = await request
        .get(`${API}/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const body = res.body as DaySummaryBody;
      expect(body.pagosProveedor).toBe(50);
      expect(body.systemCash).toBe(50); // 100 cash in − 50 paid to the supplier
    });
  });

  describe('POST /', () => {
    it('saves the snapshot and difference and defaults the date to today (S3 + S10)', async () => {
      const order = await Order.create(orderPayload({ totalAmount: 300, balance: 120 }));
      await Payment.create({ orderId: order._id, amount: 100, method: 'cash', date: new Date() });
      await Expense.create({
        amount: 20,
        category: 'fuel',
        date: new Date(),
        description: 'Combustible',
        createdBy: 'admin'
      });
      await Return.create(returnPayload({ orderId: order._id, refundAmount: 10, effect: 'refund_cash' }));

      const res = await request
        .post(API)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ countedCash: 80 })
        .expect(201);

      const body = res.body as DailyCloseBody;
      expect(dateKey(new Date(body.date))).toBe(dateKey(new Date()));
      expect(body.systemCash).toBe(70);
      expect(body.countedCash).toBe(80);
      expect(body.difference).toBe(10);
      expect(body.closedBy).toBeTruthy();
      expect(body.summary).toMatchObject({
        ventasHoy: 300,
        efectivo: 100,
        transferencia: 0,
        fiado: 120,
        gastos: 20,
        maplesVendidos: 5,
        resultado: 280
      });

      // Readable back by date.
      const read = await request
        .get(`${API}/${dateKey(new Date(body.date))}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect((read.body as DailyCloseBody).difference).toBe(10);
    });

    it('rejects a second close for the same day with 409 (S5)', async () => {
      const first = await request
        .post(API)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ countedCash: 0 })
        .expect(201);

      await request
        .post(API)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ countedCash: 50 })
        .expect(409);

      expect(await DailyClose.countDocuments()).toBe(1);
      expect((first.body as DailyCloseBody).countedCash).toBe(0);
    });

    it('creates a zero-difference close on an empty day (S7)', async () => {
      const res = await request
        .post(API)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ countedCash: 0 })
        .expect(201);

      const body = res.body as DailyCloseBody;
      expect(body.systemCash).toBe(0);
      expect(body.difference).toBe(0);
    });

    it('rejects a negative countedCash with 400', async () => {
      await request
        .post(API)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ countedCash: -5 })
        .expect(400);
    });
  });

  describe('PATCH /:id', () => {
    it('recomputes difference from the frozen systemCash and keeps the snapshot (S6)', async () => {
      const order = await Order.create(orderPayload({ totalAmount: 300, balance: 120 }));
      await Payment.create({ orderId: order._id, amount: 100, method: 'cash', date: new Date() });
      await Expense.create({
        amount: 20,
        category: 'fuel',
        date: new Date(),
        description: 'Combustible',
        createdBy: 'admin'
      });
      await Return.create(returnPayload({ orderId: order._id, refundAmount: 10, effect: 'refund_cash' }));

      const created = await request
        .post(API)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ countedCash: 80 })
        .expect(201);
      const close = created.body as DailyCloseBody;

      const res = await request
        .patch(`${API}/${close._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ countedCash: 65 })
        .expect(200);

      const body = res.body as DailyCloseBody;
      expect(body.countedCash).toBe(65);
      expect(body.difference).toBe(-5);
      expect(body.systemCash).toBe(70);
      expect(body.summary).toMatchObject({ ventasHoy: 300, efectivo: 100, gastos: 20 });
    });

    it('returns 404 for an unknown id', async () => {
      await request
        .patch(`${API}/${new Types.ObjectId().toString()}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ countedCash: 10 })
        .expect(404);
    });
  });

  describe('GET / list', () => {
    it('lists only the closes in the inclusive range, newest first (S8)', async () => {
      const twoDaysAgo = localMidnight(daysAgo(2));
      const oneDayAgo = localMidnight(daysAgo(1));
      const today = localMidnight(new Date());

      await DailyClose.create([
        { date: twoDaysAgo, systemCash: 0, countedCash: 0, difference: 0, summary: {}, closedBy: 'admin' },
        { date: oneDayAgo, systemCash: 0, countedCash: 0, difference: 0, summary: {}, closedBy: 'admin' },
        { date: today, systemCash: 0, countedCash: 0, difference: 0, summary: {}, closedBy: 'admin' }
      ]);

      const res = await request
        .get(`${API}?from=${dateKey(twoDaysAgo)}&to=${dateKey(oneDayAgo)}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const list = res.body as DailyCloseBody[];
      expect(list).toHaveLength(2);
      expect(dateKey(new Date(list[0]!.date))).toBe(dateKey(oneDayAgo));
      expect(dateKey(new Date(list[1]!.date))).toBe(dateKey(twoDaysAgo));
    });

    it('returns 404 for a day without a close', async () => {
      await request
        .get(`${API}/${dateKey(daysAgo(5))}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('Channel scoping (puesto vs reparto)', () => {
    it('preview?channel=puesto reflects ONLY stall orders (S1)', async () => {
      const stallOrder = await Order.create(orderPayload({
        salesChannel: 'puesto',
        totalAmount: 200,
        balance: 50,
        items: [{
          productId: new Types.ObjectId(),
          productName: 'Blanco',
          quantity: 25,
          unit: 'maple',
          mapleQty: 25,
          unitPrice: 8,
          subtotal: 200
        }]
      }));
      // Non-stall orders must be excluded from the stall preview.
      await Order.create(orderPayload({ salesChannel: 'reparto', totalAmount: 500, balance: 500 }));
      await Order.create(orderPayload({ salesChannel: 'whatsapp', totalAmount: 300, balance: 300, status: 'cancelled' }));

      await Payment.create([
        { orderId: stallOrder._id, amount: 80, method: 'cash', date: new Date() },
        { orderId: stallOrder._id, amount: 70, method: 'transfer', date: new Date() }
      ]);
      // An expense on the same day must NOT leak into the stall close (gastos=0).
      await Expense.create({
        amount: 999,
        category: 'fuel',
        date: new Date(),
        description: 'Combustible',
        createdBy: 'admin'
      });

      const res = await request
        .get(`${API}/preview?channel=puesto`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const body = res.body as DaySummaryBody;
      expect(body.ventasHoy).toBe(200);
      expect(body.efectivo).toBe(80);
      expect(body.transferencia).toBe(70);
      expect(body.fiado).toBe(50);
      expect(body.gastos).toBe(0);
      expect(body.maplesVendidos).toBe(25);
    });

    it('reparto preview excludes stall orders and keeps its own expenses (S2)', async () => {
      await Order.create(orderPayload({ salesChannel: 'puesto', totalAmount: 200, balance: 200 }));
      const repartoOrder = await Order.create(orderPayload({
        salesChannel: 'whatsapp',
        totalAmount: 500,
        balance: 100
      }));
      await Payment.create({ orderId: repartoOrder._id, amount: 400, method: 'cash', date: new Date() });
      await Expense.create({
        amount: 30,
        category: 'fuel',
        date: new Date(),
        description: 'Combustible',
        createdBy: 'admin'
      });

      const res = await request
        .get(`${API}/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const body = res.body as DaySummaryBody;
      expect(body.ventasHoy).toBe(500);
      expect(body.efectivo).toBe(400);
      expect(body.fiado).toBe(100);
      expect(body.gastos).toBe(30);
      expect(body.systemCash).toBe(370); // 400 − 30
    });

    it('creates a stall close and lets it coexist with the reparto close the same day (S3)', async () => {
      await Order.create(orderPayload({ salesChannel: 'puesto', totalAmount: 200, balance: 200 }));

      const reparto = await request
        .post(API)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ countedCash: 10 })
        .expect(201);
      expect((reparto.body as DailyCloseBody).channel).toBe('reparto');

      const puesto = await request
        .post(API)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ countedCash: 20, channel: 'puesto' })
        .expect(201);
      expect((puesto.body as DailyCloseBody).channel).toBe('puesto');
      expect((puesto.body as DailyCloseBody).summary.ventasHoy).toBe(200);

      // Duplicate of the SAME channel → 409; the other channel stays untouched.
      await request
        .post(API)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ countedCash: 30, channel: 'puesto' })
        .expect(409);

      expect(await DailyClose.countDocuments()).toBe(2);
    });

    it('GET /:date defaults to the reparto close; ?channel=puesto selects the stall close', async () => {
      const today = dateKey(new Date());
      await request
        .post(API)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ countedCash: 5 })
        .expect(201);
      await request
        .post(API)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ countedCash: 7, channel: 'puesto' })
        .expect(201);

      const reparto = await request
        .get(`${API}/${today}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect((reparto.body as DailyCloseBody).channel).toBe('reparto');
      expect((reparto.body as DailyCloseBody).countedCash).toBe(5);

      const puesto = await request
        .get(`${API}/${today}?channel=puesto`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect((puesto.body as DailyCloseBody).channel).toBe('puesto');
      expect((puesto.body as DailyCloseBody).countedCash).toBe(7);
    });

    it('lists only the requested channel when ?channel= is passed', async () => {
      await DailyClose.create([
        { date: localMidnight(new Date()), systemCash: 0, countedCash: 1, difference: 0, channel: 'reparto', summary: {}, closedBy: 'admin' },
        { date: localMidnight(daysAgo(1)), systemCash: 0, countedCash: 2, difference: 0, channel: 'puesto', summary: {}, closedBy: 'admin' }
      ]);

      const res = await request
        .get(`${API}?channel=puesto`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const list = res.body as DailyCloseBody[];
      expect(list).toHaveLength(1);
      expect(list[0]!.channel).toBe('puesto');
      expect(list[0]!.countedCash).toBe(2);
    });
  });

  describe('Date bases: sales by business date, money by movement date', () => {
    it('counts a payment on its own day even when the order belongs to an earlier day', async () => {
      const saleDay = daysAgo(2);
      const moneyDay = new Date();

      const order = await Order.create(orderPayload({
        orderDate: saleDay,
        createdAt: saleDay,
        status: 'delivered',
        totalAmount: 130,
        paidAmount: 100,
        balance: 30,
        paymentStatus: 'partial'
      }));
      // Money moved TODAY, two days after the order was captured.
      await Payment.create({ orderId: order._id, amount: 100, method: 'cash', date: moneyDay });

      const today = await request
        .get(`${API}/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const todayBody = today.body as DaySummaryBody;
      expect(todayBody.efectivo).toBe(100);
      expect(todayBody.systemCash).toBe(100);
      // The sale belongs to its business day, not the capture day.
      expect(todayBody.ventasHoy).toBe(0);

      const sale = await request
        .get(`${API}/preview?date=${dateKey(saleDay)}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const saleBody = sale.body as DaySummaryBody;
      expect(saleBody.efectivo).toBe(0);
      expect(saleBody.systemCash).toBe(0);
      expect(saleBody.ventasHoy).toBe(130);
    });

    it('keeps day A payment income when the refund lands on day B (cancelled sale has no ventasHoy)', async () => {
      const saleDay = daysAgo(2);
      const refundDay = new Date();
      const paidAmount = 100;

      const order = await Order.create(orderPayload({
        orderDate: saleDay,
        createdAt: saleDay,
        status: 'pending',
        totalAmount: 150,
        paidAmount,
        balance: 50,
        paymentStatus: 'partial'
      }));
      await Payment.create({ orderId: order._id, amount: paidAmount, method: 'cash', date: saleDay });

      // Cancel TODAY: records the negative CashAdjustment on the refund day.
      await request
        .patch(`/api/v1/orders/${order._id.toString()}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled', moneyAction: 'refund_cash' })
        .expect(200);

      const refund = await request
        .get(`${API}/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const refundBody = refund.body as DaySummaryBody;
      // Refund outflow only — no payment moved that day.
      expect(refundBody.efectivo).toBe(0);
      expect(refundBody.systemCash).toBe(-paidAmount);
      expect(refundBody.ventasHoy).toBe(0);

      const sale = await request
        .get(`${API}/preview?date=${dateKey(saleDay)}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const saleBody = sale.body as DaySummaryBody;
      // Day A keeps the cash that physically came in.
      expect(saleBody.efectivo).toBe(paidAmount);
      expect(saleBody.systemCash).toBe(paidAmount);
      // The order is cancelled NOW, so the business-date sales metric is 0 even
      // for its sale day — cancelled sales never count (existing semantics).
      expect(saleBody.ventasHoy).toBe(0);
    });

    it('attributes a backdated sale to its business date, not the capture date', async () => {
      const saleDay = daysAgo(3);
      await Order.create(orderPayload({
        orderDate: saleDay,
        totalAmount: 125,
        balance: 0,
        paymentStatus: 'paid'
      }));

      const today = await request
        .get(`${API}/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const todayBody = today.body as DaySummaryBody;
      expect(todayBody.ventasHoy).toBe(0);
      expect(todayBody.fiado).toBe(0);
      expect(todayBody.maplesVendidos).toBe(0);

      const sale = await request
        .get(`${API}/preview?date=${dateKey(saleDay)}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const saleBody = sale.body as DaySummaryBody;
      expect(saleBody.ventasHoy).toBe(125);
      expect(saleBody.fiado).toBe(0);
      expect(saleBody.maplesVendidos).toBe(5);
    });
  });

  describe('Puesto (stall) close guards', () => {
    it('returns 403 when a puesto user PATCHes any close (admin-only correction)', async () => {
      const created = await request
        .post(API)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ countedCash: 0 })
        .expect(201);

      const res = await request
        .patch(`${API}/${(created.body as DailyCloseBody)._id}`)
        .set('Authorization', `Bearer ${puestoToken}`)
        .send({ countedCash: 50 });
      expect(res.status).toBe(403);
    });

    it('returns 403 when a puesto user closes the reparto channel (own channel only)', async () => {
      const res = await request
        .post(API)
        .set('Authorization', `Bearer ${puestoToken}`)
        .send({ countedCash: 0 });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/mostrador/i);

      const own = await request
        .post(API)
        .set('Authorization', `Bearer ${puestoToken}`)
        .send({ countedCash: 0, channel: 'puesto' })
        .expect(201);
      expect((own.body as DailyCloseBody).channel).toBe('puesto');
    });
  });
});
