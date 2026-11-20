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
  getProductIds,
  app
} from './helpers.js';
import { Inventory } from '../modules/inventory/model.js';
import { StockTransaction } from '../modules/inventory/transaction-model.js';
import { Product } from '../modules/products/model.js';
import { Types } from 'mongoose';

const request = supertest(app);

// ─── Test suite for the inventory CRUD endpoints ────────────────────────────

describe('Inventory CRUD Endpoints', () => {
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

  /**
   * Create a product WITHOUT an auto-created inventory record (model-level insert).
   * Only uses combos that seedProducts() does NOT seed (extragrande/surtido), and
   * reuses a combo when it already exists, so it never hits the (variety, caliber)
   * unique index.
   */
  const nonSeededCombos: Array<{ variety: 'blanco' | 'castaño'; caliber: 'extragrande' | 'surtido' }> = [
    { variety: 'blanco', caliber: 'extragrande' },
    { variety: 'castaño', caliber: 'extragrande' },
    { variety: 'blanco', caliber: 'surtido' },
    { variety: 'castaño', caliber: 'surtido' }
  ];
  let productCounter = 0;
  const createProductWithoutInventory = async (): Promise<string> => {
    const combo = nonSeededCombos[productCounter % nonSeededCombos.length]!;
    productCounter++;
    const existing = await Product.findOne(combo);
    if (existing) return existing._id.toString();
    const product = await Product.create({ ...combo, eggsPerMaple: 30 });
    return product._id.toString();
  };

  // ─── POST /inventory — create record ──────────────────────────────────────

  describe('POST /api/v1/inventory', () => {
    it('creates an inventory record and logs an initial adjustment transaction', async () => {
      const productId = await createProductWithoutInventory();

      const res = await request
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId, quantity: 50 })
        .expect(201);

      expect(res.body.quantity).toBe(50);
      expect(res.body.productId.toString()).toBe(productId);

      const txns = await StockTransaction.find({ productId });
      expect(txns).toHaveLength(1);
      expect(txns[0]!.type).toBe('adjustment');
      expect(txns[0]!.quantity).toBe(50);
    });

    it('defaults quantity to 0 and logs no transaction', async () => {
      const productId = await createProductWithoutInventory();

      const res = await request
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId })
        .expect(201);

      expect(res.body.quantity).toBe(0);

      const txns = await StockTransaction.find({ productId });
      expect(txns).toHaveLength(0);
    });

    it('updates the product low stock threshold when provided', async () => {
      const productId = await createProductWithoutInventory();

      await request
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId, quantity: 10, lowStockThreshold: 5 })
        .expect(201);

      const product = await Product.findById(productId);
      expect(product!.lowStockThreshold).toBe(5);
    });

    it('returns 409 when a record already exists', async () => {
      const res = await request
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId: productIds['blanco-chico'] })
        .expect(409);

      expect(res.body.error).toBe('Inventory record already exists for this product');
    });

    it('returns 404 for a non-existent product', async () => {
      const fakeId = new Types.ObjectId().toString();
      await request
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId: fakeId })
        .expect(404);
    });

    it('returns 400 for an invalid body', async () => {
      const productId = await createProductWithoutInventory();

      await request
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId, quantity: -1 })
        .expect(400);

      await request
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: 5 })
        .expect(400);

      await request
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId: 'not-an-id' })
        .expect(400);
    });
  });

  // ─── DELETE /inventory/:productId — remove record ─────────────────────────

  describe('DELETE /api/v1/inventory/:productId', () => {
    it('removes an inventory record', async () => {
      await request
        .delete(`/api/v1/inventory/${productIds['blanco-chico'] as string}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      const inv = await Inventory.findOne({ productId: productIds['blanco-chico'] as string });
      expect(inv).toBeNull();
    });

    it('returns 404 for a missing record', async () => {
      const fakeId = new Types.ObjectId().toString();
      await request
        .delete(`/api/v1/inventory/${fakeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  // ─── POST /inventory/:productId/increment — stock entry ───────────────────

  describe('POST /api/v1/inventory/:productId/increment', () => {
    it('adds stock and creates a purchase transaction', async () => {
      // Blanco starts at 100 from seed
      const res = await request
        .post(`/api/v1/inventory/${productIds['blanco-chico'] as string}/increment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: 30, notes: 'Supplier restock' })
        .expect(200);

      expect(res.body.quantity).toBe(130);

      const txns = await StockTransaction.find({ productId: productIds['blanco-chico'] as string });
      expect(txns).toHaveLength(1);
      expect(txns[0]!.type).toBe('purchase');
      expect(txns[0]!.quantity).toBe(30);
      expect(txns[0]!.notes).toBe('Supplier restock');
    });

    it('returns 400 for non-positive or missing quantity', async () => {
      const id = productIds['blanco-chico'] as string;

      await request
        .post(`/api/v1/inventory/${id}/increment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: 0 })
        .expect(400);

      await request
        .post(`/api/v1/inventory/${id}/increment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: -5 })
        .expect(400);

      await request
        .post(`/api/v1/inventory/${id}/increment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(400);
    });

    it('returns 404 for a missing inventory record', async () => {
      const fakeId = new Types.ObjectId().toString();
      await request
        .post(`/api/v1/inventory/${fakeId}/increment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: 10 })
        .expect(404);
    });
  });

  // ─── POST /inventory/:productId/decrement — stock exit ────────────────────

  describe('POST /api/v1/inventory/:productId/decrement', () => {
    it('subtracts stock and creates an adjustment transaction with negative quantity', async () => {
      const res = await request
        .post(`/api/v1/inventory/${productIds['blanco-chico'] as string}/decrement`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: 40, notes: 'Manual exit' })
        .expect(200);

      expect(res.body.quantity).toBe(60);

      const txns = await StockTransaction.find({ productId: productIds['blanco-chico'] as string });
      expect(txns).toHaveLength(1);
      expect(txns[0]!.type).toBe('adjustment');
      expect(txns[0]!.quantity).toBe(-40);
      expect(txns[0]!.notes).toBe('Manual exit');
    });

    it('returns 409 with details when stock is insufficient', async () => {
      // Set stock to 10 via the absolute adjust endpoint (creates 1 adjustment txn)
      await request
        .patch(`/api/v1/inventory/${productIds['blanco-chico'] as string}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: 10 })
        .expect(200);

      const res = await request
        .post(`/api/v1/inventory/${productIds['blanco-chico'] as string}/decrement`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: 20 })
        .expect(409);

      expect(res.body.error).toBe('Insufficient stock');
      expect(res.body.productId).toBe(productIds['blanco-chico'] as string);
      expect(res.body.required).toBe(20);
      expect(res.body.available).toBe(10);

      // Stock unchanged and no transaction logged for the failed decrement
      const inv = await Inventory.findOne({ productId: productIds['blanco-chico'] as string });
      expect(inv!.quantity).toBe(10);

      const txns = await StockTransaction.find({ productId: productIds['blanco-chico'] as string });
      expect(txns).toHaveLength(1);
    });

    it('cannot go below zero', async () => {
      await request
        .patch(`/api/v1/inventory/${productIds['blanco-chico'] as string}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: 5 })
        .expect(200);

      await request
        .post(`/api/v1/inventory/${productIds['blanco-chico'] as string}/decrement`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: 10 })
        .expect(409);

      const inv = await Inventory.findOne({ productId: productIds['blanco-chico'] as string });
      expect(inv!.quantity).toBe(5);
    });

    it('returns 400 for non-positive quantity', async () => {
      const id = productIds['blanco-chico'] as string;

      await request
        .post(`/api/v1/inventory/${id}/decrement`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: 0 })
        .expect(400);

      await request
        .post(`/api/v1/inventory/${id}/decrement`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: -3 })
        .expect(400);
    });

    it('returns 404 for a missing inventory record', async () => {
      const fakeId = new Types.ObjectId().toString();
      await request
        .post(`/api/v1/inventory/${fakeId}/decrement`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: 10 })
        .expect(404);
    });
  });

  // ─── GET /transactions — list all with filters + pagination ───────────────

  describe('GET /api/v1/inventory/transactions', () => {
    /** Seed 3 transactions across 2 products with deterministic timestamps. */
    const seedTransactions = async (): Promise<number> => {
      const base = Date.now();
      await StockTransaction.create([
        { productId: productIds['blanco-chico'], type: 'purchase', quantity: 10, notes: 't1', createdBy: 'admin', createdAt: new Date(base) },
        { productId: productIds['blanco-chico'], type: 'adjustment', quantity: -5, notes: 't2', createdBy: 'admin', createdAt: new Date(base + 1000) },
        { productId: productIds['castaño-chico'], type: 'sale', quantity: -3, notes: 't3', createdBy: 'admin', createdAt: new Date(base + 2000) }
      ]);
      return base;
    };

    it('lists all transactions sorted by createdAt desc with pagination metadata', async () => {
      await seedTransactions();

      const res = await request
        .get('/api/v1/inventory/transactions')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.total).toBe(3);
      expect(res.body.items).toHaveLength(3);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(50);
      expect(res.body.items[0]!.notes).toBe('t3');
      expect(res.body.items[2]!.notes).toBe('t1');
    });

    it('filters by productId', async () => {
      await seedTransactions();

      const res = await request
        .get(`/api/v1/inventory/transactions?productId=${productIds['blanco-chico'] as string}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.total).toBe(2);
    });

    it('filters by type', async () => {
      await seedTransactions();

      const res = await request
        .get('/api/v1/inventory/transactions?type=purchase')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.items[0]!.notes).toBe('t1');
    });

    it('filters by date range', async () => {
      const base = await seedTransactions();
      const from = new Date(base + 500).toISOString();

      const res = await request
        .get(`/api/v1/inventory/transactions?from=${from}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.total).toBe(2); // t2 and t3, t1 is before `from`

      const to = new Date(base + 1500).toISOString();
      const resTo = await request
        .get(`/api/v1/inventory/transactions?from=${from}&to=${to}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(resTo.body.total).toBe(1); // only t2
    });

    it('paginates with limit and page', async () => {
      await seedTransactions();

      const res = await request
        .get('/api/v1/inventory/transactions?limit=2&page=2')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.total).toBe(3);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.page).toBe(2);
      expect(res.body.limit).toBe(2);
      expect(res.body.items[0]!.notes).toBe('t1');
    });

    it('caps limit at 200', async () => {
      await seedTransactions();

      const res = await request
        .get('/api/v1/inventory/transactions?limit=500')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.limit).toBe(200);
    });

    it('returns 400 for invalid filters', async () => {
      await request
        .get('/api/v1/inventory/transactions?type=bogus')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);

      await request
        .get('/api/v1/inventory/transactions?limit=0')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);

      await request
        .get('/api/v1/inventory/transactions?limit=abc')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);

      await request
        .get('/api/v1/inventory/transactions?page=0')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);

      await request
        .get('/api/v1/inventory/transactions?productId=not-an-id')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);

      await request
        .get('/api/v1/inventory/transactions?from=not-a-date')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });
  });

  // ─── PATCH /inventory/:productId/threshold — low stock threshold ──────────

  describe('PATCH /api/v1/inventory/:productId/threshold', () => {
    it('updates the low stock threshold on the product', async () => {
      const res = await request
        .patch(`/api/v1/inventory/${productIds['blanco-chico'] as string}/threshold`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lowStockThreshold: 15 })
        .expect(200);

      expect(res.body.lowStockThreshold).toBe(15);

      const product = await Product.findById(productIds['blanco-chico'] as string);
      expect(product!.lowStockThreshold).toBe(15);
    });

    it('returns 400 for invalid threshold values', async () => {
      const id = productIds['blanco-chico'] as string;

      await request
        .patch(`/api/v1/inventory/${id}/threshold`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(400);

      await request
        .patch(`/api/v1/inventory/${id}/threshold`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lowStockThreshold: 0 })
        .expect(400);

      await request
        .patch(`/api/v1/inventory/${id}/threshold`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lowStockThreshold: -5 })
        .expect(400);

      await request
        .patch(`/api/v1/inventory/${id}/threshold`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lowStockThreshold: 'abc' })
        .expect(400);
    });

    it('returns 404 for a missing inventory record', async () => {
      const fakeId = new Types.ObjectId().toString();
      await request
        .patch(`/api/v1/inventory/${fakeId}/threshold`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lowStockThreshold: 10 })
        .expect(404);
    });
  });

  // ─── Auth guards ──────────────────────────────────────────────────────────

  describe('Auth Guards', () => {
    it('returns 401 without a token on all new endpoints', async () => {
      await request.post('/api/v1/inventory').send({ productId: productIds['blanco-chico'] }).expect(401);
      await request.delete(`/api/v1/inventory/${productIds['blanco-chico'] as string}`).expect(401);
      await request
        .post(`/api/v1/inventory/${productIds['blanco-chico'] as string}/increment`)
        .send({ quantity: 5 })
        .expect(401);
      await request
        .post(`/api/v1/inventory/${productIds['blanco-chico'] as string}/decrement`)
        .send({ quantity: 5 })
        .expect(401);
      await request
        .patch(`/api/v1/inventory/${productIds['blanco-chico'] as string}/threshold`)
        .send({ lowStockThreshold: 10 })
        .expect(401);
      await request.get('/api/v1/inventory/transactions').expect(401);
    });

    it('returns 403 for driver on admin-only endpoints', async () => {
      const productId = await createProductWithoutInventory();

      await request
        .post('/api/v1/inventory')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ productId })
        .expect(403);

      await request
        .delete(`/api/v1/inventory/${productIds['blanco-chico'] as string}`)
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(403);

      await request
        .post(`/api/v1/inventory/${productIds['blanco-chico'] as string}/increment`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ quantity: 5 })
        .expect(403);

      await request
        .post(`/api/v1/inventory/${productIds['blanco-chico'] as string}/decrement`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ quantity: 5 })
        .expect(403);

      await request
        .patch(`/api/v1/inventory/${productIds['blanco-chico'] as string}/threshold`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ lowStockThreshold: 10 })
        .expect(403);

      await request
        .get('/api/v1/inventory/transactions')
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(403);
    });
  });
});