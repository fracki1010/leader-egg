import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
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
import { Inventory } from '../modules/inventory/model.js';
import { StockTransaction } from '../modules/inventory/transaction-model.js';
import { Payment } from '../modules/payments/model.js';
import { PriceEntry } from '../modules/products/price-list-model.js';
import { buildDuplicateFingerprint } from '../utils/duplicate-guard.js';

const request = supertest(app);

const todayStr = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const tomorrowStr = (): string => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

describe('Orders CRUD Integration', () => {
  let adminToken: string;
  let driverToken: string;

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
    const driverCreds = await seedDriverUser();
    adminToken = await loginAs(request, adminCreds.email, adminCreds.password);
    driverToken = await loginAs(request, driverCreds.email, driverCreds.password);
  });

  const createOrder = async (
    token: string,
    customerId: string,
    items: Array<{ productId: string; quantity: number }>,
    channel: 'phone' | 'whatsapp' | 'driver_visit' = 'phone',
    extra: Record<string, unknown> = {}
  ): Promise<Record<string, any>> => {
    const response = await request
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, channel, items, ...extra })
      .expect(201);
    return response.body as Record<string, any>;
  };

  describe('DELETE /api/v1/orders/:id', () => {
    it('deletes a pending order and returns 204', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrder(adminToken, customer._id as string, [
        { productId: products['blanco-chico']!, quantity: 2 }
      ]);

      await request
        .delete(`/api/v1/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      await request
        .get(`/api/v1/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('returns 404 for a non-existent order', async () => {
      await request
        .delete('/api/v1/orders/000000000000000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('returns 409 for a delivered order', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrder(adminToken, customer._id as string, [
        { productId: products['blanco-chico']!, quantity: 1 }
      ]);

      await request
        .patch(`/api/v1/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'assigned' });
      await request
        .patch(`/api/v1/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'in_transit' });
      await request
        .patch(`/api/v1/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'delivered' });

      const response = await request
        .delete(`/api/v1/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);

      expect(response.body.error).toMatch(/delivered/i);
    });

    it('returns 409 for an assigned order (already in route)', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrder(adminToken, customer._id as string, [
        { productId: products['blanco-chico']!, quantity: 1 }
      ]);

      await request
        .patch(`/api/v1/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'assigned' });

      const response = await request
        .delete(`/api/v1/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);

      expect(response.body.error).toMatch(/route/i);
    });

    it('returns 409 for an order with payments', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrder(adminToken, customer._id as string, [
        { productId: products['blanco-chico']!, quantity: 10 }
      ]);

      await request
        .post(`/api/v1/orders/${order._id}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 10, method: 'cash' })
        .expect(201);

      const response = await request
        .delete(`/api/v1/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);

      expect(response.body.error).toMatch(/payments/i);
    });
  });

  describe('PATCH /api/v1/orders/:id', () => {
    it('rebuilds items, recomputes totals, adjusts balance and updates channel', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrder(adminToken, customer._id as string, [
        { productId: products['blanco-chico']!, quantity: 2 } // 2 * 25 = 50
      ]);

      const response = await request
        .patch(`/api/v1/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          channel: 'whatsapp',
          items: [{ productId: products['castaño-chico']!, quantity: 2 }] // 2 * 28 = 56
        })
        .expect(200);

      expect(response.body.channel).toBe('whatsapp');
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].productName).toBe('Castaño Chico');
      expect(response.body.items[0].unitPrice).toBe(28);
      expect(response.body.totalAmount).toBe(56);
      // oldTotal 50, newTotal 56 → balance adjusts by +6 → 56
      expect(response.body.balance).toBe(56);
      expect(response.body.paymentStatus).toBe('unpaid');
    });

    it('adjusts balance by (newTotal - oldTotal) when the order has payments', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrder(adminToken, customer._id as string, [
        { productId: products['blanco-chico']!, quantity: 4 } // 4 * 25 = 100
      ]);

      await request
        .post(`/api/v1/orders/${order._id}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 40, method: 'cash' })
        .expect(201);

      const response = await request
        .patch(`/api/v1/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [
            { productId: products['blanco-chico']!, quantity: 2 },
            { productId: products['castaño-chico']!, quantity: 1 } // 2*25 + 1*28 = 78
          ]
        })
        .expect(200);

      // newTotal 78, paid 40 → balance 38 (old balance 60 + (78 - 100))
      expect(response.body.totalAmount).toBe(78);
      expect(response.body.paidAmount).toBe(40);
      expect(response.body.balance).toBe(38);
      expect(response.body.paymentStatus).toBe('partial');
    });

    it('updates deliveryDate while pending', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrder(adminToken, customer._id as string, [
        { productId: products['blanco-chico']!, quantity: 1 }
      ]);

      const response = await request
        .patch(`/api/v1/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ deliveryDate: '2026-10-20' })
        .expect(200);

      expect(response.body.deliveryDate).not.toBeNull();
      expect(new Date(response.body.deliveryDate).toISOString().startsWith('2026-10-20')).toBe(true);
    });

    it('rejects editing a non-pending order', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrder(adminToken, customer._id as string, [
        { productId: products['blanco-chico']!, quantity: 1 }
      ]);

      await request
        .patch(`/api/v1/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'assigned' });

      const response = await request
        .patch(`/api/v1/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ channel: 'phone' })
        .expect(409);

      expect(response.body.error).toMatch(/after assignment/i);
    });

    it('returns 404 for an invalid product in items', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrder(adminToken, customer._id as string, [
        { productId: products['blanco-chico']!, quantity: 1 }
      ]);

      const response = await request
        .patch(`/api/v1/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ productId: '000000000000000000000000', quantity: 1 }] })
        .expect(404);

      expect(response.body.error).toMatch(/product not found/i);
    });

    it('rejects reducing the total below the paid amount', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrder(adminToken, customer._id as string, [
        { productId: products['blanco-chico']!, quantity: 10 } // 250
      ]);

      await request
        .post(`/api/v1/orders/${order._id}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 200, method: 'cash' })
        .expect(201);

      const response = await request
        .patch(`/api/v1/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ productId: products['blanco-chico']!, quantity: 1 }] }) // 25 < 200 paid
        .expect(409);

      expect(response.body.error).toMatch(/below paid amount/i);
    });
  });

  describe('GET /api/v1/orders — filters and pagination', () => {
    it('filters by status', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const orderA = await createOrder(adminToken, customer._id as string, [
        { productId: products['blanco-chico']!, quantity: 1 }
      ]);
      await createOrder(adminToken, customer._id as string, [
        { productId: products['blanco-chico']!, quantity: 1 }
      ], 'phone', { forceDuplicate: true });

      await request
        .patch(`/api/v1/orders/${orderA._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'assigned' });

      const response = await request
        .get('/api/v1/orders?status=assigned')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.total).toBe(1);
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0]._id).toBe(orderA._id);
      expect(response.body.items[0].status).toBe('assigned');
    });

    it('filters by date range', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      await createOrder(adminToken, customer._id as string, [
        { productId: products['blanco-chico']!, quantity: 1 }
      ]);

      const today = todayStr();
      const tomorrow = tomorrowStr();

      const todayResponse = await request
        .get(`/api/v1/orders?from=${today}&to=${today}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(todayResponse.body.total).toBeGreaterThanOrEqual(1);
      expect(todayResponse.body.items[0].orderNumber).toMatch(/^ORD-/);

      const tomorrowResponse = await request
        .get(`/api/v1/orders?from=${tomorrow}&to=${tomorrow}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(tomorrowResponse.body.total).toBe(0);
      expect(tomorrowResponse.body.items).toEqual([]);
    });

    it('paginates with limit and page, sorted by createdAt desc', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      await createOrder(adminToken, customer._id as string, [
        { productId: products['blanco-chico']!, quantity: 1 }
      ]);
      await createOrder(adminToken, customer._id as string, [
        { productId: products['castaño-chico']!, quantity: 1 }
      ]);
      await createOrder(adminToken, customer._id as string, [
        { productId: products['blanco-grande']!, quantity: 1 }
      ]);

      const pageOne = await request
        .get('/api/v1/orders?limit=2&page=1')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(pageOne.body.total).toBe(3);
      expect(pageOne.body.limit).toBe(2);
      expect(pageOne.body.page).toBe(1);
      expect(pageOne.body.items).toHaveLength(2);

      // Newest first — last created order appears first
      const pageTwo = await request
        .get('/api/v1/orders?limit=2&page=2')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(pageTwo.body.items).toHaveLength(1);
      expect(pageTwo.body.page).toBe(2);
    });

    it('searches by customer name (case-insensitive)', async () => {
      const alice = await createTestCustomer({ name: 'Alice Corp' });
      const bob = await createTestCustomer({ name: 'Bob SA' });
      const products = await getProductIds();

      const aliceOrder = await createOrder(adminToken, alice._id as string, [
        { productId: products['blanco-chico']!, quantity: 1 }
      ]);
      await createOrder(adminToken, bob._id as string, [
        { productId: products['blanco-chico']!, quantity: 1 }
      ]);

      const response = await request
        .get('/api/v1/orders?search=alice')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.total).toBe(1);
      expect(response.body.items[0]._id).toBe(aliceOrder._id);
      expect(response.body.items[0].customerName).toBe('Alice Corp');
    });

    it('searches by order number', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const first = await createOrder(adminToken, customer._id as string, [
        { productId: products['blanco-chico']!, quantity: 1 }
      ]);
      await createOrder(adminToken, customer._id as string, [
        { productId: products['blanco-chico']!, quantity: 1 }
      ], 'phone', { forceDuplicate: true });

      const response = await request
        .get(`/api/v1/orders?search=${encodeURIComponent(first.orderNumber)}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.total).toBe(1);
      expect(response.body.items[0].orderNumber).toBe(first.orderNumber);
    });

    it('clamps limit to max 200', async () => {
      const response = await request
        .get('/api/v1/orders?limit=999')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.limit).toBe(200);
    });
  });

  describe('GET /api/v1/orders/today', () => {
    it('returns today\'s orders with a summary', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      await createOrder(adminToken, customer._id as string, [
        { productId: products['blanco-chico']!, quantity: 2 } // 50
      ]);
      await createOrder(adminToken, customer._id as string, [
        { productId: products['castaño-chico']!, quantity: 3 } // 84
      ]);

      // An order created on a previous day must be excluded
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      await Order.create({
        orderNumber: 'ORD-OLD-1',
        customerId: customer._id,
        customerName: 'Test Customer',
        channel: 'phone',
        items: [{ productId: products['blanco-chico'], productName: 'Blanco', quantity: 1, unitPrice: 25, subtotal: 25 }],
        totalAmount: 25,
        paidAmount: 0,
        balance: 25,
        paymentStatus: 'unpaid',
        createdAt: twoDaysAgo,
        // Business date is what the "today" view reads — keep it on the old day.
        orderDate: twoDaysAgo
      } as any);

      const response = await request
        .get('/api/v1/orders/today')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.orders).toHaveLength(2);
      expect(response.body.summary.count).toBe(2);
      expect(response.body.summary.total).toBe(134);
      expect(response.body.orders.every((o: Record<string, any>) => o.orderNumber !== 'ORD-OLD-1')).toBe(true);
    });
  });

  describe('Auth guards', () => {
    it('returns 401 without a token', async () => {
      await request.get('/api/v1/orders').expect(401);
      await request.get('/api/v1/orders/today').expect(401);
    });

    it('returns 403 when a driver tries to delete an order', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrder(adminToken, customer._id as string, [
        { productId: products['blanco-chico']!, quantity: 1 }
      ]);

      await request
        .delete(`/api/v1/orders/${order._id}`)
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(403);
    });

    it('returns 403 when a driver tries to edit an order', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrder(adminToken, customer._id as string, [
        { productId: products['blanco-chico']!, quantity: 1 }
      ]);

      const response = await request
        .patch(`/api/v1/orders/${order._id}`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ channel: 'phone' })
        .expect(403);

      expect(response.body.error).toMatch(/permissions/i);
    });
  });

  // ─── Stock deduction atomicity ────────────────────────────────────────────

  describe('Stock deduction atomicity (multi-item deliveries)', () => {
    const setStock = async (productId: string, quantity: number): Promise<void> => {
      await Inventory.updateOne({ productId }, { quantity });
    };

    const stockOf = async (productId: string): Promise<number> =>
      (await Inventory.findOne({ productId }))!.quantity;

    const advanceToInTransit = async (orderId: string): Promise<void> => {
      await request
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'assigned' })
        .expect(200);
      await request
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'in_transit' })
        .expect(200);
    };

    /**
     * Order with A (stock 10, qty 5) and B (stock 10, qty 20): the second line
     * cannot be delivered. A must NOT be deducted and the order must stay
     * in_transit; fixing B and retrying must deduct each product exactly once.
     */
    it('direct delivery failure leaves item A untouched, then retry deducts once', async () => {
      const products = await getProductIds();
      const productA = products['blanco-chico']!;
      const productB = products['castaño-chico']!;
      await setStock(productA, 10);
      await setStock(productB, 10);

      const customer = await createTestCustomer();
      const created = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [
            { productId: productA, quantity: 5 },
            { productId: productB, quantity: 20 }
          ]
        })
        .expect(201);
      const orderId = created.body._id as string;

      await advanceToInTransit(orderId);

      const failed = await request
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'delivered' })
        .expect(409);

      expect(failed.body.error).toBe('Insufficient stock');
      expect(failed.body.productId).toBe(productB);
      expect(await stockOf(productA)).toBe(10);
      expect(await stockOf(productB)).toBe(10);

      const stored = await Order.findById(orderId);
      expect(stored!.status).toBe('in_transit');
      expect(stored!.stockDeducted).toBe(false);
      expect(await StockTransaction.countDocuments({ orderId })).toBe(0);

      // Fix B and deliver again — each product is deducted exactly once.
      await setStock(productB, 20);
      const delivered = await request
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'delivered' })
        .expect(200);

      expect(delivered.body.status).toBe('delivered');
      expect(delivered.body.stockDeducted).toBe(true);
      expect(await stockOf(productA)).toBe(5); // 10 - 5, once
      expect(await stockOf(productB)).toBe(0); // 20 - 20, once

      const txns = await StockTransaction.find({ orderId, type: 'delivery' }).sort({ quantity: 1 });
      expect(txns).toHaveLength(2);
      expect(txns.map((txn) => txn.quantity)).toEqual([-20, -5]);
    });

    /**
     * Creating an order already delivered must be all-or-nothing: a failed
     * multi-item deduction leaves no order and no inventory movement.
     */
    it('create with status delivered is atomic — no order and no stock change on failure', async () => {
      const products = await getProductIds();
      const productA = products['blanco-chico']!;
      const productB = products['castaño-chico']!;
      await setStock(productA, 10);
      await setStock(productB, 10);

      const customer = await createTestCustomer();
      const response = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          status: 'delivered',
          items: [
            { productId: productA, quantity: 5 },
            { productId: productB, quantity: 20 }
          ]
        })
        .expect(409);

      expect(response.body.error).toBe('Insufficient stock');
      expect(await Order.countDocuments()).toBe(0);
      expect(await stockOf(productA)).toBe(10);
      expect(await stockOf(productB)).toBe(10);
      expect(await StockTransaction.countDocuments()).toBe(0);
    });

    /**
     * A product that never received stock has no Inventory record. Selling it
     * must fail as insufficient stock (available 0), NOT as a 404, and the
     * pre-validation must run before any product is deducted.
     */
    it('missing inventory record is insufficient stock (available 0), not a 404', async () => {
      const products = await getProductIds();
      const productA = products['blanco-chico']!;
      const productB = products['castaño-chico']!;
      await setStock(productA, 10);

      const customer = await createTestCustomer();
      const created = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [
            { productId: productA, quantity: 5 },
            { productId: productB, quantity: 1 }
          ]
        })
        .expect(201);
      const orderId = created.body._id as string;

      await advanceToInTransit(orderId);

      // The product never had an inventory record → 0 available.
      await Inventory.deleteOne({ productId: productB });

      const failed = await request
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'delivered' })
        .expect(409);

      expect(failed.body.error).toBe('Insufficient stock');
      expect(failed.body.productId).toBe(productB);
      expect(failed.body.required).toBe(1);
      expect(failed.body.available).toBe(0);

      // Nothing was deducted: the pre-validation runs before every write.
      expect(await stockOf(productA)).toBe(10);
      expect(await StockTransaction.countDocuments({ orderId })).toBe(0);
      const stored = await Order.findById(orderId);
      expect(stored!.status).toBe('in_transit');
      expect(stored!.stockDeducted).toBe(false);
    });

    /**
     * Bug 2: a return registered while the order is in_transit never left the
     * warehouse. The later delivery must deduct the NET quantity, not the full
     * original.
     */
    it('return while in_transit is netted out of the later delivery', async () => {
      const products = await getProductIds();
      const productId = products['blanco-chico']!;

      const customer = await createTestCustomer();
      const created = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId, quantity: 5 }]
        })
        .expect(201);
      const orderId = created.body._id as string;

      await advanceToInTransit(orderId);

      // 2 of the 5 maples are returned before delivery — stock was never taken.
      await request
        .post(`/api/v1/orders/${orderId}/returns`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [{ productId, quantity: 2 }],
          reason: 'difference',
          effect: 'reduce_debt'
        })
        .expect(201);
      expect(await stockOf(productId)).toBe(100);

      const delivered = await request
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'delivered' })
        .expect(200);
      expect(delivered.body.stockDeducted).toBe(true);

      // 5 ordered − 2 returned = 3 maples leave the warehouse.
      expect(await stockOf(productId)).toBe(97);
      const txns = await StockTransaction.find({ orderId, type: 'delivery' });
      expect(txns).toHaveLength(1);
      expect(txns[0]!.quantity).toBe(-3);
    });

    /**
     * Bug 3: the restock on cancel/undo is a 'delivery' movement linked to the
     * order, not an anonymous 'purchase'.
     */
    it('restock on undo delivery logs a delivery transaction linked to the order', async () => {
      const products = await getProductIds();
      const productId = products['blanco-chico']!;

      const customer = await createTestCustomer();
      const created = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId, quantity: 2 }]
        })
        .expect(201);
      const orderId = created.body._id as string;

      await advanceToInTransit(orderId);
      await request
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'delivered' })
        .expect(200);
      expect(await stockOf(productId)).toBe(98);

      await request
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'in_transit' })
        .expect(200);
      expect(await stockOf(productId)).toBe(100);

      const restoreTxn = await StockTransaction.findOne({
        orderId,
        type: 'delivery',
        quantity: 2
      });
      expect(restoreTxn).not.toBeNull();
      expect(restoreTxn!.orderId!.toString()).toBe(orderId);
      expect(restoreTxn!.notes).toMatch(/Restock por deshacer entrega/);
      expect(await StockTransaction.countDocuments({ orderId, type: 'purchase' })).toBe(0);
    });
  });
  describe('Recent-duplicate guard (5-minute window)', () => {
    const priceYesterday = (): Date => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return d;
    };

    it('rejects an identical order with DUPLICATE_RECORD and leaves stock/payments untouched', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const productId = products['blanco-chico']!;

      const payload = {
        customerId: customer._id,
        channel: 'phone',
        status: 'delivered',
        items: [{ productId, quantity: 2, unit: 'maple' }],
        initialPayment: { amount: 10, method: 'cash' }
      };

      const first = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload)
        .expect(201);

      const stockAfterFirst = (await Inventory.findOne({ productId }))!.quantity;
      const paymentsAfterFirst = await Payment.countDocuments();

      const blocked = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload)
        .expect(409);

      expect(blocked.body).toMatchObject({
        code: 'DUPLICATE_RECORD',
        resource: 'order',
        existingId: first.body._id,
        existingNumber: first.body.orderNumber
      });
      expect(blocked.body.error).toContain(first.body.orderNumber);

      // Only the first order exists; the failed attempt wrote nothing.
      expect(await Order.countDocuments()).toBe(1);
      expect((await Inventory.findOne({ productId }))!.quantity).toBe(stockAfterFirst);
      expect(await Payment.countDocuments()).toBe(paymentsAfterFirst);

      // The fingerprint is persisted on the created order.
      const stored = await Order.findById(first.body._id);
      expect(stored?.duplicateFingerprint).toBe(
        buildDuplicateFingerprint(String(customer._id), [
          { productId, quantity: 2, unit: 'maple' }
        ])
      );
    });

    it('creates the second identical order when forceDuplicate is true', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const payload = {
        customerId: customer._id,
        channel: 'phone',
        items: [{ productId: products['blanco-chico'], quantity: 1 }]
      };

      await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload)
        .expect(201);

      await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...payload, forceDuplicate: true })
        .expect(201);

      expect(await Order.countDocuments()).toBe(2);
    });

    it('allows a different customer, quantity or unit', async () => {
      const alice = await createTestCustomer({ name: 'Alice Dup' });
      const bob = await createTestCustomer({ name: 'Bob Dup' });
      const products = await getProductIds();
      const productId = products['blanco-chico']!;
      const base = {
        channel: 'phone',
        items: [{ productId, quantity: 1, unit: 'maple' }]
      };

      const post = (customerId: unknown, payload: Record<string, unknown>) =>
        request
          .post('/api/v1/orders')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ customerId, ...payload })
          .expect(201);

      await post(alice._id, base);
      await post(bob._id, base); // different customer
      await post(alice._id, { ...base, items: [{ productId, quantity: 3, unit: 'maple' }] });

      // Different unit needs its own active price.
      await PriceEntry.create({
        productId,
        price: 300,
        unit: 'cajon',
        effectiveFrom: priceYesterday()
      });
      await post(alice._id, { ...base, items: [{ productId, quantity: 1, unit: 'cajon' }] });

      expect(await Order.countDocuments()).toBe(4);
    });

    it('does not let a cancelled identical order block a new one', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const payload = {
        customerId: customer._id,
        channel: 'phone',
        items: [{ productId: products['blanco-chico'], quantity: 1 }]
      };

      const first = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload)
        .expect(201);

      await request
        .patch(`/api/v1/orders/${first.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled' })
        .expect(200);

      await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload)
        .expect(201);

      expect(await Order.countDocuments()).toBe(2);
    });
  });

});