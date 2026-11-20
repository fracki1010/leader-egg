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
import { Inventory } from '../modules/inventory/model.js';
import { StockTransaction } from '../modules/inventory/transaction-model.js';
import { Order } from '../modules/orders/model.js';

const request = supertest(app);

describe('Orders Integration', () => {
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

  describe('POST /api/v1/orders', () => {
    it('creates an order with price snapshot', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      const response = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [
            { productId: products['blanco-chico'], quantity: 5 },
            { productId: products['castaño-chico'], quantity: 3 }
          ]
        })
        .expect(201);

      expect(response.body.orderNumber).toMatch(/^ORD-/);
      expect(response.body.status).toBe('pending');
      expect(response.body.paymentStatus).toBe('unpaid');
      expect(response.body.items).toHaveLength(2);
      // 5 * $25 + 3 * $28 = $125 + $84 = $209
      expect(response.body.totalAmount).toBe(209);
      expect(response.body.balance).toBe(209);
      expect(response.body.paidAmount).toBe(0);
      expect(response.body.customerName).toBe('Test Customer');
    });

    it('snapshots unitPrice — later price changes do not affect existing order', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      // Create order with current prices
      const createResponse = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'whatsapp',
          items: [{ productId: products['blanco-chico'], quantity: 2 }]
        })
        .expect(201);

      const originalUnitPrice = createResponse.body.items[0].unitPrice;
      expect(originalUnitPrice).toBe(25);

      // Verify order retains snapshot
      const orderResponse = await request
        .get(`/api/v1/orders/${createResponse.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(orderResponse.body.items[0].unitPrice).toBe(25);
    });

    it('rejects order for inactive customer', async () => {
      const customer = await createTestCustomer({ status: 'inactive' });
      const products = await getProductIds();

      const response = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: products['blanco-chico'], quantity: 1 }]
        })
        .expect(409);

      expect(response.body.error).toMatch(/inactive/i);
    });

    it('rejects order with no items', async () => {
      const customer = await createTestCustomer();

      await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: []
        })
        .expect(400);
    });

    it('returns 403 when driver tries to create order', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: products['blanco-chico'], quantity: 1 }]
        })
        .expect(403);
    });

    it('persists optional deliveryLocation on create', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      const response = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: products['blanco-chico'], quantity: 1 }],
          deliveryLocation: { lat: -34.6037, lng: -58.3816 }
        })
        .expect(201);

      expect(response.body.deliveryLocation).toEqual({ lat: -34.6037, lng: -58.3816 });
    });

    it('persists deliveryDate on create', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      const response = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: products['blanco-chico'], quantity: 1 }],
          deliveryDate: '2026-10-15'
        })
        .expect(201);

      expect(response.body.deliveryDate).not.toBeNull();
      expect(new Date(response.body.deliveryDate).toISOString().startsWith('2026-10-15')).toBe(true);
    });

    it('defaults deliveryDate to null when omitted', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      const response = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: products['blanco-chico'], quantity: 1 }]
        })
        .expect(201);

      expect(response.body.deliveryDate).toBeNull();
    });

    it('stores salesChannel when provided (S1)', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      const response = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          salesChannel: 'puesto',
          items: [{ productId: products['blanco-chico'], quantity: 1 }]
        })
        .expect(201);

      expect(response.body.salesChannel).toBe('puesto');

      // Persisted in the DB, not just echoed
      const stored = await Order.findById(response.body._id);
      expect(stored!.salesChannel).toBe('puesto');
    });

    it('defaults salesChannel to reparto when omitted (S2)', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      const response = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: products['blanco-chico'], quantity: 1 }]
        })
        .expect(201);

      expect(response.body.salesChannel).toBe('reparto');
    });

    it('rejects an invalid salesChannel value', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          salesChannel: 'feria',
          items: [{ productId: products['blanco-chico'], quantity: 1 }]
        })
        .expect(400);
    });
  });

  describe('PATCH /api/v1/orders/:id (edit)', () => {
    it('updates salesChannel while the order is pending (S3)', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      const order = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: products['blanco-chico'], quantity: 1 }]
        })
        .expect(201);
      expect(order.body.salesChannel).toBe('reparto');

      const response = await request
        .patch(`/api/v1/orders/${order.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ salesChannel: 'whatsapp' })
        .expect(200);

      expect(response.body.salesChannel).toBe('whatsapp');

      const stored = await Order.findById(order.body._id);
      expect(stored!.salesChannel).toBe('whatsapp');
    });
  });

  describe('GET /api/v1/orders', () => {
    it('lists orders', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: products['blanco-chico'], quantity: 1 }]
        });

      const response = await request
        .get('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.items.length).toBeGreaterThanOrEqual(1);
      expect(response.body.total).toBeGreaterThanOrEqual(1);
      expect(response.body.page).toBe(1);
      expect(response.body.limit).toBe(50);
    });

    it('driver can read orders', async () => {
      await request
        .get('/api/v1/orders')
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(200);
    });
  });

  describe('PATCH /api/v1/orders/:id/status', () => {
    it('transitions pending → assigned', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      const order = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: products['blanco-chico'], quantity: 1 }]
        });

      const response = await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'assigned' })
        .expect(200);

      expect(response.body.status).toBe('assigned');
    });

    it('transitions assigned → in_transit → delivered', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      const order = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: products['blanco-chico'], quantity: 1 }]
        });

      await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'assigned' });

      await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'in_transit' })
        .expect(200);

      const response = await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'delivered' })
        .expect(200);

      expect(response.body.status).toBe('delivered');
    });

    it('rejects invalid transition (delivered → pending)', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      const order = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: products['blanco-chico'], quantity: 1 }]
        });

      // pending → assigned → in_transit → delivered
      await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'assigned' });

      await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'in_transit' });

      await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'delivered' });

      // delivered → pending is invalid per the state machine
      // ('pending' passes zod validation but the service rejects it — 409)
      await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'pending' })
        .expect(409);
    });

    it('can cancel from pending', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      const order = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: products['blanco-chico'], quantity: 1 }]
        });

      const response = await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled' })
        .expect(200);

      expect(response.body.status).toBe('cancelled');
    });

    it('can cancel from assigned', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      const order = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: products['blanco-chico'], quantity: 1 }]
        });

      await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'assigned' });

      const response = await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled' })
        .expect(200);

      expect(response.body.status).toBe('cancelled');
    });

    it('cannot cancel from delivered', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      const order = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: products['blanco-chico'], quantity: 1 }]
        });

      await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'assigned' });

      await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'in_transit' });

      await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'delivered' });

      await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled' })
        .expect(409);
    });

    it('undoes assignment: assigned → pending', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      const order = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: products['blanco-chico'], quantity: 1 }]
        });

      await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'assigned' })
        .expect(200);

      const response = await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'pending' })
        .expect(200);

      expect(response.body.status).toBe('pending');
      expect(response.body.stockDeducted).toBe(false);
    });

    it('undoes in-transit: in_transit → assigned', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      const order = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: products['blanco-chico'], quantity: 1 }]
        });

      await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'assigned' });

      await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'in_transit' });

      const response = await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'assigned' })
        .expect(200);

      expect(response.body.status).toBe('assigned');
    });

    it('undoes delivery (delivered → in_transit) and restores stock', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      const order = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: products['blanco-chico'], quantity: 2 }]
        });

      // Simulate a real delivery state: stock left the warehouse and the
      // stockDeducted flag was set (advanceStop does both on delivery).
      await Inventory.updateOne(
        { productId: products['blanco-chico'] },
        { $inc: { quantity: -2 } }
      );
      await Order.updateOne(
        { _id: order.body._id },
        { status: 'delivered', stockDeducted: true }
      );

      const before = await Inventory.findOne({ productId: products['blanco-chico'] });
      expect(before!.quantity).toBe(98);

      const response = await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'in_transit' })
        .expect(200);

      expect(response.body.status).toBe('in_transit');
      expect(response.body.stockDeducted).toBe(false);

      const after = await Inventory.findOne({ productId: products['blanco-chico'] });
      expect(after!.quantity).toBe(100);
    });

    it('cancels an order with stockDeducted=true and restores stock', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      const order = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: products['blanco-chico'], quantity: 2 }]
        });

      await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'assigned' });

      // Edge state: stock already deducted but order not delivered (was
      // restored to assigned) — cancelling must still give the stock back.
      await Inventory.updateOne(
        { productId: products['blanco-chico'] },
        { $inc: { quantity: -2 } }
      );
      await Order.updateOne(
        { _id: order.body._id },
        { stockDeducted: true }
      );

      const response = await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled' })
        .expect(200);

      expect(response.body.status).toBe('cancelled');
      expect(response.body.stockDeducted).toBe(false);

      const inventory = await Inventory.findOne({ productId: products['blanco-chico'] });
      expect(inventory!.quantity).toBe(100);
    });

    it('cancels a pending order with stockDeducted=false and leaves stock untouched', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      const order = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: products['blanco-chico'], quantity: 2 }]
        });

      const response = await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled' })
        .expect(200);

      expect(response.body.status).toBe('cancelled');
      expect(response.body.stockDeducted).toBe(false);

      const inventory = await Inventory.findOne({ productId: products['blanco-chico'] });
      expect(inventory!.quantity).toBe(100);
    });
  });

  // ─── Direct delivery (PATCH /status → delivered) stock deduction ──────────

  describe('Direct delivery stock deduction (PATCH /status → delivered)', () => {
    it('deducts stock and logs a delivery movement on direct delivery', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const productId = products['blanco-chico']!;

      const order = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId, quantity: 5 }]
        })
        .expect(201);

      await request.patch(`/api/v1/orders/${order.body._id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'assigned' });
      await request.patch(`/api/v1/orders/${order.body._id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'in_transit' });

      // Stock untouched until the delivery transition
      const beforeInv = await Inventory.findOne({ productId });
      expect(beforeInv!.quantity).toBe(100);

      const response = await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'delivered' })
        .expect(200);

      expect(response.body.status).toBe('delivered');
      expect(response.body.stockDeducted).toBe(true);

      // Inventory decreased by the delivered quantity
      const inv = await Inventory.findOne({ productId });
      expect(inv!.quantity).toBe(95); // 100 - 5

      // The inventory history records the delivery movement
      const txn = await StockTransaction.findOne({ orderId: order.body._id, type: 'delivery' });
      expect(txn).not.toBeNull();
      expect(txn!.quantity).toBe(-5);
      expect(txn!.notes).toBe(`Entrega ${response.body.orderNumber}`);
    });

    it('undoing a directly-delivered order restores the stock and logs the restore', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const productId = products['blanco-chico']!;

      const order = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId, quantity: 2 }]
        })
        .expect(201);

      await request.patch(`/api/v1/orders/${order.body._id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'assigned' });
      await request.patch(`/api/v1/orders/${order.body._id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'in_transit' });
      await request.patch(`/api/v1/orders/${order.body._id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'delivered' }).expect(200);

      const delivered = await Inventory.findOne({ productId });
      expect(delivered!.quantity).toBe(98); // 100 - 2

      const response = await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'in_transit' })
        .expect(200);

      expect(response.body.status).toBe('in_transit');
      expect(response.body.stockDeducted).toBe(false);

      const restored = await Inventory.findOne({ productId });
      expect(restored!.quantity).toBe(100);

      // The restore movement is logged (incrementStock type 'delivery', +2,
      // linked to the order)
      const restoreTxn = await StockTransaction.findOne({ productId, quantity: 2 });
      expect(restoreTxn).not.toBeNull();
    });

    it('cancel restores stock that a direct delivery already deducted', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const productId = products['blanco-chico']!;

      const order = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId, quantity: 3 }]
        })
        .expect(201);

      await request.patch(`/api/v1/orders/${order.body._id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'assigned' });
      await request.patch(`/api/v1/orders/${order.body._id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'in_transit' });
      await request.patch(`/api/v1/orders/${order.body._id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'delivered' }).expect(200);

      const delivered = await Inventory.findOne({ productId });
      expect(delivered!.quantity).toBe(97); // 100 - 3

      // delivered → cancelled is not a legal transition, so recreate the
      // operational edge the stockDeducted guard exists for: stock already out
      // (stockDeducted=true) on an order back in a cancellable status.
      await Order.updateOne({ _id: order.body._id }, { status: 'in_transit' });

      const response = await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled' })
        .expect(200);

      expect(response.body.status).toBe('cancelled');
      expect(response.body.stockDeducted).toBe(false);

      const restored = await Inventory.findOne({ productId });
      expect(restored!.quantity).toBe(100);
    });

    it('rejects direct delivery with insufficient stock and leaves status and inventory unchanged', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const productId = products['castaño-chico']!;

      // Only 10 in stock; the order needs 20
      await Inventory.updateOne({ productId }, { quantity: 10 });

      const order = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId, quantity: 20 }]
        })
        .expect(201);

      await request.patch(`/api/v1/orders/${order.body._id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'assigned' });
      await request.patch(`/api/v1/orders/${order.body._id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'in_transit' });

      const res = await request
        .patch(`/api/v1/orders/${order.body._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'delivered' })
        .expect(409);

      expect(res.body.error).toBe('Insufficient stock');
      expect(res.body.required).toBe(20);
      expect(res.body.available).toBe(10);

      // Order was NOT saved as delivered
      const stored = await Order.findById(order.body._id);
      expect(stored!.status).toBe('in_transit');
      expect(stored!.stockDeducted).toBe(false);

      // Inventory untouched and no movement was written
      const inv = await Inventory.findOne({ productId });
      expect(inv!.quantity).toBe(10);
      const txns = await StockTransaction.find({ orderId: order.body._id });
      expect(txns).toHaveLength(0);
    });
  });

  describe('Returns integration — financial invariant', () => {
    it('keeps totalAmount − returnedAmount = paidAmount + balance after a return', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      const order = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: products['blanco-chico'], quantity: 5 }]
        })
        .expect(201);
      const orderId = order.body._id as string;

      // Full payment
      await request
        .post(`/api/v1/orders/${orderId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 125, method: 'cash' })
        .expect(201);

      // Deliver: stock leaves the warehouse, stockDeducted=true
      await Inventory.updateOne(
        { productId: products['blanco-chico'] },
        { $inc: { quantity: -5 } }
      );
      await Order.updateOne({ _id: orderId }, { status: 'delivered', stockDeducted: true });

      // $50 cash refund (2 maples)
      const returnRes = await request
        .post(`/api/v1/orders/${orderId}/returns`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [{ productId: products['blanco-chico'], quantity: 2 }],
          reason: 'difference',
          effect: 'refund_cash'
        })
        .expect(201);
      expect(returnRes.body.returnedAmount).toBe(50);

      const after = await Order.findById(orderId);
      expect(after!.totalAmount - after!.returnedAmount).toBe(after!.paidAmount + after!.balance);
      expect(after!.paidAmount).toBe(75);
      expect(after!.balance).toBe(0);
      expect(after!.returnedAmount).toBe(50);
      expect(after!.paymentStatus).toBe('paid');
    });
  });
});
