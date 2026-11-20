import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  seedProducts,
  getProductIds,
  loginAs
} from './helpers.js';
import { app } from '../app.js';
import { Supplier } from '../modules/suppliers/model.js';
import { Purchase } from '../modules/purchases/model.js';
import { Inventory } from '../modules/inventory/model.js';
import { StockTransaction } from '../modules/inventory/transaction-model.js';
import { Product } from '../modules/products/model.js';
import { Payment } from '../modules/payments/model.js';
import { applyDelivery } from '../modules/purchases/service.js';
import { buildDuplicateFingerprint } from '../utils/duplicate-guard.js';

const request = supertest(app);

const createSupplier = async (overrides: Record<string, unknown> = {}) => {
  const supplier = await Supplier.create({ name: 'Granja Test', ...overrides });
  return supplier.toObject() as unknown as Record<string, unknown>;
};

describe('Purchases API', () => {
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
    const creds = await seedAdminUser();
    adminToken = await loginAs(request, creds.email, creds.password);
    await seedProducts();
    products = await getProductIds();
  });

  describe('POST /api/v1/purchases — lifecycle-aware create', () => {
    it('creates a PENDING purchase: NO stock change, totals computed, payment defaults (R1)', async () => {
      const supplier = await createSupplier();

      const res = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          date: '2026-09-29',
          items: [{ productId: products['blanco-chico'], quantity: 5, unitCost: 100 }],
          notes: 'Compra semanal'
        })
        .expect(201);

      expect(res.body.purchaseNumber).toMatch(/^PUR-\d{8}-\d{3}$/);
      expect(res.body.totalCost).toBe(500);
      expect(res.body.items[0].subtotal).toBe(500);
      expect(res.body.items[0].productName).toBe('Blanco Chico');
      expect(res.body.items[0].unit).toBe('maple');
      expect(res.body.items[0].quantity).toBe(5);
      expect(res.body.items[0].quantityMaples).toBe(5);
      expect(res.body.items[0].unitCostPerMaple).toBe(100);
      expect(res.body.notes).toBe('Compra semanal');

      // Lifecycle defaults: pending, not delivered, unpaid
      expect(res.body.status).toBe('pending');
      expect(res.body.deliveredAt).toBeNull();
      expect(res.body.paymentStatus).toBe('unpaid');
      expect(res.body.paidAmount).toBe(0);

      // Stock NOT incremented at creation (100 seeded → still 100)
      const inventory = await Inventory.findOne({ productId: products['blanco-chico'] });
      expect(inventory?.quantity).toBe(100);

      // No 'purchase' transaction logged yet
      const tx = await StockTransaction.findOne({ productId: products['blanco-chico'], type: 'purchase' });
      expect(tx).toBeNull();

      // Cost (WAC) NOT touched until delivery
      const product = await Product.findById(products['blanco-chico']);
      expect(product?.costPrice).toBeNull();
    });

    it('creates a cajón purchase: quantityMaples = qty × 12, per-maple cost, subtotal as entered; stock only after deliver', async () => {
      const supplier = await createSupplier();

      const res = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          date: '2026-09-29',
          // 12 cajones at $1200/cajón → 144 maples, $100/maple, $14400 subtotal
          items: [{ productId: products['blanco-chico'], quantity: 12, unit: 'cajon', unitCost: 1200 }]
        })
        .expect(201);

      expect(res.body.totalCost).toBe(14400);
      const item = res.body.items[0];
      expect(item.unit).toBe('cajon');
      expect(item.quantity).toBe(12);
      expect(item.quantityMaples).toBe(144);
      expect(item.unitCost).toBe(1200);
      expect(item.unitCostPerMaple).toBe(100);
      expect(item.subtotal).toBe(14400);

      // Stock NOT incremented at creation (100 seeded → still 100)
      const inventory = await Inventory.findOne({ productId: products['blanco-chico'] });
      expect(inventory?.quantity).toBe(100);
    });

    it('creates a medio cajón purchase: quantityMaples = qty × 6 (maplesPerCajon 12), per-maple cost = unitCost ÷ 6', async () => {
      const supplier = await createSupplier();

      const res = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          // 4 medio cajones at $600/half-cajón → 24 maples, $100/maple, $2400 subtotal
          items: [{ productId: products['blanco-chico'], quantity: 4, unit: 'medio_cajon', unitCost: 600 }]
        })
        .expect(201);

      const item = res.body.items[0];
      expect(item.unit).toBe('medio_cajon');
      expect(item.quantity).toBe(4);
      expect(item.quantityMaples).toBe(24); // 4 × (12 / 2)
      expect(item.unitCost).toBe(600);
      expect(item.unitCostPerMaple).toBe(100); // 600 ÷ 6
      expect(item.subtotal).toBe(2400);
      expect(res.body.totalCost).toBe(2400);

      // Stock NOT incremented at creation (100 seeded → still 100)
      const inventory = await Inventory.findOne({ productId: products['blanco-chico'] });
      expect(inventory?.quantity).toBe(100);
    });

    it('handles mixed units in one purchase', async () => {
      const supplier = await createSupplier();

      const res = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [
            { productId: products['blanco-chico'], quantity: 30, unitCost: 100 }, // maples
            { productId: products['castaño-chico'], quantity: 2, unit: 'cajon', unitCost: 2400 } // cajones
          ]
        })
        .expect(201);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0]).toMatchObject({ unit: 'maple', quantity: 30, quantityMaples: 30, unitCostPerMaple: 100, subtotal: 3000 });
      expect(res.body.items[1]).toMatchObject({ unit: 'cajon', quantity: 2, quantityMaples: 24, unitCostPerMaple: 200, subtotal: 4800 });
      expect(res.body.totalCost).toBe(7800);
    });

    it('accepts legacy quantityMaples payloads (backward compat: defaults to maple)', async () => {
      const supplier = await createSupplier();

      const res = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantityMaples: 5, unitCost: 100 }]
        })
        .expect(201);

      expect(res.body.items[0].unit).toBe('maple');
      expect(res.body.items[0].quantity).toBe(5);
      expect(res.body.items[0].quantityMaples).toBe(5);
      expect(res.body.items[0].unitCostPerMaple).toBe(100);
    });

    it('creates with delivered:true → status delivered, deliveredAt set, stock incremented (maples)', async () => {
      const supplier = await createSupplier();

      const res = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          delivered: true,
          items: [{ productId: products['blanco-chico'], quantity: 5, unitCost: 100 }]
        })
        .expect(201);

      expect(res.body.status).toBe('delivered');
      expect(res.body.deliveredAt).not.toBeNull();

      // Stock incremented at delivery (100 seeded → 105)
      const inventory = await Inventory.findOne({ productId: products['blanco-chico'] });
      expect(inventory?.quantity).toBe(105);

      // 'purchase' transaction logged
      const tx = await StockTransaction.findOne({ productId: products['blanco-chico'], type: 'purchase' });
      expect(tx).not.toBeNull();
      expect(tx?.quantity).toBe(5);

      // No prior cost → WAC takes this purchase's per-maple cost
      const product = await Product.findById(products['blanco-chico']);
      expect(product?.costPrice).toBe(100);
    });

    it('accepts optional payment info at creation: full → paid, partial → partial', async () => {
      const supplier = await createSupplier();

      // Full payment
      const full = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 2, unitCost: 100 }], // total 200
          paymentMethod: 'cash',
          paidAmount: 200
        })
        .expect(201);
      expect(full.body.paymentStatus).toBe('paid');
      expect(full.body.paymentMethod).toBe('cash');
      expect(full.body.paidAmount).toBe(200);

      // Partial payment
      const partial = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 2, unitCost: 100 }], // total 200
          paymentMethod: 'transfer',
          paidAmount: 80,
          forceDuplicate: true
        })
        .expect(201);
      expect(partial.body.paymentStatus).toBe('partial');
      expect(partial.body.paymentMethod).toBe('transfer');
      expect(partial.body.paidAmount).toBe(80);
    });

    it('derives account from paymentMethod at creation (cash → cash) (R4)', async () => {
      const supplier = await createSupplier();

      const res = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 2, unitCost: 100 }], // total 200
          paymentMethod: 'cash',
          paidAmount: 200
        })
        .expect(201);

      expect(res.body.account).toBe('cash');
    });

    it('accepts an account override at creation (transfer → bank)', async () => {
      const supplier = await createSupplier();

      const res = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 2, unitCost: 100 }], // total 200
          paymentMethod: 'transfer',
          paidAmount: 200,
          account: 'bank'
        })
        .expect(201);

      expect(res.body.account).toBe('bank');
    });

    it('leaves account null when created without payment info', async () => {
      const supplier = await createSupplier();

      const res = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 2, unitCost: 100 }]
        })
        .expect(201);

      expect(res.body.account).toBeNull();
    });

    it('returns 400 when paidAmount exceeds totalCost at creation', async () => {
      const supplier = await createSupplier();

      await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 2, unitCost: 100 }], // total 200
          paidAmount: 300
        })
        .expect(400);
    });

    it('returns 409 when the supplier is inactive (R1)', async () => {
      const supplier = await createSupplier({ active: false });

      await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 1, unitCost: 50 }]
        })
        .expect(409);
    });

    it('returns 404 when the product is unknown (R1)', async () => {
      const supplier = await createSupplier();

      await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: '507f1f77bcf86cd799439011', quantity: 1, unitCost: 50 }]
        })
        .expect(404);
    });

    it('returns 400 for quantity <= 0, unitCost <= 0 or invalid unit (R1)', async () => {
      const supplier = await createSupplier();

      await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 0, unitCost: 50 }]
        })
        .expect(400);

      await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 2, unitCost: 0 }]
        })
        .expect(400);

      await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 2, unit: 'crate', unitCost: 50 }]
        })
        .expect(400);

      await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], unitCost: 50 }]
        })
        .expect(400);
    });

    it('returns 404 when the supplier is unknown', async () => {
      await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: '507f1f77bcf86cd799439011',
          items: [{ productId: products['blanco-chico'], quantity: 1, unitCost: 50 }]
        })
        .expect(404);
    });

    it('ignores client subtotal/totalCost and recomputes them server-side', async () => {
      const supplier = await createSupplier();

      const res = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [
            { productId: products['blanco-chico'], quantity: 2, unitCost: 100, subtotal: 1 },
            { productId: products['castaño-chico'], quantity: 3, unitCost: 50, subtotal: 1 }
          ],
          totalCost: 1
        })
        .expect(201);

      expect(res.body.totalCost).toBe(350); // 2*100 + 3*50
      expect(res.body.items[0].subtotal).toBe(200);
      expect(res.body.items[1].subtotal).toBe(150);
    });
  });

  describe('PATCH /api/v1/purchases/:id/deliver — stock entry point', () => {
    it('delivers a pending purchase: stock incremented (maples), deliveredAt set, costPrice updated', async () => {
      const supplier = await createSupplier();
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 5, unitCost: 100 }]
        })
        .expect(201);

      const res = await request
        .patch(`/api/v1/purchases/${created.body._id}/deliver`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.status).toBe('delivered');
      expect(res.body.deliveredAt).not.toBeNull();

      // Stock incremented (100 seeded → 105)
      const inventory = await Inventory.findOne({ productId: products['blanco-chico'] });
      expect(inventory?.quantity).toBe(105);

      // 'purchase' transaction logged in maples
      const tx = await StockTransaction.findOne({ productId: products['blanco-chico'], type: 'purchase' });
      expect(tx).not.toBeNull();
      expect(tx?.quantity).toBe(5);
      // Reliable link back to the source purchase (notes are display-only).
      expect(tx?.purchaseId?.toString()).toBe(created.body._id);

      // WAC updated on delivery (no prior cost → purchase cost)
      const product = await Product.findById(products['blanco-chico']);
      expect(product?.costPrice).toBe(100);
    });

    it('delivers a cajón purchase in maples: 12 cajones × 12 = 144 maples', async () => {
      const supplier = await createSupplier();
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 12, unit: 'cajon', unitCost: 1200 }]
        })
        .expect(201);

      await request
        .patch(`/api/v1/purchases/${created.body._id}/deliver`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const inventory = await Inventory.findOne({ productId: products['blanco-chico'] });
      expect(inventory?.quantity).toBe(244); // 100 + 144

      const tx = await StockTransaction.findOne({ productId: products['blanco-chico'], type: 'purchase' });
      expect(tx?.quantity).toBe(144);
    });

    it('delivers a medio cajón purchase in maples: 4 medio cajones × 6 = 24 maples, cost per maple', async () => {
      const supplier = await createSupplier();
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 4, unit: 'medio_cajon', unitCost: 600 }]
        })
        .expect(201);

      await request
        .patch(`/api/v1/purchases/${created.body._id}/deliver`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Stock incremented by the maple equivalent (100 + 24)
      const inventory = await Inventory.findOne({ productId: products['blanco-chico'] });
      expect(inventory?.quantity).toBe(124);

      const tx = await StockTransaction.findOne({ productId: products['blanco-chico'], type: 'purchase' });
      expect(tx?.quantity).toBe(24);

      // No prior cost → WAC takes this purchase's per-maple cost (600 ÷ 6)
      const product = await Product.findById(products['blanco-chico']);
      expect(product?.costPrice).toBe(100);
    });

    it('returns 409 when already delivered', async () => {
      const supplier = await createSupplier();
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          delivered: true,
          items: [{ productId: products['blanco-chico'], quantity: 1, unitCost: 100 }]
        })
        .expect(201);

      await request
        .patch(`/api/v1/purchases/${created.body._id}/deliver`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });

    it('returns 409 when cancelled (deliver after cancel)', async () => {
      const supplier = await createSupplier();
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 1, unitCost: 100 }]
        })
        .expect(201);

      await request
        .patch(`/api/v1/purchases/${created.body._id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request
        .patch(`/api/v1/purchases/${created.body._id}/deliver`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);

      // Stock untouched
      const inventory = await Inventory.findOne({ productId: products['blanco-chico'] });
      expect(inventory?.quantity).toBe(100);
    });

    it('returns 404 for an unknown purchase', async () => {
      await request
        .patch('/api/v1/purchases/507f1f77bcf86cd799439011/deliver')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('Weighted average cost (WAC) on delivery', () => {
    /** Overrides the seeded inventory/cost so a test controls the prior stock. */
    const setPriorStock = async (productId: string, quantity: number, costPrice: number | null) => {
      await Inventory.updateOne({ productId }, { quantity });
      await Product.updateOne({ _id: productId }, { costPrice });
    };

    const createAndDeliver = async (items: Record<string, unknown>[]) => {
      const supplier = await createSupplier();
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ supplierId: String(supplier._id), items })
        .expect(201);
      await request
        .patch(`/api/v1/purchases/${created.body._id}/deliver`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      return created.body._id as string;
    };

    it('first delivered purchase with no prior stock takes the purchase cost', async () => {
      await setPriorStock(products['blanco-chico']!, 0, null);

      await createAndDeliver([{ productId: products['blanco-chico'], quantity: 5, unitCost: 100 }]);

      const product = await Product.findById(products['blanco-chico']);
      expect(product?.costPrice).toBe(100);
    });

    it('second delivered purchase with existing stock reweights: 12 @ 4416.67 then 12 @ 4750 → 4583.34', async () => {
      await setPriorStock(products['blanco-chico']!, 12, 4416.67);

      await createAndDeliver([{ productId: products['blanco-chico'], quantity: 12, unitCost: 4750 }]);

      // (12 × 4416.67 + 12 × 4750) ÷ 24 = 4583.335 → rounded to 2 decimals
      const product = await Product.findById(products['blanco-chico']);
      expect(product?.costPrice).toBe(4583.34);

      const inventory = await Inventory.findOne({ productId: products['blanco-chico'] });
      expect(inventory?.quantity).toBe(24);
    });

    it('resets to the purchase cost when there is no prior stock even if an old cost exists', async () => {
      await setPriorStock(products['blanco-chico']!, 0, 9999);

      await createAndDeliver([{ productId: products['blanco-chico'], quantity: 10, unitCost: 2500 }]);

      const product = await Product.findById(products['blanco-chico']);
      expect(product?.costPrice).toBe(2500);
    });

    it('computes each item of a multi-item purchase independently', async () => {
      await setPriorStock(products['blanco-chico']!, 10, 100); // → (10×100 + 10×200)/20 = 150
      await setPriorStock(products['castaño-chico']!, 0, null); // → fresh cost 300

      await createAndDeliver([
        { productId: products['blanco-chico'], quantity: 10, unitCost: 200 },
        { productId: products['castaño-chico'], quantity: 4, unitCost: 300 }
      ]);

      const blanco = await Product.findById(products['blanco-chico']);
      const castaño = await Product.findById(products['castaño-chico']);
      expect(blanco?.costPrice).toBe(150);
      expect(castaño?.costPrice).toBe(300);
    });

    it('reweights a medio cajón delivery by its per-maple cost (WAC)', async () => {
      // 12 maples @ $400 prior stock, then 4 medio cajones = 24 maples @ $100/maple
      await setPriorStock(products['blanco-chico']!, 12, 400);

      await createAndDeliver([
        { productId: products['blanco-chico'], quantity: 4, unit: 'medio_cajon', unitCost: 600 }
      ]);

      // (12 × 400 + 24 × 100) ÷ 36 = 200
      const product = await Product.findById(products['blanco-chico']);
      expect(product?.costPrice).toBe(200);

      const inventory = await Inventory.findOne({ productId: products['blanco-chico'] });
      expect(inventory?.quantity).toBe(36);
    });
  });

  describe('Delivery atomicity — no phantom purchase, payments or stock', () => {
    it('delivered create with one product lacking inventory succeeds and creates the record', async () => {
      const supplier = await createSupplier();
      // Product exists but has NO inventory record (the production incident).
      const orphan = await Product.create({ variety: 'blanco', caliber: 'surtido', eggsPerMaple: 30 });

      const res = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          delivered: true,
          items: [
            { productId: products['blanco-chico'], quantity: 5, unitCost: 100 },
            { productId: orphan._id.toString(), quantity: 5, unitCost: 100 }
          ],
          // A payment line that is stored embedded in the purchase document.
          payments: [{ method: 'transfer', amount: 400 }]
        })
        .expect(201);

      // The purchase is fully delivered.
      expect(res.body.status).toBe('delivered');
      expect(res.body.deliveredAt).not.toBeNull();
      expect(await Purchase.countDocuments()).toBe(1);
      expect(await Payment.countDocuments()).toBe(0);

      // The existing record was incremented; the orphan record was born with
      // the purchased quantity on the first stock entry.
      expect((await Inventory.findOne({ productId: products['blanco-chico'] }))?.quantity).toBe(105);
      const orphanInventory = await Inventory.findOne({ productId: orphan._id });
      expect(orphanInventory?.quantity).toBe(5);

      // Exactly one 'purchase' ledger entry per item.
      expect(await StockTransaction.countDocuments({ type: 'purchase' })).toBe(2);
      const orphanTxns = await StockTransaction.find({ productId: orphan._id });
      expect(orphanTxns).toHaveLength(1);
      expect(orphanTxns[0]!.type).toBe('purchase');
      expect(orphanTxns[0]!.quantity).toBe(5);
    });

    it('delivered create with all items valid increments stock and reweights cost exactly once', async () => {
      const supplier = await createSupplier();

      const res = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          delivered: true,
          items: [
            { productId: products['blanco-chico'], quantity: 5, unitCost: 100 },
            { productId: products['castaño-chico'], quantity: 10, unitCost: 50 }
          ]
        })
        .expect(201);

      expect(res.body.status).toBe('delivered');
      expect(res.body.deliveredAt).not.toBeNull();

      const blancoInventory = await Inventory.findOne({ productId: products['blanco-chico'] });
      const castañoInventory = await Inventory.findOne({ productId: products['castaño-chico'] });
      expect(blancoInventory?.quantity).toBe(105);
      expect(castañoInventory?.quantity).toBe(110);

      // No prior cost → WAC takes this purchase's per-maple cost, exactly once.
      expect((await Product.findById(products['blanco-chico']))?.costPrice).toBe(100);
      expect((await Product.findById(products['castaño-chico']))?.costPrice).toBe(50);

      // One 'purchase' ledger entry per item — no duplicates.
      expect(await StockTransaction.countDocuments({ type: 'purchase' })).toBe(2);
      expect(
        await StockTransaction.countDocuments({ productId: products['blanco-chico'], type: 'purchase' })
      ).toBe(1);
    });

    it('deliverPurchase creates a missing inventory record instead of failing', async () => {
      const supplier = await createSupplier();
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [
            { productId: products['blanco-chico'], quantity: 5, unitCost: 100 },
            { productId: products['castaño-chico'], quantity: 10, unitCost: 50 }
          ]
        })
        .expect(201);

      const purchaseId = created.body._id as string;
      // Simulate the incident: the record never existed for this product.
      await Inventory.deleteOne({ productId: products['castaño-chico'] });

      const delivered = await request
        .patch(`/api/v1/purchases/${purchaseId}/deliver`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(delivered.body.status).toBe('delivered');
      expect(delivered.body.deliveredAt).not.toBeNull();

      // The missing record is created with exactly the delivered quantity.
      const castañoInventory = await Inventory.findOne({ productId: products['castaño-chico'] });
      expect(castañoInventory?.quantity).toBe(10);
      expect((await Inventory.findOne({ productId: products['blanco-chico'] }))?.quantity).toBe(105);
      expect((await Product.findById(products['blanco-chico']))?.costPrice).toBe(100);
      expect((await Product.findById(products['castaño-chico']))?.costPrice).toBe(50);
      // Exactly one 'purchase' entry per product.
      expect(await StockTransaction.countDocuments({ type: 'purchase' })).toBe(2);
    });

    it('applyDelivery compensates every applied item and leaves the purchase pending when a later step fails', async () => {
      const supplier = await createSupplier();
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [
            { productId: products['blanco-chico'], quantity: 5, unitCost: 100 },
            { productId: products['castaño-chico'], quantity: 10, unitCost: 50 }
          ]
        })
        .expect(201);

      const purchase = await Purchase.findById(created.body._id);
      expect(purchase).not.toBeNull();

      // castaño has NO inventory record before the delivery: the increment will
      // create it, so the rollback must delete it instead of zeroing it.
      await Inventory.deleteOne({ productId: products['castaño-chico'] });

      // Inject a failure after the LAST item was applied, so both items have
      // already changed stock/cost when compensation kicks in.
      await expect(
        applyDelivery(purchase!, 'test-user', {
          afterItemApplied: (index) => {
            if (index === purchase!.items.length - 1) {
              throw new Error('boom');
            }
          }
        })
      ).rejects.toThrow('boom');

      // Existing record restored to its exact pre-write value; the record the
      // delivery created is gone, leaving no trace.
      expect((await Inventory.findOne({ productId: products['blanco-chico'] }))?.quantity).toBe(100);
      expect(await Inventory.findOne({ productId: products['castaño-chico'] })).toBeNull();
      expect((await Product.findById(products['blanco-chico']))?.costPrice).toBeNull();
      expect((await Product.findById(products['castaño-chico']))?.costPrice).toBeNull();

      // Append-only ledger: 2 purchase increments + 2 compensating adjustments.
      const purchaseTxs = await StockTransaction.find({ type: 'purchase' });
      const reversals = await StockTransaction.find({ type: 'adjustment' });
      expect(purchaseTxs).toHaveLength(2);
      expect(reversals).toHaveLength(2);
      expect(
        reversals.every(
          (tx) => tx.quantity < 0 && tx.notes.includes('Reversión entrega de compra')
        )
      ).toBe(true);

      // The delivery was never persisted.
      const reloaded = await Purchase.findById(created.body._id);
      expect(reloaded?.status).toBe('pending');
      expect(reloaded?.deliveredAt).toBeNull();
    });
  });

  describe('PATCH /api/v1/purchases/:id/cancel — pending only', () => {
    it('cancels a pending purchase (no stock impact)', async () => {
      const supplier = await createSupplier();
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 5, unitCost: 100 }]
        })
        .expect(201);

      const res = await request
        .patch(`/api/v1/purchases/${created.body._id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.status).toBe('cancelled');
      expect(res.body.deliveredAt).toBeNull();

      const inventory = await Inventory.findOne({ productId: products['blanco-chico'] });
      expect(inventory?.quantity).toBe(100);
    });

    it('returns 409 when already cancelled', async () => {
      const supplier = await createSupplier();
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 1, unitCost: 100 }]
        })
        .expect(201);

      await request
        .patch(`/api/v1/purchases/${created.body._id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request
        .patch(`/api/v1/purchases/${created.body._id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });

    it('returns 409 when already delivered', async () => {
      const supplier = await createSupplier();
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          delivered: true,
          items: [{ productId: products['blanco-chico'], quantity: 1, unitCost: 100 }]
        })
        .expect(201);

      await request
        .patch(`/api/v1/purchases/${created.body._id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });
  });

  describe('PATCH /api/v1/purchases/:id/payment — payment tracking', () => {
    const seedPaid = async (paidAmount: number) => {
      const supplier = await createSupplier();
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 2, unitCost: 100 }], // total 200
          paymentMethod: paidAmount > 0 ? 'cash' : undefined,
          paidAmount: paidAmount > 0 ? paidAmount : undefined
        })
        .expect(201);
      return created.body._id;
    };

    it('full payment → status paid, balance 0', async () => {
      const id = await seedPaid(0);

      const res = await request
        .patch(`/api/v1/purchases/${id}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ method: 'check', amount: 200 })
        .expect(200);

      expect(res.body.paidAmount).toBe(200);
      expect(res.body.paymentMethod).toBe('check');
      expect(res.body.paymentStatus).toBe('paid');
    });

    it('partial payment → status partial, balance remains', async () => {
      const id = await seedPaid(0);

      const res = await request
        .patch(`/api/v1/purchases/${id}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ method: 'transfer', amount: 80 })
        .expect(200);

      expect(res.body.paidAmount).toBe(80);
      expect(res.body.paymentMethod).toBe('transfer');
      expect(res.body.paymentStatus).toBe('partial');
    });

    it('derives account from method on recordPayment (check → bank) (R4)', async () => {
      const id = await seedPaid(0);

      const res = await request
        .patch(`/api/v1/purchases/${id}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ method: 'check', amount: 200 })
        .expect(200);

      expect(res.body.account).toBe('bank');
    });

    it('accepts an account override on recordPayment (transfer → bank)', async () => {
      const id = await seedPaid(0);

      const res = await request
        .patch(`/api/v1/purchases/${id}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ method: 'transfer', amount: 200, account: 'bank' })
        .expect(200);

      expect(res.body.account).toBe('bank');
    });

    it('accumulates payments across calls (partial → paid)', async () => {
      const id = await seedPaid(0);

      await request
        .patch(`/api/v1/purchases/${id}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ method: 'cash', amount: 80 })
        .expect(200);

      const res = await request
        .patch(`/api/v1/purchases/${id}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ method: 'cash', amount: 120 })
        .expect(200);

      expect(res.body.paidAmount).toBe(200);
      expect(res.body.paymentStatus).toBe('paid');
    });

    it('overpayment → 400 (amount exceeds remaining balance)', async () => {
      const id = await seedPaid(80);

      await request
        .patch(`/api/v1/purchases/${id}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ method: 'cash', amount: 200 }) // balance is 120
        .expect(400);
    });

    it('negative/zero amount → 400', async () => {
      const id = await seedPaid(0);

      await request
        .patch(`/api/v1/purchases/${id}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ method: 'cash', amount: -50 })
        .expect(400);

      await request
        .patch(`/api/v1/purchases/${id}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ method: 'cash', amount: 0 })
        .expect(400);
    });

    it('invalid method → 400', async () => {
      const id = await seedPaid(0);

      await request
        .patch(`/api/v1/purchases/${id}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ method: 'bitcoin', amount: 50 })
        .expect(400);
    });

    it('returns 409 on a cancelled purchase', async () => {
      const id = await seedPaid(0);
      await request
        .patch(`/api/v1/purchases/${id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request
        .patch(`/api/v1/purchases/${id}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ method: 'cash', amount: 50 })
        .expect(409);
    });

    it('allows payments on delivered purchases', async () => {
      const supplier = await createSupplier();
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          delivered: true,
          items: [{ productId: products['blanco-chico'], quantity: 2, unitCost: 100 }]
        })
        .expect(201);

      const res = await request
        .patch(`/api/v1/purchases/${created.body._id}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ method: 'cash', amount: 100 })
        .expect(200);

      expect(res.body.status).toBe('delivered');
      expect(res.body.paymentStatus).toBe('partial');
    });
  });

  describe('PATCH /api/v1/purchases/:id/payment — split (itemised) payments', () => {
    const seedUnpaid = async () => {
      const supplier = await createSupplier();
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 2, unitCost: 100 }] // total 200
        })
        .expect(201);
      return created.body._id as string;
    };

    it('records a split payment cash 50 + MP 50: Σ paidAmount, 2 lines, shared groupId, per-line account', async () => {
      const supplier = await createSupplier();
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 4, unitCost: 100 }] // total 400
        })
        .expect(201);

      const res = await request
        .patch(`/api/v1/purchases/${created.body._id}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          payments: [
            { method: 'cash', amount: 50 },
            { method: 'transfer', amount: 50 }
          ]
        })
        .expect(200);

      expect(res.body.paidAmount).toBe(100);
      expect(res.body.paymentStatus).toBe('partial');
      expect(res.body.payments).toHaveLength(2);
      expect(res.body.payments[0]).toMatchObject({ method: 'cash', account: 'cash', amount: 50 });
      expect(res.body.payments[1]).toMatchObject({ method: 'transfer', account: 'mp', amount: 50 });
      // All lines of one "pago" action share the same groupId
      expect(res.body.payments[0].groupId).toBeTruthy();
      expect(res.body.payments[0].groupId).toBe(res.body.payments[1].groupId);
      // Back-compat scalars reflect the LAST line
      expect(res.body.paymentMethod).toBe('transfer');
      expect(res.body.account).toBe('mp');
    });

    it('honours a per-line account override and an explicit groupId', async () => {
      const id = await seedUnpaid();

      const res = await request
        .patch(`/api/v1/purchases/${id}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          groupId: 'grp-123',
          payments: [
            { method: 'cash', amount: 30 },
            { method: 'transfer', amount: 20, account: 'bank', reference: 'MP-9988' }
          ]
        })
        .expect(200);

      expect(res.body.payments).toHaveLength(2);
      expect(res.body.payments[1]).toMatchObject({
        method: 'transfer',
        account: 'bank',
        amount: 20,
        reference: 'MP-9988'
      });
      expect(res.body.payments.every((p: { groupId: string }) => p.groupId === 'grp-123')).toBe(true);
    });

    it('rejects Σ(lines) > balance with 400', async () => {
      const id = await seedUnpaid(); // balance 200

      const res = await request
        .patch(`/api/v1/purchases/${id}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          payments: [
            { method: 'cash', amount: 150 },
            { method: 'transfer', amount: 100 } // Σ 250 > 200
          ]
        })
        .expect(400);

      expect(res.body.error).toContain('Amount exceeds the remaining balance');
    });

    it('rejects a line with amount <= 0 with 400', async () => {
      const id = await seedUnpaid();

      await request
        .patch(`/api/v1/purchases/${id}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ payments: [{ method: 'cash', amount: 0 }] })
        .expect(400);

      await request
        .patch(`/api/v1/purchases/${id}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ payments: [{ method: 'cash', amount: -5 }] })
        .expect(400);
    });

    it('keeps the legacy single-method payload working (normalised to a 1-line array)', async () => {
      const id = await seedUnpaid();

      const res = await request
        .patch(`/api/v1/purchases/${id}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ method: 'check', amount: 120 })
        .expect(200);

      expect(res.body.paidAmount).toBe(120);
      expect(res.body.paymentStatus).toBe('partial');
      expect(res.body.paymentMethod).toBe('check');
      expect(res.body.account).toBe('bank');
      expect(res.body.payments).toHaveLength(1);
      expect(res.body.payments[0]).toMatchObject({ method: 'check', account: 'bank', amount: 120 });
    });

    it('exposes payments[] in PurchaseDetail', async () => {
      const id = await seedUnpaid();

      await request
        .patch(`/api/v1/purchases/${id}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ payments: [{ method: 'cash', amount: 50 }, { method: 'transfer', amount: 50 }] })
        .expect(200);

      const res = await request
        .get(`/api/v1/purchases/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.payments).toHaveLength(2);
      expect(res.body.payments[0]).toMatchObject({ method: 'cash', account: 'cash', amount: 50 });
      expect(res.body.payments[1]).toMatchObject({ method: 'transfer', account: 'mp', amount: 50 });
      expect(res.body.paidAmount).toBe(100);
      expect(res.body.balance).toBe(100);
    });

    it('creates a purchase with multiple payment lines at creation', async () => {
      const supplier = await createSupplier();

      const res = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 4, unitCost: 100 }], // total 400
          payments: [
            { method: 'cash', amount: 50 },
            { method: 'transfer', amount: 50 }
          ]
        })
        .expect(201);

      expect(res.body.paidAmount).toBe(100);
      expect(res.body.paymentStatus).toBe('partial');
      expect(res.body.payments).toHaveLength(2);
      expect(res.body.payments[0].groupId).toBe(res.body.payments[1].groupId);
      expect(res.body.payments[0]).toMatchObject({ method: 'cash', account: 'cash', amount: 50 });
      expect(res.body.payments[1]).toMatchObject({ method: 'transfer', account: 'mp', amount: 50 });
    });

    it('rejects creation payments whose Σ exceeds the total cost (400)', async () => {
      const supplier = await createSupplier();

      await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 2, unitCost: 100 }], // total 200
          payments: [
            { method: 'cash', amount: 150 },
            { method: 'transfer', amount: 100 } // Σ 250 > 200
          ]
        })
        .expect(400);
    });
  });

  describe('GET /api/v1/purchases — list with filters (R2)', () => {
    it('filters by supplierId and date range', async () => {
      const supplierA = await createSupplier({ name: 'Granja A' });
      const supplierB = await createSupplier({ name: 'Granja B' });

      const base = {
        date: '2026-09-29',
        items: [{ productId: products['blanco-chico'], quantity: 1, unitCost: 100 }]
      };
      await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...base, supplierId: String(supplierA._id) })
        .expect(201);
      await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...base, supplierId: String(supplierA._id), date: '2026-09-28', forceDuplicate: true })
        .expect(201);
      await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...base, supplierId: String(supplierB._id) })
        .expect(201);

      // By supplier
      const bySupplier = await request
        .get(`/api/v1/purchases?supplierId=${String(supplierA._id)}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(bySupplier.body).toHaveLength(2);
      expect(bySupplier.body.every((p: { supplierId: string | { _id: string } }) => {
        const supplierId = typeof p.supplierId === 'object' ? p.supplierId._id : p.supplierId;
        return String(supplierId) === String(supplierA._id);
      })).toBe(true);

      // By date range (from=2026-09-29 onward)
      const byDate = await request
        .get('/api/v1/purchases?from=2026-09-29&to=2026-09-30')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(byDate.body).toHaveLength(2);

      // Combined
      const combined = await request
        .get(`/api/v1/purchases?supplierId=${String(supplierA._id)}&from=2026-09-29&to=2026-09-30`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(combined.body).toHaveLength(1);
    });

    it('filters by status', async () => {
      const supplier = await createSupplier();
      const base = {
        supplierId: String(supplier._id),
        items: [{ productId: products['blanco-chico'], quantity: 1, unitCost: 100 }]
      };
      await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(base)
        .expect(201);
      const delivered = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...base, delivered: true, forceDuplicate: true })
        .expect(201);
      const cancelled = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...base, forceDuplicate: true })
        .expect(201);
      await request
        .patch(`/api/v1/purchases/${cancelled.body._id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const pendingList = await request
        .get('/api/v1/purchases?status=pending')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(pendingList.body).toHaveLength(1);

      const deliveredList = await request
        .get('/api/v1/purchases?status=delivered')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(deliveredList.body).toHaveLength(1);
      expect(deliveredList.body[0]._id).toBe(delivered.body._id);

      const cancelledList = await request
        .get('/api/v1/purchases?status=cancelled')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(cancelledList.body).toHaveLength(1);
    });

    it('populates the supplier in list responses', async () => {
      const supplier = await createSupplier({ name: 'Granja Poblada' });
      await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 1, unitCost: 100 }]
        })
        .expect(201);

      const res = await request
        .get('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body[0].supplierId.name).toBe('Granja Poblada');
    });
  });

  describe('GET /api/v1/purchases/:id — detail with margin + lifecycle (R2)', () => {
    it('returns items with margin = activePrice − unitCostPerMaple and lifecycle fields', async () => {
      const supplier = await createSupplier();
      // Blanco active price is 25 (seeded) → unitCost 20 → margin 5
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 10, unitCost: 20 }]
        })
        .expect(201);

      const res = await request
        .get(`/api/v1/purchases/${created.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.supplierName).toBe('Granja Test');
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].margin).toBe(5);
      expect(res.body.items[0].unit).toBe('maple');
      expect(res.body.items[0].quantity).toBe(10);
      expect(res.body.items[0].quantityMaples).toBe(10);
      expect(res.body.items[0].unitCostPerMaple).toBe(20);
      expect(res.body.items[0].subtotal).toBe(200);

      // Lifecycle + payment fields
      expect(res.body.status).toBe('pending');
      expect(res.body.deliveredAt).toBeNull();
      expect(res.body.paymentStatus).toBe('unpaid');
      expect(res.body.paidAmount).toBe(0);
      expect(res.body.balance).toBe(200);
    });

    it('returns margin per maple for cajón items (active maple price − per-maple cost)', async () => {
      const supplier = await createSupplier();
      // 2 cajones at $480/cajón → $40/maple; active maple price 25 → margin −15
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 2, unit: 'cajon', unitCost: 480 }]
        })
        .expect(201);

      const res = await request
        .get(`/api/v1/purchases/${created.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.items[0]).toMatchObject({
        unit: 'cajon',
        quantity: 2,
        quantityMaples: 24,
        unitCost: 480,
        unitCostPerMaple: 40,
        margin: -15
      });
    });

    it('detail reflects payment balance after partial payment', async () => {
      const supplier = await createSupplier();
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 10, unitCost: 20 }] // total 200
        })
        .expect(201);

      await request
        .patch(`/api/v1/purchases/${created.body._id}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ method: 'cash', amount: 120 })
        .expect(200);

      const res = await request
        .get(`/api/v1/purchases/${created.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.paidAmount).toBe(120);
      expect(res.body.paymentStatus).toBe('partial');
      expect(res.body.balance).toBe(80);
    });

    it('returns 404 for an unknown purchase', async () => {
      await request
        .get('/api/v1/purchases/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('PATCH /api/v1/purchases/:id — edit pending only', () => {
    it('edits a pending purchase: items/totals recomputed server-side', async () => {
      const supplier = await createSupplier();
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 2, unitCost: 100 }], // total 200
          notes: 'Antes'
        })
        .expect(201);

      const res = await request
        .patch(`/api/v1/purchases/${created.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [
            { productId: products['blanco-chico'], quantity: 3, unitCost: 120 },
            { productId: products['castaño-chico'], quantity: 1, unit: 'cajon', unitCost: 2400 }
          ],
          notes: 'Después'
        })
        .expect(200);

      expect(res.body.notes).toBe('Después');
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0]).toMatchObject({ unit: 'maple', quantity: 3, quantityMaples: 3, unitCostPerMaple: 120, subtotal: 360 });
      expect(res.body.items[1]).toMatchObject({ unit: 'cajon', quantity: 1, quantityMaples: 12, unitCostPerMaple: 200, subtotal: 2400 });
      expect(res.body.totalCost).toBe(2760);
      expect(res.body.status).toBe('pending');

      // No stock impact on edit
      const inventory = await Inventory.findOne({ productId: products['blanco-chico'] });
      expect(inventory?.quantity).toBe(100);
    });

    it('edits supplier/date/notes without touching items', async () => {
      const supplierA = await createSupplier({ name: 'Granja A' });
      const supplierB = await createSupplier({ name: 'Granja B' });
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplierA._id),
          items: [{ productId: products['blanco-chico'], quantity: 2, unitCost: 100 }]
        })
        .expect(201);

      const res = await request
        .patch(`/api/v1/purchases/${created.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ supplierId: String(supplierB._id), date: '2026-09-30', notes: 'Cambiada' })
        .expect(200);

      expect(res.body.supplierId.toString()).toBe(String(supplierB._id));
      expect(res.body.notes).toBe('Cambiada');
      expect(res.body.items).toHaveLength(1); // items untouched
      expect(res.body.totalCost).toBe(200);
    });

    it('returns 409 when the purchase is already delivered', async () => {
      const supplier = await createSupplier();
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          delivered: true,
          items: [{ productId: products['blanco-chico'], quantity: 2, unitCost: 100 }]
        })
        .expect(201);

      await request
        .patch(`/api/v1/purchases/${created.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'nope' })
        .expect(409);
    });

    it('rejects a new total below paidAmount with 409 and leaves the record unchanged', async () => {
      const supplier = await createSupplier();
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 2, unitCost: 100 }] // total 200
        })
        .expect(201);

      await request
        .patch(`/api/v1/purchases/${created.body._id}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ method: 'cash', amount: 150 })
        .expect(200);

      const res = await request
        .patch(`/api/v1/purchases/${created.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ productId: products['blanco-chico'], quantity: 1, unitCost: 100 }] }) // total 100 < 150
        .expect(409);

      expect(res.body.error).toContain('por debajo de lo ya pagado');

      // Nothing was written: total, items, paidAmount and payment lines intact.
      const purchase = await Purchase.findById(created.body._id);
      expect(purchase).not.toBeNull();
      expect(purchase!.totalCost).toBe(200);
      expect(purchase!.paidAmount).toBe(150);
      expect(purchase!.items).toHaveLength(1);
      expect(purchase!.items[0]!.quantity).toBe(2);
      expect(purchase!.payments).toHaveLength(1);
      expect(purchase!.payments[0]!.amount).toBe(150);
    });

    it('returns 409 when the purchase is cancelled', async () => {
      const supplier = await createSupplier();
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 2, unitCost: 100 }]
        })
        .expect(201);
      await request
        .patch(`/api/v1/purchases/${created.body._id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request
        .patch(`/api/v1/purchases/${created.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'nope' })
        .expect(409);
    });

    it('returns 404 for an unknown purchase', async () => {
      await request
        .patch('/api/v1/purchases/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'x' })
        .expect(404);
    });
  });

  describe('DELETE /api/v1/purchases/:id — pending / cancelled only', () => {
    it('deletes a pending purchase (204) without touching stock', async () => {
      const supplier = await createSupplier();
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 5, unitCost: 100 }]
        })
        .expect(201);

      await request
        .delete(`/api/v1/purchases/${created.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      // No stock change (pending never touched stock)
      const inventory = await Inventory.findOne({ productId: products['blanco-chico'] });
      expect(inventory?.quantity).toBe(100);

      const purchase = await Purchase.findById(created.body._id);
      expect(purchase).toBeNull();
    });

    it('deletes a cancelled purchase (204)', async () => {
      const supplier = await createSupplier();
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 5, unitCost: 100 }]
        })
        .expect(201);
      await request
        .patch(`/api/v1/purchases/${created.body._id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request
        .delete(`/api/v1/purchases/${created.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      const purchase = await Purchase.findById(created.body._id);
      expect(purchase).toBeNull();
    });

    it('returns 409 when the purchase is delivered', async () => {
      const supplier = await createSupplier();
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          delivered: true,
          items: [{ productId: products['blanco-chico'], quantity: 5, unitCost: 100 }]
        })
        .expect(201);

      const res = await request
        .delete(`/api/v1/purchases/${created.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);

      expect(res.body.error).toBe('Cannot delete a delivered purchase');

      // Purchase kept, stock untouched
      const purchase = await Purchase.findById(created.body._id);
      expect(purchase).not.toBeNull();
      const inventory = await Inventory.findOne({ productId: products['blanco-chico'] });
      expect(inventory?.quantity).toBe(105);
    });

    it('returns 409 when deleting a pending purchase with payments, keeping the record', async () => {
      const supplier = await createSupplier();
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 2, unitCost: 100 }]
        })
        .expect(201);
      await request
        .patch(`/api/v1/purchases/${created.body._id}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ method: 'cash', amount: 80 })
        .expect(200);

      const res = await request
        .delete(`/api/v1/purchases/${created.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);

      expect(res.body.error).toContain('compra con pagos registrados');
      const purchase = await Purchase.findById(created.body._id);
      expect(purchase).not.toBeNull();
      expect(purchase!.paidAmount).toBe(80);
      expect(purchase!.payments).toHaveLength(1);
    });

    it('cancels a paid pending purchase and keeps its outflow in the cash ledger', async () => {
      const supplier = await createSupplier();
      const created = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          supplierId: String(supplier._id),
          items: [{ productId: products['blanco-chico'], quantity: 2, unitCost: 100 }]
        })
        .expect(201);
      await request
        .patch(`/api/v1/purchases/${created.body._id}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ method: 'cash', amount: 200 })
        .expect(200);

      const cancelled = await request
        .patch(`/api/v1/purchases/${created.body._id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(cancelled.body.status).toBe('cancelled');
      expect(cancelled.body.paidAmount).toBe(200);
      expect(cancelled.body.payments).toHaveLength(1);

      // The payment line survives the cancellation, so Caja still reports it.
      const ledger = await request
        .get('/api/v1/cash/movements?type=purchase_payment')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const body = ledger.body as {
        total: number;
        movements: Array<{ amount: number; account: string; type: string }>;
      };
      expect(body.total).toBe(1);
      expect(body.movements[0]).toMatchObject({ type: 'purchase_payment', account: 'cash', amount: -200 });
    });

    it('returns 404 for an unknown purchase', async () => {
      await request
        .delete('/api/v1/purchases/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });
  describe('Recent-duplicate guard (5-minute window)', () => {
    it('rejects an identical purchase, consumes no counter and moves no stock; forceDuplicate creates it', async () => {
      const supplier = await createSupplier();
      const productId = products['blanco-chico']!;
      const payload = {
        supplierId: String(supplier._id),
        items: [{ productId, quantity: 2, unitCost: 100 }],
        delivered: true
      };

      const first = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload)
        .expect(201);

      expect(first.body.purchaseNumber).toMatch(/-001$/);
      expect((await Inventory.findOne({ productId }))!.quantity).toBe(102);

      const blocked = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload)
        .expect(409);

      expect(blocked.body).toMatchObject({
        code: 'DUPLICATE_RECORD',
        resource: 'purchase',
        existingId: first.body._id,
        existingNumber: first.body.purchaseNumber
      });
      expect(blocked.body.error).toContain(first.body.purchaseNumber);

      // The blocked attempt created nothing and did not consume a PUR number.
      expect(await Purchase.countDocuments()).toBe(1);
      expect((await Inventory.findOne({ productId }))!.quantity).toBe(102);

      const forced = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...payload, forceDuplicate: true })
        .expect(201);

      expect(forced.body.purchaseNumber).toMatch(/-002$/);
      expect(await Purchase.countDocuments()).toBe(2);
      expect((await Inventory.findOne({ productId }))!.quantity).toBe(104);

      // The fingerprint is persisted on the created purchase.
      const stored = await Purchase.findById(first.body._id);
      expect(stored?.duplicateFingerprint).toBe(
        buildDuplicateFingerprint(String(supplier._id), [
          { productId, quantity: 2, unit: 'maple' }
        ])
      );
    });

    it('does not let a cancelled identical purchase block a new one', async () => {
      const supplier = await createSupplier();
      const payload = {
        supplierId: String(supplier._id),
        items: [{ productId: products['blanco-chico'], quantity: 1, unitCost: 100 }]
      };

      const first = await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload)
        .expect(201);

      await request
        .patch(`/api/v1/purchases/${first.body._id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload)
        .expect(201);

      expect(await Purchase.countDocuments()).toBe(2);
    });
  });

});