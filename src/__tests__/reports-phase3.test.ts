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
  createTestCustomer,
  getProductIds
} from './helpers.js';
import { app } from '../app.js';
import { Order } from '../modules/orders/model.js';
import { Product } from '../modules/products/model.js';
import { Expense } from '../modules/expenses/model.js';
import { Payment } from '../modules/payments/model.js';
import { Return } from '../modules/returns/model.js';
import { CustomerCharge } from '../modules/customer-charges/model.js';

const request = supertest(app);

const createDeliveredOrder = async (params: {
  customerId: Types.ObjectId;
  customerName: string;
  items: Array<{ productId: Types.ObjectId; productName: string; quantity: number; unitPrice: number; subtotal: number }>;
  totalAmount: number;
  createdAt?: Date;
  /** Business/sale date. Defaults to `createdAt` so fixtures exercise the real field. */
  orderDate?: Date;
  salesChannel?: 'reparto' | 'puesto' | 'whatsapp' | 'otro';
}) => {
  return Order.create({
    orderNumber: `ORD-T-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    customerId: params.customerId,
    customerName: params.customerName,
    channel: 'phone',
    items: params.items,
    totalAmount: params.totalAmount,
    status: 'delivered',
    paymentStatus: 'paid',
    paidAmount: params.totalAmount,
    balance: 0,
    dueDate: null,
    salesChannel: params.salesChannel,
    createdAt: params.createdAt ?? new Date(),
    orderDate: params.orderDate ?? params.createdAt ?? new Date()
  });
};

const oid = (id: unknown) => new Types.ObjectId(id as string);

describe('Reports Phase 3 — Revenue & Profit', () => {
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

  describe('GET /api/v1/reports/revenue', () => {
    it('returns revenue report for delivered orders in date range', async () => {
      const c = await createTestCustomer({ name: 'Customer A' });
      const p = await getProductIds();

      await createDeliveredOrder({
        customerId: oid(c._id), customerName: 'Customer A',
        items: [{ productId: oid(p['blanco-chico']), productName: 'Blanco', quantity: 10, unitPrice: 25, subtotal: 250 }],
        totalAmount: 250, createdAt: new Date('2026-08-10')
      });
      await createDeliveredOrder({
        customerId: oid(c._id), customerName: 'Customer A',
        items: [{ productId: oid(p['castaño-chico']), productName: 'Castaño', quantity: 5, unitPrice: 26, subtotal: 130 }],
        totalAmount: 130, createdAt: new Date('2026-08-15')
      });

      const res = await request
        .get('/api/v1/reports/revenue?startDate=2026-08-01&endDate=2026-08-31')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.totalRevenue).toBe(380);
      expect(res.body.orderCount).toBe(2);
      expect(res.body.breakdown.byProduct).toHaveLength(2);
      expect(res.body.breakdown.byCustomer).toHaveLength(1);
      expect(res.body.breakdown.byCustomer[0].total).toBe(380);
    });

    it('excludes non-delivered orders', async () => {
      const c = await createTestCustomer();
      const p = await getProductIds();

      await createDeliveredOrder({
        customerId: oid(c._id), customerName: 'Test',
        items: [{ productId: oid(p['blanco-chico']), productName: 'Blanco', quantity: 5, unitPrice: 25, subtotal: 125 }],
        totalAmount: 125, createdAt: new Date('2026-08-10')
      });
      await Order.create({
        orderNumber: 'ORD-PEND-1', customerId: oid(c._id), customerName: 'Test', channel: 'phone',
        items: [{ productId: oid(p['blanco-chico']), productName: 'Blanco', quantity: 5, unitPrice: 25, subtotal: 125 }],
        totalAmount: 125, status: 'pending', paymentStatus: 'unpaid', paidAmount: 0, balance: 125
      });

      const res = await request
        .get('/api/v1/reports/revenue?startDate=2026-08-01&endDate=2026-08-31')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.totalRevenue).toBe(125);
      expect(res.body.orderCount).toBe(1);
    });

    it('returns zeros for empty period', async () => {
      const res = await request
        .get('/api/v1/reports/revenue?startDate=2025-01-01&endDate=2025-01-31')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.totalRevenue).toBe(0);
      expect(res.body.orderCount).toBe(0);
    });

    it('includes payment method breakdown via $lookup', async () => {
      const c = await createTestCustomer();
      const p = await getProductIds();

      const order = await createDeliveredOrder({
        customerId: oid(c._id), customerName: 'Test',
        items: [{ productId: oid(p['blanco-chico']), productName: 'Blanco', quantity: 4, unitPrice: 25, subtotal: 100 }],
        totalAmount: 100, createdAt: new Date('2026-08-10')
      });
      await Payment.create({ orderId: order._id, amount: 100, method: 'cash', date: new Date('2026-08-10') });

      const res = await request
        .get('/api/v1/reports/revenue?startDate=2026-08-01&endDate=2026-08-31')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.breakdown.byPaymentMethod).toHaveLength(1);
      expect(res.body.breakdown.byPaymentMethod[0].method).toBe('cash');
      expect(res.body.breakdown.byPaymentMethod[0].total).toBe(100);
    });

    it('returns 400 when date range is missing', async () => {
      await request.get('/api/v1/reports/revenue').set('Authorization', `Bearer ${adminToken}`).expect(400);
    });

    it('returns 400 when startDate > endDate', async () => {
      await request
        .get('/api/v1/reports/revenue?startDate=2026-08-31&endDate=2026-08-01')
        .set('Authorization', `Bearer ${adminToken}`).expect(400);
    });

    it('returns 403 for driver', async () => {
      await request
        .get('/api/v1/reports/revenue?startDate=2026-08-01&endDate=2026-08-31')
        .set('Authorization', `Bearer ${driverToken}`).expect(403);
    });

    it('returns 401 without auth', async () => {
      await request.get('/api/v1/reports/revenue?startDate=2026-08-01&endDate=2026-08-31').expect(401);
    });

    it('breaks revenue down by sales channel — Σ byChannel == totalRevenue (S5)', async () => {
      const c = await createTestCustomer({ name: 'Multi Canal' });
      const p = await getProductIds();

      // 2 reparto orders: 250 + 130 = 380
      await createDeliveredOrder({
        customerId: oid(c._id), customerName: 'Multi Canal', salesChannel: 'reparto',
        items: [{ productId: oid(p['blanco-chico']), productName: 'Blanco', quantity: 10, unitPrice: 25, subtotal: 250 }],
        totalAmount: 250, createdAt: new Date('2026-08-10')
      });
      await createDeliveredOrder({
        customerId: oid(c._id), customerName: 'Multi Canal', salesChannel: 'reparto',
        items: [{ productId: oid(p['castaño-chico']), productName: 'Castaño', quantity: 5, unitPrice: 26, subtotal: 130 }],
        totalAmount: 130, createdAt: new Date('2026-08-12')
      });
      // 1 puesto order: 100
      await createDeliveredOrder({
        customerId: oid(c._id), customerName: 'Multi Canal', salesChannel: 'puesto',
        items: [{ productId: oid(p['blanco-chico']), productName: 'Blanco', quantity: 4, unitPrice: 25, subtotal: 100 }],
        totalAmount: 100, createdAt: new Date('2026-08-15')
      });

      const res = await request
        .get('/api/v1/reports/revenue?startDate=2026-08-01&endDate=2026-08-31')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const byChannel = res.body.breakdown.byChannel as Array<{ canal: string; monto: number; ordenes: number }>;
      expect(byChannel).toHaveLength(2);

      const reparto = byChannel.find((b) => b.canal === 'reparto');
      const puesto = byChannel.find((b) => b.canal === 'puesto');
      expect(reparto).toEqual({ canal: 'reparto', monto: 380, ordenes: 2 });
      expect(puesto).toEqual({ canal: 'puesto', monto: 100, ordenes: 1 });

      // Σ byChannel.monto == totalRevenue exactly
      const sum = byChannel.reduce((acc, b) => acc + b.monto, 0);
      expect(sum).toBe(res.body.totalRevenue);
      expect(res.body.totalRevenue).toBe(480);
    });

    it('returns empty byChannel for an empty period (S6)', async () => {
      const res = await request
        .get('/api/v1/reports/revenue?startDate=2025-01-01&endDate=2025-01-31')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.totalRevenue).toBe(0);
      expect(res.body.breakdown.byChannel).toEqual([]);
    });

    it('excludes cancelled orders from byChannel (S7)', async () => {
      const c = await createTestCustomer({ name: 'Cancelado' });
      const p = await getProductIds();

      await createDeliveredOrder({
        customerId: oid(c._id), customerName: 'Cancelado', salesChannel: 'puesto',
        items: [{ productId: oid(p['blanco-chico']), productName: 'Blanco', quantity: 4, unitPrice: 25, subtotal: 100 }],
        totalAmount: 100, createdAt: new Date('2026-08-10')
      });
      // Cancelled order with salesChannel 'puesto' — must NOT appear
      await Order.create({
        orderNumber: 'ORD-CANC-1', customerId: oid(c._id), customerName: 'Cancelado', channel: 'phone',
        salesChannel: 'puesto',
        items: [{ productId: oid(p['blanco-chico']), productName: 'Blanco', quantity: 10, unitPrice: 25, subtotal: 250 }],
        totalAmount: 250, status: 'cancelled', paymentStatus: 'unpaid', paidAmount: 0, balance: 250,
        createdAt: new Date('2026-08-12')
      });

      const res = await request
        .get('/api/v1/reports/revenue?startDate=2026-08-01&endDate=2026-08-31')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.totalRevenue).toBe(100);
      expect(res.body.breakdown.byChannel).toEqual([{ canal: 'puesto', monto: 100, ordenes: 1 }]);
    });

    it('groups legacy orders (no salesChannel field) as reparto (S4)', async () => {
      const c = await createTestCustomer({ name: 'Legacy' });
      const p = await getProductIds();

      // Raw insert bypassing mongoose defaults → the doc genuinely lacks the field
      await Order.collection.insertOne({
        orderNumber: 'ORD-LEGACY-1',
        customerId: oid(c._id),
        customerName: 'Legacy',
        channel: 'phone',
        items: [{ productId: oid(p['blanco-chico']), productName: 'Blanco', quantity: 6, unitPrice: 25, subtotal: 150 }],
        totalAmount: 150,
        status: 'delivered',
        paymentStatus: 'paid',
        paidAmount: 150,
        balance: 0,
        dueDate: null,
        createdAt: new Date('2026-08-10')
      });

      const res = await request
        .get('/api/v1/reports/revenue?startDate=2026-08-01&endDate=2026-08-31')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.totalRevenue).toBe(150);
      expect(res.body.breakdown.byChannel).toEqual([{ canal: 'reparto', monto: 150, ordenes: 1 }]);
    });
  });

  describe('GET /api/v1/reports/profit', () => {
    it('calculates profit = revenue - COGS - expenses', async () => {
      const c = await createTestCustomer();
      const p = await getProductIds();
      await Product.findByIdAndUpdate(p['blanco-chico'], { costPrice: 18.50 });

      await createDeliveredOrder({
        customerId: oid(c._id), customerName: 'Test',
        items: [{ productId: oid(p['blanco-chico']), productName: 'Blanco', quantity: 10, unitPrice: 25, subtotal: 250 }],
        totalAmount: 250, createdAt: new Date('2026-08-10')
      });
      await Expense.create({ amount: 50, category: 'fuel', date: new Date('2026-08-15'), description: 'Diesel', createdBy: 'admin' });

      const res = await request
        .get('/api/v1/reports/profit?startDate=2026-08-01&endDate=2026-08-31')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.revenue).toBe(250);
      expect(res.body.cogs).toBe(185);
      expect(res.body.expenses).toBe(50);
      expect(res.body.profit).toBe(15);
      expect(res.body.partialCOGS).toBe(false);
    });

    it('splits accrual revenue into collected and pendingCollection', async () => {
      const c = await createTestCustomer({ name: 'Cobros' });
      const p = await getProductIds();

      const deliveredOrder = (params: {
        orderNumber: string;
        totalAmount: number;
        paidAmount: number;
        balance: number;
        paymentStatus: 'paid' | 'partial' | 'unpaid';
        orderDate: Date;
      }) =>
        Order.create({
          orderNumber: params.orderNumber,
          customerId: oid(c._id),
          customerName: 'Cobros',
          channel: 'phone',
          items: [
            {
              productId: oid(p['blanco-chico']),
              productName: 'Blanco',
              quantity: 1,
              unitPrice: params.totalAmount,
              subtotal: params.totalAmount
            }
          ],
          totalAmount: params.totalAmount,
          status: 'delivered',
          paymentStatus: params.paymentStatus,
          paidAmount: params.paidAmount,
          balance: params.balance,
          dueDate: null,
          orderDate: params.orderDate
        });

      // Same day: fully paid (100) + partially paid (200, 50 collected).
      await deliveredOrder({
        orderNumber: 'ORD-COLLECT-1',
        totalAmount: 100,
        paidAmount: 100,
        balance: 0,
        paymentStatus: 'paid',
        orderDate: new Date(2026, 7, 10, 12)
      });
      await deliveredOrder({
        orderNumber: 'ORD-COLLECT-2',
        totalAmount: 200,
        paidAmount: 50,
        balance: 150,
        paymentStatus: 'partial',
        orderDate: new Date(2026, 7, 10, 12)
      });
      // Different day: fully unpaid (300).
      await deliveredOrder({
        orderNumber: 'ORD-COLLECT-3',
        totalAmount: 300,
        paidAmount: 0,
        balance: 300,
        paymentStatus: 'unpaid',
        orderDate: new Date(2026, 7, 15, 12)
      });

      // Cancelled order in the same period — must NOT feed collected/pending.
      await Order.create({
        orderNumber: 'ORD-COLLECT-CANCELLED',
        customerId: oid(c._id),
        customerName: 'Cobros',
        channel: 'phone',
        items: [
          {
            productId: oid(p['blanco-chico']),
            productName: 'Blanco',
            quantity: 1,
            unitPrice: 500,
            subtotal: 500
          }
        ],
        totalAmount: 500,
        status: 'cancelled',
        paymentStatus: 'partial',
        paidAmount: 100,
        balance: 400,
        dueDate: null,
        orderDate: new Date(2026, 7, 12, 12)
      });

      const res = await request
        .get('/api/v1/reports/profit?startDate=2026-08-01&endDate=2026-08-31')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Accrual revenue is unchanged — the cancelled order is excluded too.
      expect(res.body.revenue).toBe(600);
      // Σ paidAmount of delivered orders: 100 + 50 + 0
      expect(res.body.collected).toBe(150);
      // Σ balance of delivered orders: 0 + 150 + 300
      expect(res.body.pendingCollection).toBe(450);
      expect(res.body.collected + res.body.pendingCollection).toBe(res.body.revenue);

      const day = (res.body.byDay as Array<{
        date: string;
        revenue: number;
        collected: number;
        pendingCollection: number;
      }>).find((d) => d.date === '2026-08-10');

      expect(day).toMatchObject({
        date: '2026-08-10',
        revenue: 300,
        collected: 150,
        pendingCollection: 150
      });
      expect((day?.collected ?? 0) + (day?.pendingCollection ?? 0)).toBe(day?.revenue);
    });

    it('sets partialCOGS=true when products have null costPrice', async () => {
      const c = await createTestCustomer();
      const p = await getProductIds();
      await Product.findByIdAndUpdate(p['blanco-chico'], { costPrice: 18.50 });

      await createDeliveredOrder({
        customerId: oid(c._id), customerName: 'Test',
        items: [
          { productId: oid(p['blanco-chico']), productName: 'Blanco', quantity: 10, unitPrice: 25, subtotal: 250 },
          { productId: oid(p['castaño-chico']), productName: 'Castaño', quantity: 5, unitPrice: 26, subtotal: 130 }
        ],
        totalAmount: 380, createdAt: new Date('2026-08-10')
      });

      const res = await request
        .get('/api/v1/reports/profit?startDate=2026-08-01&endDate=2026-08-31')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.revenue).toBe(380);
      expect(res.body.cogs).toBe(185);
      expect(res.body.partialCOGS).toBe(true);
      expect(res.body.disclaimer).toContain('missing cost price');
    });

    it('reports each sale on its business date (orderDate), not the capture timestamp', async () => {
      const c = await createTestCustomer({ name: 'Historico' });
      const p = await getProductIds();

      // Both orders were captured in the same sitting (same createdAt instant)…
      const capturedAt = new Date();
      // …but they belong to two different past business days (local noon, the
      // same normalization the API applies).
      const firstDay = new Date(2026, 7, 10, 12, 0, 0, 0);
      const secondDay = new Date(2026, 7, 15, 12, 0, 0, 0);

      await createDeliveredOrder({
        customerId: oid(c._id), customerName: 'Historico',
        items: [{ productId: oid(p['blanco-chico']), productName: 'Blanco', quantity: 10, unitPrice: 25, subtotal: 250 }],
        totalAmount: 250, createdAt: capturedAt, orderDate: firstDay
      });
      await createDeliveredOrder({
        customerId: oid(c._id), customerName: 'Historico',
        items: [{ productId: oid(p['castaño-chico']), productName: 'Castaño', quantity: 5, unitPrice: 26, subtotal: 130 }],
        totalAmount: 130, createdAt: capturedAt, orderDate: secondDay
      });

      const first = await request
        .get('/api/v1/reports/profit?startDate=2026-08-10&endDate=2026-08-10')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(first.body.revenue).toBe(250);
      expect(first.body.byDay).toHaveLength(1);
      expect(first.body.byDay[0]).toMatchObject({ date: '2026-08-10', revenue: 250, orderCount: 1 });

      const second = await request
        .get('/api/v1/reports/profit?startDate=2026-08-15&endDate=2026-08-15')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(second.body.revenue).toBe(130);
      expect(second.body.byDay).toHaveLength(1);
      expect(second.body.byDay[0]).toMatchObject({ date: '2026-08-15', revenue: 130, orderCount: 1 });

      // A range covering both days keeps each amount on its own day.
      const both = await request
        .get('/api/v1/reports/profit?startDate=2026-08-01&endDate=2026-08-31')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(both.body.revenue).toBe(380);
      const byDay = new Map(
        (both.body.byDay as Array<{ date: string; revenue: number }>).map((day) => [day.date, day.revenue])
      );
      expect(byDay.size).toBe(2);
      expect(byDay.get('2026-08-10')).toBe(250);
      expect(byDay.get('2026-08-15')).toBe(130);
    });

    it('handles zero revenue', async () => {
      const res = await request
        .get('/api/v1/reports/profit?startDate=2025-01-01&endDate=2025-01-31')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.revenue).toBe(0);
      expect(res.body.cogs).toBe(0);
      expect(res.body.expenses).toBe(0);
      expect(res.body.profit).toBe(0);
      expect(res.body.margin).toBe(0);
    });

    it('returns 400 when date range is missing', async () => {
      await request.get('/api/v1/reports/profit').set('Authorization', `Bearer ${adminToken}`).expect(400);
    });

    it('returns 403 for driver', async () => {
      await request
        .get('/api/v1/reports/profit?startDate=2026-08-01&endDate=2026-08-31')
        .set('Authorization', `Bearer ${driverToken}`).expect(403);
    });
  });

  describe('GET /api/v1/reports/profit — cash basis & receivable', () => {
    /** ART noon for a business date (15:00Z), safely inside the calendar day. */
    const artNoon = (date: string) => new Date(`${date}T15:00:00.000Z`);

    const getProfit = async (startDate = '2026-08-01', endDate = '2026-08-31') =>
      request
        .get(`/api/v1/reports/profit?startDate=${startDate}&endDate=${endDate}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

    it('counts a payment collected in the period for an order sold earlier, without accrual revenue', async () => {
      const c = await createTestCustomer({ name: 'Cobrado Tardío' });
      const p = await getProductIds();
      await Product.findByIdAndUpdate(p['blanco-chico'], { costPrice: 6 });

      // Sold in JULY (outside the queried period).
      const order = await createDeliveredOrder({
        customerId: oid(c._id),
        customerName: 'Cobrado Tardío',
        items: [
          {
            productId: oid(p['blanco-chico']),
            productName: 'Blanco',
            quantity: 10,
            unitPrice: 10,
            subtotal: 100
          }
        ],
        totalAmount: 100,
        createdAt: artNoon('2026-07-15'),
        orderDate: artNoon('2026-07-15')
      });

      // …but the money arrived in AUGUST.
      await Payment.create({
        orderId: order._id,
        amount: 100,
        method: 'cash',
        date: artNoon('2026-08-10')
      });

      const res = await getProfit();

      // Accrual revenue only counts August sales → zero.
      expect(res.body.revenue).toBe(0);
      // Cash basis counts the August movement: 100 collected, cost 10 × 6 = 60.
      expect(res.body.cashBasis.collected).toBe(100);
      expect(res.body.cashBasis.refunded).toBe(0);
      expect(res.body.cashBasis.cogs).toBe(60);
      expect(res.body.cashBasis.profit).toBe(40);
    });

    it('keeps an unpaid delivered order in accrual profit but contributes zero cash', async () => {
      const c = await createTestCustomer({ name: 'Sin Cobrar' });
      const p = await getProductIds();
      await Product.findByIdAndUpdate(p['blanco-chico'], { costPrice: 6 });

      await Order.create({
        orderNumber: 'ORD-UNPAID-CASH',
        customerId: oid(c._id),
        customerName: 'Sin Cobrar',
        channel: 'phone',
        items: [
          {
            productId: oid(p['blanco-chico']),
            productName: 'Blanco',
            quantity: 10,
            unitPrice: 10,
            subtotal: 100
          }
        ],
        totalAmount: 100,
        status: 'delivered',
        paymentStatus: 'unpaid',
        paidAmount: 0,
        balance: 100,
        orderDate: artNoon('2026-08-10')
      });

      const res = await getProfit();

      // Accrual: sale counted even though nobody paid.
      expect(res.body.revenue).toBe(100);
      expect(res.body.profit).toBe(40);
      // Cash: no movement → nothing collected or earned in cash.
      expect(res.body.cashBasis.collected).toBe(0);
      expect(res.body.cashBasis.cogs).toBe(0);
      expect(res.body.cashBasis.profit).toBe(0);
      expect(res.body.cashBasis.byDay).toEqual([]);
    });

    it('applies the proportional cost to a partial payment', async () => {
      const c = await createTestCustomer({ name: 'Pago Parcial' });
      const p = await getProductIds();
      // 10 maples × $60 = $600 COGS on a $1000 sale.
      await Product.findByIdAndUpdate(p['blanco-chico'], { costPrice: 60 });

      const order = await Order.create({
        orderNumber: 'ORD-PARTIAL-CASH',
        customerId: oid(c._id),
        customerName: 'Pago Parcial',
        channel: 'phone',
        items: [
          {
            productId: oid(p['blanco-chico']),
            productName: 'Blanco',
            quantity: 10,
            mapleQty: 10,
            unitPrice: 100,
            subtotal: 1000
          }
        ],
        totalAmount: 1000,
        status: 'delivered',
        paymentStatus: 'partial',
        paidAmount: 400,
        balance: 600,
        orderDate: artNoon('2026-08-05')
      });

      await Payment.create({
        orderId: order._id,
        amount: 400,
        method: 'cash',
        date: artNoon('2026-08-10')
      });

      const res = await getProfit();

      // 400 × 600 / 1000 = 240 cost → 160 cash profit.
      expect(res.body.cashBasis.collected).toBe(400);
      expect(res.body.cashBasis.cogs).toBe(240);
      expect(res.body.cashBasis.profit).toBe(160);
      // Accrual view is untouched.
      expect(res.body.revenue).toBe(1000);
      expect(res.body.cogs).toBe(600);
    });

    it('reduces collected and the proportional cost for a cash refund in the period', async () => {
      const c = await createTestCustomer({ name: 'Reintegro' });
      const p = await getProductIds();
      await Product.findByIdAndUpdate(p['blanco-chico'], { costPrice: 60 });

      const order = await Order.create({
        orderNumber: 'ORD-REFUND-CASH',
        customerId: oid(c._id),
        customerName: 'Reintegro',
        channel: 'phone',
        items: [
          {
            productId: oid(p['blanco-chico']),
            productName: 'Blanco',
            quantity: 10,
            mapleQty: 10,
            unitPrice: 100,
            subtotal: 1000
          }
        ],
        totalAmount: 1000,
        status: 'delivered',
        paymentStatus: 'paid',
        paidAmount: 800,
        balance: 0,
        orderDate: artNoon('2026-08-05')
      });

      await Payment.create({
        orderId: order._id,
        amount: 1000,
        method: 'cash',
        date: artNoon('2026-08-10')
      });

      await Return.create({
        orderId: order._id,
        customerId: oid(c._id),
        date: artNoon('2026-08-12'),
        items: [
          {
            productId: oid(p['blanco-chico']),
            productName: 'Blanco',
            quantity: 2,
            unit: 'maple',
            mapleQty: 2,
            unitPrice: 100,
            subtotal: 200
          }
        ],
        returnedAmount: 200,
        refundAmount: 200,
        refundAccount: 'cash',
        reason: 'broken',
        effect: 'refund_cash',
        createdBy: 'admin'
      });

      const res = await getProfit();

      // Payment 1000 with 600 cost; refund 200 releases 200 × 600 / 1000 = 120.
      expect(res.body.cashBasis.collected).toBe(1000);
      expect(res.body.cashBasis.refunded).toBe(200);
      expect(res.body.cashBasis.cogs).toBe(480);
      expect(res.body.cashBasis.profit).toBe(320);

      // Per-day rows: 1000/600 on the 10th, −120 cost on the refund day.
      const days = res.body.cashBasis.byDay as Array<{
        date: string;
        collected: number;
        refunded: number;
        cogs: number;
        profit: number;
      }>;
      expect(days.map((d) => d.date)).toEqual(['2026-08-12', '2026-08-10']);
      expect(days[0]).toMatchObject({ date: '2026-08-12', collected: 0, refunded: 200, cogs: -120, profit: -80 });
      expect(days[1]).toMatchObject({ date: '2026-08-10', collected: 1000, refunded: 0, cogs: 600, profit: 400 });
    });

    it('keeps cashBasis.byDay sums equal to the period totals', async () => {
      const c = await createTestCustomer({ name: 'Varios Días' });
      const p = await getProductIds();
      await Product.findByIdAndUpdate(p['blanco-chico'], { costPrice: 6 });

      const first = await createDeliveredOrder({
        customerId: oid(c._id),
        customerName: 'Varios Días',
        items: [
          { productId: oid(p['blanco-chico']), productName: 'Blanco', quantity: 10, unitPrice: 10, subtotal: 100 }
        ],
        totalAmount: 100,
        createdAt: artNoon('2026-08-03'),
        orderDate: artNoon('2026-08-03')
      });
      const second = await createDeliveredOrder({
        customerId: oid(c._id),
        customerName: 'Varios Días',
        items: [
          { productId: oid(p['blanco-chico']), productName: 'Blanco', quantity: 20, unitPrice: 10, subtotal: 200 }
        ],
        totalAmount: 200,
        createdAt: artNoon('2026-08-03'),
        orderDate: artNoon('2026-08-03')
      });

      await Payment.create([
        { orderId: first._id, amount: 100, method: 'cash', date: artNoon('2026-08-04') },
        { orderId: second._id, amount: 50, method: 'transfer', date: artNoon('2026-08-09') },
        { orderId: second._id, amount: 150, method: 'cash', date: artNoon('2026-08-20') }
      ]);

      const res = await getProfit();
      const cash = res.body.cashBasis as {
        collected: number;
        refunded: number;
        cogs: number;
        profit: number;
        byDay: Array<{ collected: number; refunded: number; cogs: number; profit: number }>;
      };

      expect(cash.byDay).toHaveLength(3);
      const sum = (field: 'collected' | 'refunded' | 'cogs' | 'profit') =>
        Math.round(cash.byDay.reduce((acc, day) => acc + day[field], 0) * 100) / 100;
      expect(sum('collected')).toBe(cash.collected);
      expect(sum('refunded')).toBe(cash.refunded);
      expect(sum('cogs')).toBe(cash.cogs);
      expect(sum('profit')).toBe(cash.profit);
      expect(cash.collected).toBe(300);
    });

    it('matches the dashboard porCobrar / clientesDeudores canonically', async () => {
      // 1) openingDebt-only customer.
      await createTestCustomer({ name: 'Solo Inicial', openingDebt: 750 });
      // 2) manual-charge-only customer.
      const chargeCustomer = await createTestCustomer({ name: 'Solo Manual' });
      await CustomerCharge.create({
        customerId: oid(chargeCustomer._id),
        type: 'charge',
        amount: 500,
        reason: 'manual_debt',
        source: 'manual',
        createdBy: new Types.ObjectId()
      });
      // 3) order-debt customer with an overdue order.
      const orderCustomer = await createTestCustomer({ name: 'Con Pedido' });
      await Order.create({
        orderNumber: 'ORD-RECEIVABLE-1',
        customerId: oid(orderCustomer._id),
        customerName: 'Con Pedido',
        channel: 'phone',
        items: [
          {
            productId: oid((await getProductIds())['blanco-chico']),
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
        dueDate: new Date('2026-01-01T12:00:00.000Z')
      });
      // 4) paid customer must not be counted.
      const paidCustomer = await createTestCustomer({ name: 'Al Día' });
      await createDeliveredOrder({
        customerId: oid(paidCustomer._id),
        customerName: 'Al Día',
        items: [
          {
            productId: oid((await getProductIds())['blanco-chico']),
            productName: 'Blanco',
            quantity: 1,
            unitPrice: 25,
            subtotal: 25
          }
        ],
        totalAmount: 25,
        createdAt: artNoon('2026-08-10'),
        orderDate: artNoon('2026-08-10')
      });

      const [profitRes, dashboardRes] = await Promise.all([
        getProfit(),
        request
          .get('/api/v1/dashboard/summary')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200)
      ]);

      // 750 openingDebt + 500 charge + 125 order balance.
      expect(profitRes.body.receivable.total).toBe(1375);
      expect(profitRes.body.receivable.total).toBe(dashboardRes.body.porCobrar);
      expect(profitRes.body.receivable.customerCount).toBe(3);
      expect(profitRes.body.receivable.customerCount).toBe(dashboardRes.body.clientesDeudores);
      expect(profitRes.body.receivable.overdue).toBe(125);
      expect(profitRes.body.receivable.upcoming).toBe(1250);
    });
  });
});

