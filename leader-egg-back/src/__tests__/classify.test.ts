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
  getProductIds,
  app
} from './helpers.js';
import { Inventory } from '../modules/inventory/model.js';
import { StockTransaction } from '../modules/inventory/transaction-model.js';
import { Product } from '../modules/products/model.js';

const request = supertest(app);

/** Force-set inventory quantity for a product (bypasses idempotency of createInventoryRecord). */
const setInventoryQuantity = async (productId: string, quantity: number): Promise<void> => {
  await Inventory.findOneAndUpdate(
    { productId },
    { productId: new Types.ObjectId(productId), quantity, lastUpdated: new Date() },
    { upsert: true }
  );
};

describe('Classify — POST /api/v1/inventory/:productId/classify', () => {
  let adminToken: string;
  let driverToken: string;
  let productIds: Record<string, string>;

  beforeAll(async () => { await startTestDatabase(); });
  afterAll(async () => { await stopTestDatabase(); });

  beforeEach(async () => {
    await clearDatabase();
    await seedProducts();
    productIds = await getProductIds();
    const admin = await seedAdminUser();
    const driver = await seedDriverUser();
    adminToken = await loginAs(request, admin.email, admin.password);
    driverToken = await loginAs(request, driver.email, driver.password);
  });

  /** Index access is `string | undefined` under noUncheckedIndexedAccess — cast once here. */
  const pid = (varietyCaliber: string): string => productIds[varietyCaliber] as string;

  const classify = (fromProductId: string, body: Record<string, unknown>, token: string = adminToken) =>
    request
      .post(`/api/v1/inventory/${fromProductId}/classify`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  describe('Happy path', () => {
    it('decrements the source, increments targets and links all transactions by one referenceId', async () => {
      // Spec scenario: blanco-chico has 10 maples → targets 4+3+3 = 10.
      const extra = await Product.create({ variety: 'blanco', caliber: 'extragrande', eggsPerMaple: 30 });
      const extraId = extra._id.toString();
      await setInventoryQuantity(pid('blanco-chico'), 10);
      await setInventoryQuantity(pid('castaño-chico'), 0);
      await setInventoryQuantity(pid('blanco-grande'), 0);
      await setInventoryQuantity(extraId, 0);

      const res = await classify(pid('blanco-chico'), {
        to: [
          { productId: pid('castaño-chico'), quantity: 4 },
          { productId: pid('blanco-grande'), quantity: 3 },
          { productId: extraId, quantity: 3 }
        ],
        notes: 'Clasificación semanal'
      }).expect(200);

      // Response: source fully consumed, targets incremented, shared referenceId
      expect(res.body.referenceId).toMatch(/^classify-[0-9a-f-]{36}$/);
      expect(res.body.source.quantity).toBe(0);
      expect(res.body.targets).toHaveLength(3);
      const byId = new Map(
        (res.body.targets as Array<{ productId: string; quantity: number }>).map((t) => [String(t.productId), t.quantity])
      );
      expect(byId.get(pid('castaño-chico'))).toBe(4);
      expect(byId.get(pid('blanco-grande'))).toBe(3);
      expect(byId.get(extraId)).toBe(3);

      // Persisted inventory state
      const castanoChico = await Inventory.findOne({ productId: pid('castaño-chico') });
      const blancoGrande = await Inventory.findOne({ productId: pid('blanco-grande') });
      const extraInv = await Inventory.findOne({ productId: extraId });
      expect(castanoChico!.quantity).toBe(4);
      expect(blancoGrande!.quantity).toBe(3);
      expect(extraInv!.quantity).toBe(3);

      // All 4 classification transactions share the same referenceId
      const txns = await StockTransaction.find({ type: 'classification' });
      expect(txns).toHaveLength(4);
      const refIds = new Set(txns.map((t) => t.referenceId));
      expect(refIds.size).toBe(1);
      expect(refIds.has(res.body.referenceId)).toBe(true);

      const sourceTxn = txns.find((t) => t.productId.toString() === pid('blanco-chico'));
      expect(sourceTxn!.quantity).toBe(-10);
      expect(sourceTxn!.notes).toBe('Clasificación semanal');
      const targetTxns = txns.filter((t) => t.productId.toString() !== pid('blanco-chico'));
      expect(targetTxns.map((t) => t.quantity).sort()).toEqual([3, 3, 4]);
    });

    it('keeps the remainder when Σ to is below the source stock', async () => {
      await setInventoryQuantity(pid('blanco-chico'), 10);

      const res = await classify(pid('blanco-chico'), {
        to: [{ productId: pid('castaño-chico'), quantity: 4 }]
      }).expect(200);

      expect(res.body.source.quantity).toBe(6);
      const castanoChico = await Inventory.findOne({ productId: pid('castaño-chico') });
      expect(castanoChico!.quantity).toBe(104); // seeded 100 + 4
      const txns = await StockTransaction.find({ type: 'classification' });
      expect(txns).toHaveLength(2);
      expect(new Set(txns.map((t) => t.referenceId)).size).toBe(1);
    });

    it('applies the same target product listed twice as two increments', async () => {
      await setInventoryQuantity(pid('blanco-chico'), 10);
      await setInventoryQuantity(pid('castaño-chico'), 0);

      const res = await classify(pid('blanco-chico'), {
        to: [
          { productId: pid('castaño-chico'), quantity: 2 },
          { productId: pid('castaño-chico'), quantity: 3 }
        ]
      }).expect(200);

      expect(res.body.source.quantity).toBe(5);
      const castanoChico = await Inventory.findOne({ productId: pid('castaño-chico') });
      expect(castanoChico!.quantity).toBe(5);
      const txns = await StockTransaction.find({ type: 'classification' });
      expect(txns).toHaveLength(3); // 1 source + 2 target entries
    });

    it('works without notes (defaults the transaction label)', async () => {
      await setInventoryQuantity(pid('blanco-chico'), 10);
      await classify(pid('blanco-chico'), {
        to: [{ productId: pid('castaño-chico'), quantity: 2 }]
      }).expect(200);

      const txns = await StockTransaction.find({ type: 'classification' });
      expect(txns).toHaveLength(2);
      expect(txns[0]!.notes).toBe('Clasificación de surtido');
    });
  });

  describe('Validation', () => {
    it('returns 400 "No hay stock suficiente" when Σ to exceeds the source and persists nothing', async () => {
      await setInventoryQuantity(pid('blanco-chico'), 5);

      const res = await classify(pid('blanco-chico'), {
        to: [
          { productId: pid('castaño-chico'), quantity: 4 },
          { productId: pid('blanco-grande'), quantity: 4 }
        ]
      }).expect(400);

      expect(res.body.error).toBe('No hay stock suficiente');

      // Source unchanged, no transactions created
      const blancoChico = await Inventory.findOne({ productId: pid('blanco-chico') });
      expect(blancoChico!.quantity).toBe(5);
      expect(await StockTransaction.countDocuments()).toBe(0);
    });

    it('returns 400 for an empty or missing `to` array', async () => {
      await setInventoryQuantity(pid('blanco-chico'), 10);
      await classify(pid('blanco-chico'), { to: [] }).expect(400);
      await classify(pid('blanco-chico'), {}).expect(400);
    });

    it('returns 400 for a zero or negative target quantity', async () => {
      await setInventoryQuantity(pid('blanco-chico'), 10);
      await classify(pid('blanco-chico'), { to: [{ productId: pid('castaño-chico'), quantity: 0 }] }).expect(400);
      await classify(pid('blanco-chico'), { to: [{ productId: pid('castaño-chico'), quantity: -3 }] }).expect(400);
    });

    it('returns 400 for self-classification (target === source)', async () => {
      await setInventoryQuantity(pid('blanco-chico'), 10);
      const res = await classify(pid('blanco-chico'), {
        to: [{ productId: pid('blanco-chico'), quantity: 5 }]
      }).expect(400);
      expect(res.body.error).toBe('No se puede clasificar un producto hacia sí mismo');
      expect(await StockTransaction.countDocuments()).toBe(0);
    });

    it('returns 404 for an unknown source product', async () => {
      await classify(new Types.ObjectId().toString(), {
        to: [{ productId: pid('castaño-chico'), quantity: 1 }]
      }).expect(404);
    });

    it('returns 404 for an unknown target product and persists nothing', async () => {
      await setInventoryQuantity(pid('blanco-chico'), 10);
      await classify(pid('blanco-chico'), {
        to: [{ productId: new Types.ObjectId().toString(), quantity: 1 }]
      }).expect(404);
      expect(await StockTransaction.countDocuments()).toBe(0);
    });

    it('returns 404 when the source product has no inventory record', async () => {
      await Inventory.deleteMany({});
      const nuevo = await Product.create({ variety: 'blanco', caliber: 'extragrande', eggsPerMaple: 30 });

      await classify(nuevo._id.toString(), {
        to: [{ productId: pid('castaño-chico'), quantity: 1 }]
      }).expect(404);
    });

    it('returns 404 when a target product has no inventory record', async () => {
      await setInventoryQuantity(pid('blanco-chico'), 10);
      const nuevo = await Product.create({ variety: 'blanco', caliber: 'extragrande', eggsPerMaple: 30 });

      await classify(pid('blanco-chico'), {
        to: [{ productId: nuevo._id.toString(), quantity: 1 }]
      }).expect(404);
      expect(await StockTransaction.countDocuments()).toBe(0);
    });
  });

  describe('Auth guards', () => {
    it('returns 401 without a token', async () => {
      await request
        .post(`/api/v1/inventory/${pid('blanco-chico')}/classify`)
        .send({ to: [{ productId: pid('castaño-chico'), quantity: 1 }] })
        .expect(401);
    });

    it('returns 403 for a driver (admin-only)', async () => {
      await setInventoryQuantity(pid('blanco-chico'), 10);
      await classify(pid('blanco-chico'), {
        to: [{ productId: pid('castaño-chico'), quantity: 1 }]
      }, driverToken).expect(403);
    });
  });
});
