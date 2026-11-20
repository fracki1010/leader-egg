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
  getProductIds
} from './helpers.js';
import { app } from '../app.js';
import { accountForMethod } from '../modules/payments/model.js';

const request = supertest(app);

describe('Payments Integration', () => {
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

  /**
   * Helper: create an order and return the response body.
   */
  const createOrder = async (quantity = 5): Promise<Record<string, unknown>> => {
    const customer = await createTestCustomer();
    const products = await getProductIds();

    const response = await request
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customer._id,
        channel: 'phone',
        items: [{ productId: products['blanco-chico'], quantity }]
      });

    return response.body as Record<string, unknown>;
  };

  describe('POST /api/v1/orders/:id/payments', () => {
    it('records a full cash payment', async () => {
      const order = await createOrder(5); // 5 * $25 = $125
      const orderId = order._id as string;

      const response = await request
        .post(`/api/v1/orders/${orderId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 125, method: 'cash' })
        .expect(201);

      expect(response.body.amount).toBe(125);
      expect(response.body.method).toBe('cash');

      // Verify order is now paid
      const orderResponse = await request
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(orderResponse.body.paymentStatus).toBe('paid');
      expect(orderResponse.body.balance).toBe(0);
      expect(orderResponse.body.paidAmount).toBe(125);
    });

    it('records a partial payment', async () => {
      const order = await createOrder(5); // 5 * $25 = $125
      const orderId = order._id as string;

      const response = await request
        .post(`/api/v1/orders/${orderId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 50, method: 'cash' })
        .expect(201);

      expect(response.body.amount).toBe(50);

      // Verify order is partial
      const orderResponse = await request
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(orderResponse.body.paymentStatus).toBe('partial');
      expect(orderResponse.body.balance).toBe(75);
      expect(orderResponse.body.paidAmount).toBe(50);
    });

    it('rejects overpayment', async () => {
      const order = await createOrder(2); // 2 * $25 = $50
      const orderId = order._id as string;

      const response = await request
        .post(`/api/v1/orders/${orderId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 60, method: 'cash' })
        .expect(400);

      expect(response.body.error).toMatch(/exceeds/i);
    });

    it('rejects payment on already paid order', async () => {
      const order = await createOrder(2); // 2 * $25 = $50
      const orderId = order._id as string;

      // Pay in full
      await request
        .post(`/api/v1/orders/${orderId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 50, method: 'cash' })
        .expect(201);

      // Try to pay again
      await request
        .post(`/api/v1/orders/${orderId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 10, method: 'cash' })
        .expect(409);
    });

    it('rejects payment on cancelled order', async () => {
      const order = await createOrder(1);
      const orderId = order._id as string;

      // Cancel the order
      await request
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled' })
        .expect(200);

      // Try to pay
      await request
        .post(`/api/v1/orders/${orderId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 25, method: 'cash' })
        .expect(409);
    });

    it('rejects non-positive amount', async () => {
      const order = await createOrder(1);
      const orderId = order._id as string;

      await request
        .post(`/api/v1/orders/${orderId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 0, method: 'cash' })
        .expect(400);
    });

    it('returns 404 for non-existent order', async () => {
      const fakeId = '507f1f77bcf86cd799439011';

      await request
        .post(`/api/v1/orders/${fakeId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 25, method: 'cash' })
        .expect(404);
    });

    it('records a transfer payment with reference', async () => {
      const order = await createOrder(2); // 2 * $25 = $50
      const orderId = order._id as string;

      const response = await request
        .post(`/api/v1/orders/${orderId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 50, method: 'transfer', reference: 'TRF-001' })
        .expect(201);

      expect(response.body.amount).toBe(50);
      expect(response.body.method).toBe('transfer');
      expect(response.body.reference).toBe('TRF-001');
    });

    it('records a check payment with reference', async () => {
      const order = await createOrder(2); // 2 * $25 = $50
      const orderId = order._id as string;

      const response = await request
        .post(`/api/v1/orders/${orderId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 50, method: 'check', reference: 'CH-4567' })
        .expect(201);

      expect(response.body.amount).toBe(50);
      expect(response.body.method).toBe('check');
      expect(response.body.reference).toBe('CH-4567');
    });

    it('records a transfer payment without reference (valid)', async () => {
      const order = await createOrder(2); // 2 * $25 = $50
      const orderId = order._id as string;

      const response = await request
        .post(`/api/v1/orders/${orderId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 50, method: 'transfer' })
        .expect(201);

      expect(response.body.amount).toBe(50);
      expect(response.body.method).toBe('transfer');
      expect(response.body.reference).toBeUndefined();
    });

    it('rejects invalid payment method', async () => {
      const order = await createOrder(1);
      const orderId = order._id as string;

      await request
        .post(`/api/v1/orders/${orderId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 25, method: 'crypto' })
        .expect(400);
    });
  });

  describe('Payment money account (cuentas-dinero R1)', () => {
    it('derives account from method when omitted (cash → cash)', async () => {
      const order = await createOrder(5); // $125
      const response = await request
        .post(`/api/v1/orders/${order._id}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 125, method: 'cash' })
        .expect(201);

      expect(response.body.account).toBe('cash');
    });

    it('derives account from method when omitted (transfer → mp)', async () => {
      const order = await createOrder(2); // $50
      const response = await request
        .post(`/api/v1/orders/${order._id}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 50, method: 'transfer' })
        .expect(201);

      expect(response.body.account).toBe('mp');
    });

    it('derives account from method when omitted (check → bank)', async () => {
      const order = await createOrder(2); // $50
      const response = await request
        .post(`/api/v1/orders/${order._id}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 50, method: 'check' })
        .expect(201);

      expect(response.body.account).toBe('bank');
    });

    it('accepts an explicit account override (transfer → bank)', async () => {
      const order = await createOrder(2); // $50
      const response = await request
        .post(`/api/v1/orders/${order._id}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 50, method: 'transfer', account: 'bank' })
        .expect(201);

      expect(response.body.account).toBe('bank');
      expect(response.body.method).toBe('transfer');
    });

    it('rejects an invalid account value', async () => {
      const order = await createOrder(1); // $25
      await request
        .post(`/api/v1/orders/${order._id}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 25, method: 'cash', account: 'bitcoin' })
        .expect(400);
    });
  });

  describe('accountForMethod (unit)', () => {
    it('maps cash/transfer/check to cash/mp/bank by default', () => {
      expect(accountForMethod('cash')).toBe('cash');
      expect(accountForMethod('transfer')).toBe('mp');
      expect(accountForMethod('check')).toBe('bank');
    });

    it('lets an explicit override win', () => {
      expect(accountForMethod('transfer', 'bank')).toBe('bank');
      expect(accountForMethod('cash', 'mp')).toBe('mp');
      expect(accountForMethod('check', 'mp')).toBe('mp');
    });

    it('treats a null override as "no override"', () => {
      expect(accountForMethod('check', null)).toBe('bank');
    });
  });

  describe('GET /api/v1/orders/:id/payments', () => {
    it('lists payments for an order', async () => {
      const order = await createOrder(4); // 4 * $25 = $100
      const orderId = order._id as string;

      // Record two partial payments
      await request
        .post(`/api/v1/orders/${orderId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 40, method: 'cash' });

      await request
        .post(`/api/v1/orders/${orderId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 30, method: 'cash' });

      const response = await request
        .get(`/api/v1/orders/${orderId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body[0].amount).toBe(30); // sorted by date desc
      expect(response.body[1].amount).toBe(40);
    });

    it('returns empty array for order with no payments', async () => {
      const order = await createOrder(1);
      const orderId = order._id as string;

      const response = await request
        .get(`/api/v1/orders/${orderId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveLength(0);
    });
  });

  describe('GET /api/v1/orders/:id/receipt', () => {
    it('generates a receipt with order and payment details', async () => {
      const order = await createOrder(3); // 3 * $25 = $75
      const orderId = order._id as string;

      // Record payment
      await request
        .post(`/api/v1/orders/${orderId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 75, method: 'cash' });

      const response = await request
        .get(`/api/v1/orders/${orderId}/receipt`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.orderNumber).toMatch(/^ORD-/);
      expect(response.body.customerName).toBe('Test Customer');
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].productName).toBe('Blanco Chico');
      expect(response.body.items[0].quantity).toBe(3);
      expect(response.body.items[0].unitPrice).toBe(25);
      expect(response.body.items[0].subtotal).toBe(75);
      expect(response.body.totalAmount).toBe(75);
      expect(response.body.paidAmount).toBe(75);
      expect(response.body.balance).toBe(0);
      expect(response.body.paymentStatus).toBe('paid');
      expect(response.body.payments).toHaveLength(1);
      expect(response.body.payments[0].amount).toBe(75);
      expect(response.body.payments[0].method).toBe('cash');
      expect(response.body.date).toBeDefined();
    });

    it('includes reference in receipt payments', async () => {
      const order = await createOrder(2); // 2 * $25 = $50
      const orderId = order._id as string;

      await request
        .post(`/api/v1/orders/${orderId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 50, method: 'transfer', reference: 'TRF-001' })
        .expect(201);

      const response = await request
        .get(`/api/v1/orders/${orderId}/receipt`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.payments).toHaveLength(1);
      expect(response.body.payments[0].method).toBe('transfer');
      expect(response.body.payments[0].reference).toBe('TRF-001');
    });

    it('returns 404 for non-existent order', async () => {
      const fakeId = '507f1f77bcf86cd799439011';

      await request
        .get(`/api/v1/orders/${fakeId}/receipt`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('Full order lifecycle', () => {
    it('create order → assign → deliver → pay → receipt', async () => {
      const customer = await createTestCustomer({ name: 'Lifecycle Customer' });
      const products = await getProductIds();

      // 1. Create order
      const orderRes = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'whatsapp',
          items: [
            { productId: products['blanco-chico'], quantity: 4 },
            { productId: products['blanco-grande'], quantity: 2 }
          ]
        })
        .expect(201);

      const orderId = orderRes.body._id;
      // 4 * $25 + 2 * $27 = $100 + $54 = $154
      expect(orderRes.body.totalAmount).toBe(154);
      expect(orderRes.body.status).toBe('pending');

      // 2. Assign
      await request
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'assigned' })
        .expect(200);

      // 3. In transit → Deliver
      await request
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'in_transit' })
        .expect(200);

      await request
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'delivered' })
        .expect(200);

      // 4. Record full payment
      await request
        .post(`/api/v1/orders/${orderId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 154, method: 'cash' })
        .expect(201);

      // 5. View receipt
      const receiptRes = await request
        .get(`/api/v1/orders/${orderId}/receipt`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(receiptRes.body.customerName).toBe('Lifecycle Customer');
      expect(receiptRes.body.totalAmount).toBe(154);
      expect(receiptRes.body.paymentStatus).toBe('paid');
      expect(receiptRes.body.items).toHaveLength(2);
    });
  });
});