describe('Reports Phase 3 — Customer Analytics', () => {
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

  describe('GET /api/v1/reports/customers/:id/history', () => {
    it('returns customer history with computed fields', async () => {
      const c = await createTestCustomer({ name: 'History Customer' });
      const p = await getProductIds();

      await createDeliveredOrder({
        customerId: oid(c._id), customerName: 'History Customer',
        items: [{ productId: oid(p['blanco-chico']), productName: 'Blanco', quantity: 5, unitPrice: 25, subtotal: 125 }],
        totalAmount: 125, createdAt: new Date('2026-08-01')
      });
      await createDeliveredOrder({
        customerId: oid(c._id), customerName: 'History Customer',
        items: [{ productId: oid(p['blanco-chico']), productName: 'Blanco', quantity: 3, unitPrice: 25, subtotal: 75 }],
        totalAmount: 75, createdAt: new Date('2026-08-20')
      });

      const res = await request
        .get(`/api/v1/reports/customers/${c._id}/history`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.customerId).toBe((c._id as string).toString());
      expect(res.body.customerName).toBe('History Customer');
      expect(res.body.orders).toHaveLength(2);
      expect(res.body.totalSpent).toBe(200);
      expect(res.body.orderCount).toBe(2);
      expect(res.body.avgOrderValue).toBe(100);
      expect(res.body.lastPurchaseDate).toBeDefined();
    });

    it('returns empty history for customer with no orders', async () => {
      const c = await createTestCustomer({ name: 'No Orders' });

      const res = await request
        .get(`/api/v1/reports/customers/${c._id}/history`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.orders).toHaveLength(0);
      expect(res.body.totalSpent).toBe(0);
      expect(res.body.orderCount).toBe(0);
      expect(res.body.avgOrderValue).toBe(0);
      expect(res.body.lastPurchaseDate).toBeNull();
    });

    it('returns 404 for non-existent customer', async () => {
      await request
        .get('/api/v1/reports/customers/507f1f77bcf86cd799439011/history')
        .set('Authorization', `Bearer ${adminToken}`).expect(404);
    });

    it('returns 403 for driver', async () => {
      const c = await createTestCustomer();
      await request
        .get(`/api/v1/reports/customers/${c._id}/history`)
        .set('Authorization', `Bearer ${driverToken}`).expect(403);
    });
  });

  describe('GET /api/v1/reports/customers/:id/frequency', () => {
    it('returns monthly frequency', async () => {
      const c = await createTestCustomer();
      const p = await getProductIds();

      await createDeliveredOrder({
        customerId: oid(c._id), customerName: 'Test',
        items: [{ productId: oid(p['blanco-chico']), productName: 'Blanco', quantity: 5, unitPrice: 25, subtotal: 125 }],
        totalAmount: 125, createdAt: new Date('2026-06-15')
      });
      await createDeliveredOrder({
        customerId: oid(c._id), customerName: 'Test',
        items: [{ productId: oid(p['blanco-chico']), productName: 'Blanco', quantity: 3, unitPrice: 25, subtotal: 75 }],
        totalAmount: 75, createdAt: new Date('2026-07-10')
      });
      await createDeliveredOrder({
        customerId: oid(c._id), customerName: 'Test',
        items: [{ productId: oid(p['blanco-chico']), productName: 'Blanco', quantity: 2, unitPrice: 25, subtotal: 50 }],
        totalAmount: 50, createdAt: new Date('2026-07-25')
      });

      const res = await request
        .get(`/api/v1/reports/customers/${c._id}/frequency?period=monthly&startDate=2026-06-01&endDate=2026-07-31`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.period).toBe('monthly');
      expect(res.body.periods).toHaveLength(2);
      expect(res.body.periods[0].period).toBe('2026-06');
      expect(res.body.periods[0].count).toBe(1);
      expect(res.body.periods[1].period).toBe('2026-07');
      expect(res.body.periods[1].count).toBe(2);
    });

    it('defaults to monthly when period is not specified', async () => {
      const c = await createTestCustomer();
      const res = await request
        .get(`/api/v1/reports/customers/${c._id}/frequency`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.period).toBe('monthly');
    });

    it('returns 404 for non-existent customer', async () => {
      await request
        .get('/api/v1/reports/customers/507f1f77bcf86cd799439011/frequency')
        .set('Authorization', `Bearer ${adminToken}`).expect(404);
    });

    it('returns 403 for driver', async () => {
      const c = await createTestCustomer();
      await request
        .get(`/api/v1/reports/customers/${c._id}/frequency`)
        .set('Authorization', `Bearer ${driverToken}`).expect(403);
    });
  });

  describe('GET /api/v1/reports/customers/top', () => {
    it('returns top customers sorted by revenue', async () => {
      const p = await getProductIds();
      const c1 = await createTestCustomer({ name: 'Top Buyer' });
      const c2 = await createTestCustomer({ name: 'Medium Buyer' });
      const c3 = await createTestCustomer({ name: 'Small Buyer' });

      await createDeliveredOrder({
        customerId: oid(c1._id), customerName: 'Top Buyer',
        items: [{ productId: oid(p['blanco-chico']), productName: 'Blanco', quantity: 20, unitPrice: 25, subtotal: 500 }],
        totalAmount: 500, createdAt: new Date('2026-08-10')
      });
      await createDeliveredOrder({
        customerId: oid(c3._id), customerName: 'Small Buyer',
        items: [{ productId: oid(p['blanco-chico']), productName: 'Blanco', quantity: 2, unitPrice: 25, subtotal: 50 }],
        totalAmount: 50, createdAt: new Date('2026-08-12')
      });
      await createDeliveredOrder({
        customerId: oid(c2._id), customerName: 'Medium Buyer',
        items: [{ productId: oid(p['blanco-chico']), productName: 'Blanco', quantity: 10, unitPrice: 25, subtotal: 250 }],
        totalAmount: 250, createdAt: new Date('2026-08-14')
      });

      const res = await request
        .get('/api/v1/reports/customers/top?limit=5')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveLength(3);
      expect(res.body[0].customerName).toBe('Top Buyer');
      expect(res.body[0].totalRevenue).toBe(500);
      expect(res.body[1].customerName).toBe('Medium Buyer');
      expect(res.body[1].totalRevenue).toBe(250);
      expect(res.body[2].customerName).toBe('Small Buyer');
      expect(res.body[2].totalRevenue).toBe(50);
    });

    it('defaults to limit=10', async () => {
      const res = await request
        .get('/api/v1/reports/customers/top')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body).toHaveLength(0);
    });

    it('returns 400 for limit=0', async () => {
      await request
        .get('/api/v1/reports/customers/top?limit=0')
        .set('Authorization', `Bearer ${adminToken}`).expect(400);
    });

    it('returns 403 for driver', async () => {
      await request
        .get('/api/v1/reports/customers/top')
        .set('Authorization', `Bearer ${driverToken}`).expect(403);
    });
  });
});
