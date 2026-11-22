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
  getProductIds,
  app
} from './helpers.js';
import { Inventory } from '../modules/inventory/model.js';
import { StockTransaction } from '../modules/inventory/transaction-model.js';
import {
  decrementStock,
  adjustStock,
  getInventory,
  getInventoryByProduct,
  createInventoryRecord,
  incrementStock
} from '../modules/inventory/service.js';
import { InsufficientStockError, AppError } from '../middleware/error-handler.js';
import { Order } from '../modules/orders/model.js';
import { User } from '../modules/auth/model.js';
import { Types } from 'mongoose';

const request = supertest(app);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const createOrderViaApi = async (token: string, customerId: string, productId: string, quantity: number = 1) => {
  const response = await request
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      customerId,
      channel: 'phone',
      items: [{ productId, quantity }]
    });
  return response.body;
};

const getDriverId = async (): Promise<string> => {
  const driver = await User.findOne({ role: 'driver' });
  return driver!._id.toString();
};

/** Force-set inventory quantity for a product (bypasses idempotency of createInventoryRecord) */
const setInventoryQuantity = async (productId: string, quantity: number): Promise<void> => {
  await Inventory.findOneAndUpdate(
    { productId },
    { productId: new Types.ObjectId(productId), quantity, lastUpdated: new Date() },
    { upsert: true }
  );
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Inventory Integration', () => {
  let adminToken: string;
  let driverToken: string;
  let productIds: Record<string, string>;

  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
    await seedProducts();
    productIds = await getProductIds();
    const adminCreds = await seedAdminUser();
    const driverCreds = await seedDriverUser();
    adminToken = await loginAs(request, adminCreds.email, adminCreds.password);
    driverToken = await loginAs(request, driverCreds.email, driverCreds.password);
  });

  // ─── Inventory CRUD via API ──────────────────────────────────────────────

  describe('Inventory CRUD', () => {
    it('GET /api/v1/inventory returns all inventory records', async () => {
      // seedProducts creates 6 inventory records (2 varieties × 3 calibers)
      const res = await request
        .get('/api/v1/inventory')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveLength(6);
      expect(res.body[0].quantity).toBeDefined();
      expect(res.body[0].productId.variety).toBeDefined();
    });

    it('GET /api/v1/inventory/:productId returns specific record', async () => {
      // seedProducts already created blanco-chico with quantity 100
      const res = await request
        .get(`/api/v1/inventory/${productIds['blanco-chico'] as string}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.quantity).toBe(100);
      expect(res.body.productId.variety).toBe('blanco');
    });

    it('GET /api/v1/inventory/:productId returns 404 for missing record', async () => {
      const fakeId = new Types.ObjectId().toString();
      await request
        .get(`/api/v1/inventory/${fakeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('PATCH /api/v1/inventory/:productId adjusts stock and logs transaction', async () => {
      const res = await request
        .patch(`/api/v1/inventory/${productIds['blanco-chico'] as string}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: 150, notes: 'Physical count correction' })
        .expect(200);

      expect(res.body.quantity).toBe(150);

      // Verify transaction was created
      const txns = await StockTransaction.find({ productId: productIds['blanco-chico'] as string });
      expect(txns).toHaveLength(1);
      expect(txns[0]!.type).toBe('adjustment');
      expect(txns[0]!.quantity).toBe(50); // delta: 150 - 100
      expect(txns[0]!.notes).toBe('Physical count correction');
    });

    it('PATCH /api/v1/inventory/:productId returns 404 for missing record', async () => {
      const fakeId = new Types.ObjectId().toString();
      await request
        .patch(`/api/v1/inventory/${fakeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: 100 })
        .expect(404);
    });

    it('GET /api/v1/inventory/:productId/transactions returns transactions', async () => {
      await adjustStock(productIds['blanco-chico'] as string, 150, 'Restock', 'admin');

      const res = await request
        .get(`/api/v1/inventory/${productIds['blanco-chico'] as string}/transactions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].type).toBe('adjustment');
    });
  });

  // ─── Atomic Decrement (service-level) ────────────────────────────────────

  describe('Atomic Decrement', () => {
    it('decrements stock atomically and creates delivery transaction', async () => {
      await setInventoryQuantity(productIds['blanco-chico'] as string, 100);
      const fakeOrderId = new Types.ObjectId().toString();

      const updated = await decrementStock(productIds['blanco-chico'] as string, 20, fakeOrderId, 'driver1');

      expect(updated.quantity).toBe(80);

      // Verify delivery transaction
      const txns = await StockTransaction.find({ productId: productIds['blanco-chico'] as string });
      expect(txns).toHaveLength(1);
      expect(txns[0]!.type).toBe('delivery');
      expect(txns[0]!.quantity).toBe(-20);
      expect(txns[0]!.orderId?.toString()).toBe(fakeOrderId);
    });

    it('throws InsufficientStockError when stock is insufficient', async () => {
      await setInventoryQuantity(productIds['blanco-chico'] as string, 10);
      const fakeOrderId = new Types.ObjectId().toString();

      try {
        await decrementStock(productIds['blanco-chico'] as string, 20, fakeOrderId, 'driver1');
        expect.fail('Should have thrown InsufficientStockError');
      } catch (error) {
        expect(error).toBeInstanceOf(InsufficientStockError);
        const err = error as InsufficientStockError;
        expect(err.productId).toBe(productIds['blanco-chico'] as string);
        expect(err.required).toBe(20);
        expect(err.available).toBe(10);
        expect(err.status).toBe(409);
      }

      // Stock should remain unchanged
      const inv = await Inventory.findOne({ productId: productIds['blanco-chico'] as string });
      expect(inv!.quantity).toBe(10);
    });

    it('does not create transaction on insufficient stock', async () => {
      await setInventoryQuantity(productIds['blanco-chico'] as string, 5);
      const fakeOrderId = new Types.ObjectId().toString();

      try {
        await decrementStock(productIds['blanco-chico'] as string, 20, fakeOrderId, 'driver1');
      } catch {
        // Expected
      }

      const txns = await StockTransaction.find({ productId: productIds['blanco-chico'] as string });
      expect(txns).toHaveLength(0);
    });

    it('decrement fails on zero stock', async () => {
      await setInventoryQuantity(productIds['blanco-chico'] as string, 0);
      const fakeOrderId = new Types.ObjectId().toString();

      try {
        await decrementStock(productIds['blanco-chico'] as string, 1, fakeOrderId, 'driver1');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(InsufficientStockError);
      }
    });

    it('decrement succeeds when stock equals required quantity', async () => {
      await setInventoryQuantity(productIds['blanco-chico'] as string, 20);
      const fakeOrderId = new Types.ObjectId().toString();

      const updated = await decrementStock(productIds['blanco-chico'] as string, 20, fakeOrderId, 'driver1');
      expect(updated.quantity).toBe(0);
    });
  });

  // ─── Race Condition ─────────────────────────────────────────────────────

  describe('Race Condition', () => {
    it('concurrent decrements: one succeeds, one fails with insufficient stock', async () => {
      await setInventoryQuantity(productIds['blanco-chico'] as string, 15);
      const orderId1 = new Types.ObjectId().toString();
      const orderId2 = new Types.ObjectId().toString();

      // Fire two concurrent decrements of 10 each (only 15 available)
      const results = await Promise.allSettled([
        decrementStock(productIds['blanco-chico'] as string, 10, orderId1, 'driver1'),
        decrementStock(productIds['blanco-chico'] as string, 10, orderId2, 'driver2')
      ]);

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      // Exactly one should succeed
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // Final stock should be 5
      const inv = await Inventory.findOne({ productId: productIds['blanco-chico'] as string });
      expect(inv!.quantity).toBe(5);

      // One delivery transaction
      const txns = await StockTransaction.find({ productId: productIds['blanco-chico'] as string });
      expect(txns).toHaveLength(1);
      expect(txns[0]!.type).toBe('delivery');
    });

    it('concurrent decrements with exactly enough stock for only one', async () => {
      await setInventoryQuantity(productIds['blanco-chico'] as string, 10);
      const orderId1 = new Types.ObjectId().toString();
      const orderId2 = new Types.ObjectId().toString();

      const results = await Promise.allSettled([
        decrementStock(productIds['blanco-chico'] as string, 10, orderId1, 'driver1'),
        decrementStock(productIds['blanco-chico'] as string, 10, orderId2, 'driver2')
      ]);

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const inv = await Inventory.findOne({ productId: productIds['blanco-chico'] as string });
      expect(inv!.quantity).toBe(0);
    });
  });

  // ─── Auto-Decrement on Delivery (Integration) ───────────────────────────

  describe('Auto-Decrement on Delivery', () => {
    it('advanceStop to delivered decrements stock for each order item', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer();

      // Set inventory with sufficient stock
      await setInventoryQuantity(productIds['blanco-chico'] as string, 500);

      // Create order with 20 maples of Blanco
      const order = await createOrderViaApi(adminToken, customer._id as string, productIds['blanco-chico'] as string, 20);

      // Create route, add stop, start, advance to delivered
      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-26' });

      const withStop = await request
        .post(`/api/v1/routes/${route.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order._id });

      await request
        .patch(`/api/v1/routes/${route.body._id}/start`)
        .set('Authorization', `Bearer ${adminToken}`);

      const stopId = withStop.body.stops[0]._id;

      // Advance: pending → in_transit → delivered
      await request
        .patch(`/api/v1/routes/${route.body._id}/stops/${stopId}/advance`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'in_transit' });

      await request
        .patch(`/api/v1/routes/${route.body._id}/stops/${stopId}/advance`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'delivered' })
        .expect(200);

      // Verify stock decremented
      const inv = await Inventory.findOne({ productId: productIds['blanco-chico'] as string });
      expect(inv!.quantity).toBe(480); // 500 - 20

      // Verify delivery transaction created
      const txns = await StockTransaction.find({
        productId: productIds['blanco-chico'] as string,
        type: 'delivery'
      });
      expect(txns).toHaveLength(1);
      expect(txns[0]!.quantity).toBe(-20);
    });

    it('returns 409 when delivery would exceed available stock', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer();

      // Only 10 in stock
      await setInventoryQuantity(productIds['blanco-chico'] as string, 10);

      // Order needs 20
      const order = await createOrderViaApi(adminToken, customer._id as string, productIds['blanco-chico'] as string, 20);

      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-26' });

      const withStop = await request
        .post(`/api/v1/routes/${route.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order._id });

      await request
        .patch(`/api/v1/routes/${route.body._id}/start`)
        .set('Authorization', `Bearer ${adminToken}`);

      const stopId = withStop.body.stops[0]._id;

      await request
        .patch(`/api/v1/routes/${route.body._id}/stops/${stopId}/advance`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'in_transit' });

      const res = await request
        .patch(`/api/v1/routes/${route.body._id}/stops/${stopId}/advance`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'delivered' })
        .expect(409);

      expect(res.body.error).toBe('Insufficient stock');
      expect(res.body.productId).toBe(productIds['blanco-chico'] as string);
      expect(res.body.required).toBe(20);
      expect(res.body.available).toBe(10);

      // Stock should remain unchanged
      const inv = await Inventory.findOne({ productId: productIds['blanco-chico'] as string });
      expect(inv!.quantity).toBe(10);
    });

    it('multi-product stop delivery decrements each product independently', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer();

      // Set inventory for two products
      await setInventoryQuantity(productIds['blanco-chico'] as string, 100);
      await setInventoryQuantity(productIds['castaño-chico'] as string, 50);

      // Create order with items for both products
      const orderRes = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [
            { productId: productIds['blanco-chico'] as string, quantity: 10 },
            { productId: productIds['castaño-chico'] as string, quantity: 5 }
          ]
        });
      const order = orderRes.body;

      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-26' });

      const withStop = await request
        .post(`/api/v1/routes/${route.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order._id });

      await request
        .patch(`/api/v1/routes/${route.body._id}/start`)
        .set('Authorization', `Bearer ${adminToken}`);

      const stopId = withStop.body.stops[0]._id;

      await request
        .patch(`/api/v1/routes/${route.body._id}/stops/${stopId}/advance`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'in_transit' });

      await request
        .patch(`/api/v1/routes/${route.body._id}/stops/${stopId}/advance`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'delivered' })
        .expect(200);

      // Verify both products decremented
      const blancoInv = await Inventory.findOne({ productId: productIds['blanco-chico'] as string });
      const castanoInv = await Inventory.findOne({ productId: productIds['castaño-chico'] as string });
      expect(blancoInv!.quantity).toBe(90);  // 100 - 10
      expect(castanoInv!.quantity).toBe(45); // 50 - 5

      // Two delivery transactions created
      const txns = await StockTransaction.find({ type: 'delivery' });
      expect(txns).toHaveLength(2);
    });

    it('route delivery is atomic: a failing second item leaves no partial deduction', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer();

      const productA = productIds['blanco-chico'] as string;
      const productB = productIds['castaño-chico'] as string;
      await setInventoryQuantity(productA, 10);
      await setInventoryQuantity(productB, 10);

      // Item A fits (5 of 10); item B does not (20 of 10).
      const orderRes = await request
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
      const order = orderRes.body;

      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-26' });

      const withStop = await request
        .post(`/api/v1/routes/${route.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order._id });

      await request
        .patch(`/api/v1/routes/${route.body._id}/start`)
        .set('Authorization', `Bearer ${adminToken}`);

      const stopId = withStop.body.stops[0]._id;

      await request
        .patch(`/api/v1/routes/${route.body._id}/stops/${stopId}/advance`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'in_transit' });

      const failed = await request
        .patch(`/api/v1/routes/${route.body._id}/stops/${stopId}/advance`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'delivered' })
        .expect(409);

      expect(failed.body.error).toBe('Insufficient stock');
      expect(failed.body.productId).toBe(productB);

      // Neither product was deducted and no movement was written.
      const invA = await Inventory.findOne({ productId: productA });
      const invB = await Inventory.findOne({ productId: productB });
      expect(invA!.quantity).toBe(10);
      expect(invB!.quantity).toBe(10);
      expect(await StockTransaction.countDocuments({ orderId: order._id })).toBe(0);

      const stored = await Order.findById(order._id);
      expect(stored!.status).toBe('in_transit');
      expect(stored!.stockDeducted).toBe(false);

      // Fix B and retry the delivery — each product is deducted exactly once.
      await setInventoryQuantity(productB, 20);
      await request
        .patch(`/api/v1/routes/${route.body._id}/stops/${stopId}/advance`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'delivered' })
        .expect(200);

      const afterA = await Inventory.findOne({ productId: productA });
      const afterB = await Inventory.findOne({ productId: productB });
      expect(afterA!.quantity).toBe(5); // 10 - 5, once
      expect(afterB!.quantity).toBe(0); // 20 - 20, once

      const txns = await StockTransaction.find({ orderId: order._id, type: 'delivery' });
      expect(txns).toHaveLength(2);
    });
  });

  // ─── Dashboard Alerts with Real Inventory ────────────────────────────────

  describe('Dashboard Alerts — Real Inventory', () => {
    it('low_stock alert uses real inventory quantities', async () => {
      // Set Blanco above threshold (20), Castaño below
      await setInventoryQuantity(productIds['blanco-chico'] as string, 100);
      await setInventoryQuantity(productIds['castaño-chico'] as string, 5);

      const res = await request
        .get('/api/v1/dashboard/alerts')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const alerts = res.body as Array<Record<string, unknown>>;
      const lowStock = alerts.find(a => a.type === 'low_stock');
      expect(lowStock).toBeDefined();

      const products = lowStock!.products as Array<Record<string, unknown>>;
      expect(products).toHaveLength(1);
      expect(products[0]!.currentStock).toBe(5);
    });

    it('no low_stock alert when all products are above threshold', async () => {
      // All seeded at 100, above default threshold (20)
      const res = await request
        .get('/api/v1/dashboard/alerts')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const alerts = res.body as Array<Record<string, unknown>>;
      const lowStock = alerts.find(a => a.type === 'low_stock');
      expect(lowStock).toBeUndefined();
    });

    it('product at exactly threshold is NOT in low_stock alerts', async () => {
      // Set Blanco at exactly 20 (threshold)
      await setInventoryQuantity(productIds['blanco-chico'] as string, 20);

      const res = await request
        .get('/api/v1/dashboard/alerts')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const alerts = res.body as Array<Record<string, unknown>>;
      const lowStock = alerts.find(a => a.type === 'low_stock');
      expect(lowStock).toBeUndefined();
    });

    it('dashboard gracefully handles no inventory records', async () => {
      // Clear all inventory
      await Inventory.deleteMany({});

      const res = await request
        .get('/api/v1/dashboard/alerts')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const alerts = res.body as Array<Record<string, unknown>>;
      const lowStock = alerts.find(a => a.type === 'low_stock');
      // No inventory records → no low stock alerts
      expect(lowStock).toBeUndefined();
    });

    it('multiple products below threshold appear in alerts', async () => {
      await setInventoryQuantity(productIds['blanco-chico'] as string, 3);   // below 20
      await setInventoryQuantity(productIds['castaño-chico'] as string, 10); // below 20
      await setInventoryQuantity(productIds['blanco-grande'] as string, 50);  // above 20

      const res = await request
        .get('/api/v1/dashboard/alerts')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const alerts = res.body as Array<Record<string, unknown>>;
      const lowStock = alerts.find(a => a.type === 'low_stock');
      expect(lowStock).toBeDefined();
      expect(lowStock!.count).toBe(2);

      const products = lowStock!.products as Array<Record<string, unknown>>;
      const stocks = products.map(p => p.currentStock).sort((a, b) => (a as number) - (b as number));
      expect(stocks).toEqual([3, 10]);
    });
  });

  // ─── Duplicate Inventory Record Rejection ────────────────────────────────

  describe('Duplicate Inventory Record Rejection', () => {
    it('createInventoryRecord throws 409 when record already exists', async () => {
      // seedProducts already created Blanco inventory
      try {
        await createInventoryRecord(productIds['blanco-chico'] as string as string, 50);
        expect.fail('Should have thrown AppError with status 409');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).status).toBe(409);
        expect((error as AppError).message).toBe('Inventory record already exists for this product');
      }

      // Original record should be unchanged
      const inv = await Inventory.findOne({ productId: productIds['blanco-chico'] as string });
      expect(inv!.quantity).toBe(100);
    });

    it('createInventoryRecord creates record for new product', async () => {
      const fakeId = new Types.ObjectId().toString();
      const record = await createInventoryRecord(fakeId, 25);
      expect(record.quantity).toBe(25);
      expect(record.productId.toString()).toBe(fakeId);
    });

    it('createInventoryRecord defaults quantity to 0', async () => {
      const fakeId = new Types.ObjectId().toString();
      const record = await createInventoryRecord(fakeId);
      expect(record.quantity).toBe(0);
    });
  });

  // ─── Append-Only Transactions (405) ─────────────────────────────────────

  describe('Append-Only Transactions', () => {
    it('PUT /api/v1/inventory/:productId/transactions returns 405', async () => {
      const res = await request
        .put(`/api/v1/inventory/${productIds['blanco-chico'] as string}/transactions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'adjustment' })
        .expect(405);

      expect(res.body.error).toBe('Method Not Allowed');
    });

    it('PATCH /api/v1/inventory/:productId/transactions returns 405', async () => {
      const res = await request
        .patch(`/api/v1/inventory/${productIds['blanco-chico'] as string}/transactions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'updated' })
        .expect(405);

      expect(res.body.error).toBe('Method Not Allowed');
    });

    it('DELETE /api/v1/inventory/:productId/transactions returns 405', async () => {
      const res = await request
        .delete(`/api/v1/inventory/${productIds['blanco-chico'] as string}/transactions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(405);

      expect(res.body.error).toBe('Method Not Allowed');
    });

    it('transactions cannot be updated at model level', async () => {
      const txn = await StockTransaction.create({
        productId: new Types.ObjectId(productIds['blanco-chico'] as string),
        type: 'adjustment',
        quantity: 10,
        notes: 'test',
        createdBy: 'admin'
      });

      try {
        await StockTransaction.findOneAndUpdate(
          { _id: txn._id },
          { notes: 'modified' }
        );
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toBe('Transactions are append-only');
      }
    });

    it('transactions cannot be deleted at model level', async () => {
      const txn = await StockTransaction.create({
        productId: new Types.ObjectId(productIds['blanco-chico'] as string),
        type: 'adjustment',
        quantity: 10,
        notes: 'test',
        createdBy: 'admin'
      });

      try {
        await StockTransaction.findOneAndDelete({ _id: txn._id });
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toBe('Transactions are append-only');
      }
    });
  });

  // ─── Manual Stock Adjustment Edge Cases ──────────────────────────────────

  describe('Manual Stock Adjustment Edge Cases', () => {
    it('adjustStock creates the record on first entry and logs the full delta', async () => {
      const blancoId = productIds['blanco-chico'] as string;
      await Inventory.deleteOne({ productId: blancoId });

      const created = await adjustStock(blancoId, 40, 'Initial count', 'admin');

      expect(created.quantity).toBe(40);
      const stored = await Inventory.findOne({ productId: blancoId });
      expect(stored?.quantity).toBe(40);

      const txns = await StockTransaction.find({ productId: blancoId });
      expect(txns).toHaveLength(1);
      expect(txns[0]!.type).toBe('adjustment');
      expect(txns[0]!.quantity).toBe(40); // delta: 40 - 0 (record did not exist)
      expect(txns[0]!.notes).toBe('Initial count');
    });

    it('PATCH /api/v1/inventory/:productId adjusts stock to zero', async () => {
      const res = await request
        .patch(`/api/v1/inventory/${productIds['blanco-chico'] as string}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: 0, notes: 'Zeroed out' })
        .expect(200);

      expect(res.body.quantity).toBe(0);

      const txns = await StockTransaction.find({ productId: productIds['blanco-chico'] as string as string });
      expect(txns).toHaveLength(1);
      expect(txns[0]!.quantity).toBe(-100); // delta: 0 - 100
    });

    it('PATCH returns 400 for negative quantity', async () => {
      await request
        .patch(`/api/v1/inventory/${productIds['blanco-chico'] as string}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: -5 })
        .expect(400);
    });

    it('PATCH returns 400 for non-numeric quantity', async () => {
      await request
        .patch(`/api/v1/inventory/${productIds['blanco-chico'] as string}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: 'abc' })
        .expect(400);
    });

    it('PATCH returns 400 when quantity is missing', async () => {
      await request
        .patch(`/api/v1/inventory/${productIds['blanco-chico'] as string}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'no quantity' })
        .expect(400);
    });
  });

  // ─── Increment Stock (purchase) ──────────────────────────────────────────

  describe('Increment Stock', () => {
    it('increments stock and creates purchase transaction', async () => {
      const blancoId = productIds['blanco-chico'] as string as string;
      await setInventoryQuantity(blancoId, 50);
      const updated = await incrementStock(blancoId, 30, 'Supplier restock', 'admin');

      expect(updated.quantity).toBe(80);

      const txns = await StockTransaction.find({ productId: blancoId });
      expect(txns).toHaveLength(1);
      expect(txns[0]!.type).toBe('purchase');
      expect(txns[0]!.quantity).toBe(30);
      // Callers that do not pass a purchase id keep an unlinked transaction.
      expect(txns[0]!.purchaseId).toBeNull();
    });

    it('creates the inventory record on the first stock entry (no record yet)', async () => {
      const blancoId = productIds['blanco-chico'] as string;
      // A product created without an inventory record (production incident).
      await Inventory.deleteOne({ productId: blancoId });

      const created = await incrementStock(blancoId, 30, 'Supplier restock', 'admin');

      // The record is born with the increment as its first quantity.
      expect(created.quantity).toBe(30);
      const stored = await Inventory.findOne({ productId: blancoId });
      expect(stored?.quantity).toBe(30);

      const txns = await StockTransaction.find({ productId: blancoId });
      expect(txns).toHaveLength(1);
      expect(txns[0]!.type).toBe('purchase');
      expect(txns[0]!.quantity).toBe(30);
      expect(txns[0]!.notes).toBe('Supplier restock');
    });

    it('throws 404 for non-existent product', async () => {
      const fakeId = new Types.ObjectId().toString();
      try {
        await incrementStock(fakeId, 10, 'restock', 'admin');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).status).toBe(404);
      }
    });
  });

  // ─── Auth guards ─────────────────────────────────────────────────────────

  describe('Auth Guards', () => {
    it('returns 401 for inventory list without token', async () => {
      await request.get('/api/v1/inventory').expect(401);
    });

    it('returns 403 for driver trying to adjust stock', async () => {
      await request
        .patch(`/api/v1/inventory/${productIds['blanco-chico'] as string}`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ quantity: 200 })
        .expect(403);
    });
  });
});
