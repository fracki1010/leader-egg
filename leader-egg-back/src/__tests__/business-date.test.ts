import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { Types } from 'mongoose';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  seedProducts,
  getProductIds,
  createTestCustomer,
  loginAs,
  app
} from './helpers.js';
import { Expense } from '../modules/expenses/model.js';
import { CashAdjustment } from '../modules/cash-adjustments/model.js';
import { CustomerCharge } from '../modules/customer-charges/model.js';
import { Purchase } from '../modules/purchases/model.js';
import { Payment } from '../modules/payments/model.js';
import { Order } from '../modules/orders/model.js';
import { Supplier } from '../modules/suppliers/model.js';

const request = supertest(app);

const NOON_UTC = '2026-10-27T12:00:00.000Z';

const auth = (token: string): string => `Bearer ${token}`;

describe('Business date normalization (date-only inputs)', () => {
  let adminToken: string;
  let products: Record<string, string>;

  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
    await seedProducts();
    products = await getProductIds();
    const admin = await seedAdminUser();
    adminToken = await loginAs(request, admin.email, admin.password);
  });

  it('anchors an expense at noon UTC and lists it in the cash ledger for that day only', async () => {
    const created = await request
      .post('/api/v1/expenses')
      .set('Authorization', auth(adminToken))
      .send({ amount: 1500, category: 'fuel', date: '2026-10-27', description: 'Nafta' })
      .expect(201);

    const stored = await Expense.findById(created.body._id);
    expect(stored!.date.toISOString()).toBe(NOON_UTC);

    const sameDay = await request
      .get('/api/v1/cash/movements?from=2026-10-27&to=2026-10-27&type=expense')
      .set('Authorization', auth(adminToken))
      .expect(200);
    expect(sameDay.body.movements).toHaveLength(1);
    expect(sameDay.body.movements[0].id).toBe(String(created.body._id));

    const previousDay = await request
      .get('/api/v1/cash/movements?from=2026-10-26&to=2026-10-26&type=expense')
      .set('Authorization', auth(adminToken))
      .expect(200);
    expect(previousDay.body.movements).toHaveLength(0);
  });

  it('anchors a cash adjustment at noon UTC', async () => {
    const created = await request
      .post('/api/v1/cash-adjustments')
      .set('Authorization', auth(adminToken))
      .send({ account: 'cash', amount: 500, reason: 'found', date: '2026-10-27' })
      .expect(201);

    const stored = await CashAdjustment.findById(created.body._id);
    expect(stored!.date.toISOString()).toBe(NOON_UTC);
  });

  it('anchors a customer charge at noon UTC', async () => {
    const customer = await createTestCustomer();

    const created = await request
      .post(`/api/v1/customers/${customer._id}/charges`)
      .set('Authorization', auth(adminToken))
      .send({ type: 'charge', amount: 5000, reason: 'manual_debt', date: '2026-10-27' })
      .expect(201);

    const stored = await CustomerCharge.findById(created.body._id);
    expect(stored!.date.toISOString()).toBe(NOON_UTC);
  });

  it('anchors a purchase at noon UTC and lists it on the picked day', async () => {
    const supplier = await Supplier.create({ name: 'Granja Test' });

    const created = await request
      .post('/api/v1/purchases')
      .set('Authorization', auth(adminToken))
      .send({
        supplierId: String(supplier._id),
        date: '2026-10-27',
        items: [{ productId: products['blanco-chico'], quantity: 5, unitCost: 100 }]
      })
      .expect(201);

    const stored = await Purchase.findById(created.body._id);
    expect(stored!.date.toISOString()).toBe(NOON_UTC);

    const listed = await request
      .get('/api/v1/purchases?from=2026-10-27&to=2026-10-27')
      .set('Authorization', auth(adminToken))
      .expect(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0]._id).toBe(String(created.body._id));

    const previousDay = await request
      .get('/api/v1/purchases?from=2026-10-26&to=2026-10-26')
      .set('Authorization', auth(adminToken))
      .expect(200);
    expect(previousDay.body).toHaveLength(0);
  });

  it('includes a noon-anchored expense when endDate is that same day', async () => {
    await Expense.create({
      amount: 300,
      category: 'supplies',
      date: new Date(NOON_UTC),
      description: 'Insumos',
      createdBy: 'admin'
    });

    const response = await request
      .get('/api/v1/expenses?startDate=2026-10-27&endDate=2026-10-27')
      .set('Authorization', auth(adminToken))
      .expect(200);

    expect(response.body.total).toBe(1);
    expect(response.body.expenses[0].description).toBe('Insumos');
  });

  it('anchors a date-only payment but leaves a real timestamp untouched', async () => {
    const customer = await createTestCustomer();
    const order = await request
      .post('/api/v1/orders')
      .set('Authorization', auth(adminToken))
      .send({
        customerId: customer._id,
        channel: 'phone',
        items: [{ productId: products['blanco-chico'], quantity: 10 }]
      })
      .expect(201);

    const orderId = order.body._id as string;

    const dateOnly = await request
      .post(`/api/v1/orders/${orderId}/payments`)
      .set('Authorization', auth(adminToken))
      .send({ amount: 50, method: 'cash', date: '2026-10-27' })
      .expect(201);

    const realInstant = await request
      .post(`/api/v1/orders/${orderId}/payments`)
      .set('Authorization', auth(adminToken))
      .send({ amount: 50, method: 'cash', date: '2026-10-27T15:45:30.000Z' })
      .expect(201);

    const anchored = await Payment.findById(dateOnly.body._id);
    expect(anchored!.date.toISOString()).toBe(NOON_UTC);

    const untouched = await Payment.findById(realInstant.body._id);
    expect(untouched!.date.toISOString()).toBe('2026-10-27T15:45:30.000Z');
  });

  it('buckets customer frequency by the ART calendar, not UTC', async () => {
    const customer = await createTestCustomer();

    const order = (orderDate: Date, orderNumber: string) =>
      Order.create({
        orderNumber,
        customerId: customer._id as Types.ObjectId,
        customerName: 'Cliente',
        channel: 'phone',
        items: [
          {
            productId: new Types.ObjectId(products['blanco-chico']),
            productName: 'Blanco',
            quantity: 1,
            unitPrice: 25,
            subtotal: 25
          }
        ],
        totalAmount: 25,
        status: 'delivered',
        paymentStatus: 'paid',
        paidAmount: 25,
        balance: 0,
        dueDate: null,
        orderDate
      });

    // 00:30 ART on the 1st → September in both ART and UTC.
    await order(new Date('2026-09-01T00:30:00-03:00'), 'ORD-FREQ-1');
    // 23:30 ART on Aug 31 → August locally, but September in UTC. This is the
    // regression that UTC-based buckets produce.
    await order(new Date('2026-08-31T23:30:00-03:00'), 'ORD-FREQ-2');

    const monthly = await request
      .get(`/api/v1/reports/customers/${customer._id}/frequency?period=monthly`)
      .set('Authorization', auth(adminToken))
      .expect(200);

    expect(monthly.body.periods).toEqual([
      { period: '2026-08', count: 1 },
      { period: '2026-09', count: 1 }
    ]);

    const weekly = await request
      .get(`/api/v1/reports/customers/${customer._id}/frequency?period=weekly`)
      .set('Authorization', auth(adminToken))
      .expect(200);

    // Both sales fall in ISO week 36 (Mon Aug 31 – Sun Sep 6).
    expect(weekly.body.periods).toEqual([{ period: '2026-W36', count: 2 }]);
  });
});
