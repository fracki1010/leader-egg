import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  seedProducts,
  loginAs,
  createTestCustomer,
  createCreditCustomer,
  getProductIds
} from './helpers.js';
import { app } from '../app.js';
import { Payment } from '../modules/payments/model.js';
import { Order } from '../modules/orders/model.js';
import { Inventory } from '../modules/inventory/model.js';

const request = supertest(app);

describe('Order payment preferences', () => {
  let adminToken: string;

  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
    await seedProducts();
    const adminCreds = await seedAdminUser();
    adminToken = await loginAs(request, adminCreds.email, adminCreds.password);
  });

  const createOrder = async (
    customerId: string,
    extra: Record<string, unknown> = {}
  ): Promise<Record<string, any>> => {
    const products = await getProductIds();
    const response = await request
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        channel: 'phone',
        items: [{ productId: products['blanco-chico'], quantity: 4 }], // 4 × $25 = $100
        ...extra
      });
    return response.body as Record<string, any>;
  };

  describe('POST /api/v1/orders — paymentPreference', () => {
    it('defaults to cash when paymentPreference is omitted (backward compatible)', async () => {
      const customer = await createTestCustomer();
      const order = await createOrder(customer._id as string);

      expect(order.paymentPreference).toBe('cash');
      expect(order.paymentStatus).toBe('unpaid');
      expect(order.paidAmount).toBe(0);
      expect(order.balance).toBe(100);
    });

    it('persists an explicit cash preference as unpaid (paid at delivery)', async () => {
      const customer = await createTestCustomer();
      const order = await createOrder(customer._id as string, { paymentPreference: 'cash' });

      expect(order.paymentPreference).toBe('cash');
      expect(order.paymentStatus).toBe('unpaid');
      expect(order.balance).toBe(100);
    });

    it('transfer preference stays unpaid (paid at delivery)', async () => {
      const customer = await createTestCustomer();
      const order = await createOrder(customer._id as string, { paymentPreference: 'transfer' });

      expect(order.paymentPreference).toBe('transfer');
      expect(order.paymentStatus).toBe('unpaid');
      expect(order.balance).toBe(100);
    });

    it('credit preference stays unpaid and keeps the credit dueDate', async () => {
      const customer = await createCreditCustomer(500, 15);
      const order = await createOrder(customer._id as string, { paymentPreference: 'credit' });

      expect(order.paymentPreference).toBe('credit');
      expect(order.paymentStatus).toBe('unpaid');
      expect(order.paidAmount).toBe(0);
      expect(order.balance).toBe(100);
      expect(order.dueDate).not.toBeNull();
    });

    it('cod preference stays unpaid with the full balance (pays next delivery)', async () => {
      const customer = await createTestCustomer();
      const order = await createOrder(customer._id as string, { paymentPreference: 'cod' });

      expect(order.paymentPreference).toBe('cod');
      expect(order.paymentStatus).toBe('unpaid');
      expect(order.paidAmount).toBe(0);
      expect(order.balance).toBe(100);
    });

    it('partial preference with initialPayment creates a REAL payment doc and marks partial', async () => {
      const customer = await createTestCustomer();
      const order = await createOrder(customer._id as string, {
        paymentPreference: 'partial',
        initialPayment: { amount: 40, method: 'cash' }
      });

      expect(order.paymentPreference).toBe('partial');
      expect(order.paymentStatus).toBe('partial');
      expect(order.paidAmount).toBe(40);
      expect(order.balance).toBe(60);

      // The upfront payment is a real Payment doc in the order's payment history
      const payment = await Payment.findOne({ orderId: order._id });
      expect(payment).not.toBeNull();
      expect(payment!.amount).toBe(40);
      expect(payment!.method).toBe('cash');

      const history = await request
        .get(`/api/v1/orders/${order._id}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(history.body).toHaveLength(1);
      expect(history.body[0].amount).toBe(40);
    });

    it('derives the initial payment account from its method when not sent', async () => {
      const customer = await createTestCustomer();
      const order = await createOrder(customer._id as string, {
        paymentPreference: 'partial',
        initialPayment: { amount: 40, method: 'transfer' }
      });

      const payment = await Payment.findOne({ orderId: order._id });
      expect(payment).not.toBeNull();
      expect(payment!.method).toBe('transfer');
      expect(payment!.account).toBe('mp');
    });

    it('accepts an explicit account override on the initial payment', async () => {
      const customer = await createTestCustomer();
      const order = await createOrder(customer._id as string, {
        paymentPreference: 'partial',
        initialPayment: { amount: 40, method: 'transfer', account: 'bank' }
      });

      const payment = await Payment.findOne({ orderId: order._id });
      expect(payment).not.toBeNull();
      expect(payment!.method).toBe('transfer');
      expect(payment!.account).toBe('bank');
    });

    it('rejects an initialPayment with an invalid account', async () => {
      const customer = await createTestCustomer();
      const response = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: (await getProductIds())['blanco-chico'], quantity: 1 }],
          paymentPreference: 'partial',
          initialPayment: { amount: 10, method: 'cash', account: 'credit_card' }
        })
        .expect(400);

      expect(response.body.error).toMatch(/enum|invalid/i);
    });

    it('marks the order paid when the initialPayment equals the total', async () => {
      const customer = await createTestCustomer();
      const order = await createOrder(customer._id as string, {
        paymentPreference: 'partial',
        initialPayment: { amount: 100, method: 'transfer' }
      });

      expect(order.paymentStatus).toBe('paid');
      expect(order.paidAmount).toBe(100);
      expect(order.balance).toBe(0);
    });

    it('rejects an initialPayment that exceeds the order total', async () => {
      const customer = await createTestCustomer();
      const response = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: (await getProductIds())['blanco-chico'], quantity: 1 }], // $25
          paymentPreference: 'partial',
          initialPayment: { amount: 30, method: 'cash' }
        })
        .expect(400);

      expect(response.body.error).toMatch(/exceed/i);
    });

    it('rejects an initialPayment with an invalid method', async () => {
      const customer = await createTestCustomer();
      const response = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: (await getProductIds())['blanco-chico'], quantity: 1 }],
          paymentPreference: 'partial',
          initialPayment: { amount: 10, method: 'bitcoin' }
        })
        .expect(400);

      expect(response.body.error).toMatch(/method|enum|invalid/i);
    });

    it('rejects an invalid paymentPreference value', async () => {
      const customer = await createTestCustomer();
      const response = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: (await getProductIds())['blanco-chico'], quantity: 1 }],
          paymentPreference: 'bitcoin'
        })
        .expect(400);

      expect(response.body.error).toMatch(/enum|invalid/i);
    });
  });

  describe('POST /api/v1/orders — split initialPayments', () => {
    it('creates one Payment per line with the correct financials', async () => {
      const customer = await createTestCustomer();
      const order = await createOrder(customer._id as string, {
        paymentPreference: 'partial',
        initialPayments: [
          { amount: 30, method: 'cash' },
          { amount: 20, method: 'transfer' }
        ]
      });

      expect(order.paymentStatus).toBe('partial');
      expect(order.paidAmount).toBe(50);
      expect(order.balance).toBe(50);

      const payments = await Payment.find({ orderId: order._id }).sort({ amount: -1 });
      expect(payments).toHaveLength(2);
      expect(payments[0]!.amount).toBe(30);
      expect(payments[0]!.method).toBe('cash');
      expect(payments[0]!.account).toBe('cash');
      expect(payments[1]!.amount).toBe(20);
      expect(payments[1]!.method).toBe('transfer');
      expect(payments[1]!.account).toBe('mp');

      const history = await request
        .get(`/api/v1/orders/${order._id}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(history.body).toHaveLength(2);
    });

    it('honors an explicit account override per split line', async () => {
      const customer = await createTestCustomer();
      const order = await createOrder(customer._id as string, {
        paymentPreference: 'partial',
        initialPayments: [
          { amount: 30, method: 'transfer', account: 'bank' },
          { amount: 20, method: 'cash' }
        ]
      });

      const bankPayment = await Payment.findOne({ orderId: order._id, amount: 30 });
      expect(bankPayment).not.toBeNull();
      expect(bankPayment!.account).toBe('bank');
    });

    it('marks the order paid when the split sum equals the total', async () => {
      const customer = await createTestCustomer();
      const order = await createOrder(customer._id as string, {
        paymentPreference: 'partial',
        initialPayments: [
          { amount: 60, method: 'cash' },
          { amount: 40, method: 'transfer' }
        ]
      });

      expect(order.paymentStatus).toBe('paid');
      expect(order.paidAmount).toBe(100);
      expect(order.balance).toBe(0);
    });

    it('rejects a split sum exceeding the total and creates no order or payment', async () => {
      const customer = await createTestCustomer();
      const response = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: (await getProductIds())['blanco-chico'], quantity: 1 }], // $25
          paymentPreference: 'partial',
          initialPayments: [
            { amount: 20, method: 'cash' },
            { amount: 10, method: 'transfer' }
          ]
        })
        .expect(400);

      expect(response.body.error).toMatch(/exceed/i);
      expect(await Order.countDocuments()).toBe(0);
      expect(await Payment.countDocuments()).toBe(0);
    });

    it('still accepts the legacy single initialPayment (back-compat)', async () => {
      const customer = await createTestCustomer();
      const order = await createOrder(customer._id as string, {
        paymentPreference: 'partial',
        initialPayment: { amount: 40, method: 'cash' }
      });

      expect(order.paymentStatus).toBe('partial');
      expect(order.paidAmount).toBe(40);
      expect(order.balance).toBe(60);
      expect(await Payment.countDocuments({ orderId: order._id })).toBe(1);
    });

    it('creates an unpaid order with no payments when none is sent', async () => {
      const customer = await createTestCustomer();
      const order = await createOrder(customer._id as string);

      expect(order.paymentStatus).toBe('unpaid');
      expect(order.paidAmount).toBe(0);
      expect(await Payment.countDocuments({ orderId: order._id })).toBe(0);
    });

    it('does not touch inventory at creation (stock leaves at delivery)', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const productId = products['blanco-chico'];

      const before = await Inventory.findOne({ productId });
      expect(before).not.toBeNull();
      const stockBefore = before!.quantity;

      const order = await createOrder(customer._id as string, {
        paymentPreference: 'partial',
        initialPayments: [{ amount: 40, method: 'cash' }]
      });
      expect(order._id).toBeDefined();

      const after = await Inventory.findOne({ productId });
      expect(after!.quantity).toBe(stockBefore);
    });
  });

  describe('PATCH /api/v1/orders/:id — paymentPreference', () => {
    it('changes paymentPreference while the order is pending', async () => {
      const customer = await createTestCustomer();
      const order = await createOrder(customer._id as string); // default cash

      const response = await request
        .patch(`/api/v1/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ paymentPreference: 'cod' })
        .expect(200);

      expect(response.body.paymentPreference).toBe('cod');
      // Unpaid preference keeps the financials untouched
      expect(response.body.paymentStatus).toBe('unpaid');
      expect(response.body.balance).toBe(100);
    });

    it('still changes paymentPreference on an order with an upfront payment', async () => {
      const customer = await createTestCustomer();
      const order = await createOrder(customer._id as string, {
        paymentPreference: 'partial',
        initialPayment: { amount: 40, method: 'cash' }
      });

      const response = await request
        .patch(`/api/v1/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ paymentPreference: 'credit' })
        .expect(200);

      expect(response.body.paymentPreference).toBe('credit');
      expect(response.body.paymentStatus).toBe('partial');
      expect(response.body.paidAmount).toBe(40);
      expect(response.body.balance).toBe(60);
    });
  });
});