import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  loginAs
} from './helpers.js';
import { app } from '../app.js';
import { Promotion } from '../modules/promotions/model.js';
import { PriceEntry } from '../modules/products/price-list-model.js';
import {
  isPromoActive,
  applyPromoPrice,
  resolveBestPromo,
  incrementSold,
  restoreSold
} from '../modules/promotions/service.js';

const request = supertest(app);

const yesterday = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString();
};

const tomorrow = (): string => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString();
};

/** Creates a product via the API and seeds an active maple price for it. */
let pricedProductCounter = 0;
const createPricedProduct = async (token: string, price: number): Promise<string> => {
  const varieties: Array<'blanco' | 'castaño'> = ['blanco', 'castaño'];
  const calibers: Array<'chico' | 'mediano' | 'grande' | 'extragrande' | 'surtido'> =
    ['chico', 'mediano', 'grande', 'extragrande', 'surtido'];
  const variety = varieties[pricedProductCounter % varieties.length]!;
  const caliber = calibers[Math.floor(pricedProductCounter / varieties.length) % calibers.length]!;
  pricedProductCounter++;
  const res = await request
    .post('/api/v1/products')
    .set('Authorization', `Bearer ${token}`)
    .send({ variety, caliber })
    .expect(201);

  const productId = res.body._id as string;
  await PriceEntry.create({ productId, price, unit: 'maple', effectiveFrom: new Date(yesterday()) });
  return productId;
};

/** Creates a promo via the API and returns the created body. */
const createPromo = async (
  token: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const res = await request
    .post('/api/v1/promotions')
    .set('Authorization', `Bearer ${token}`)
    .send(body)
    .expect(201);
  return res.body as Record<string, unknown>;
};

describe('Promotions (T10)', () => {
  let adminToken: string;

  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
    const adminCreds = await seedAdminUser();
    adminToken = await loginAs(request, adminCreds.email, adminCreds.password);
  });

  // ─── CRUD (R1) ──────────────────────────────────────────────────────────

  describe('CRUD', () => {
    it('creates and lists promotions', async () => {
      const productId = await createPricedProduct(adminToken, 1000);

      const promo = await createPromo(adminToken, {
        name: 'Verano',
        productId,
        type: 'fixed_price',
        value: 900,
        unit: 'maple'
      });

      expect(promo.name).toBe('Verano');
      expect(promo.type).toBe('fixed_price');
      expect(promo.value).toBe(900);
      expect(promo.unit).toBe('maple');
      expect(promo.status).toBe('active');
      expect(promo.soldQuantity).toBe(0);
      expect(promo.stockLimit).toBeNull();

      const list = await request
        .get('/api/v1/promotions')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]._id).toBe(promo._id);
    });

    it('rejects an invalid type with 400', async () => {
      const productId = await createPricedProduct(adminToken, 1000);

      const res = await request
        .post('/api/v1/promotions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Bad', productId, type: 'bogo', value: 900 })
        .expect(400);
      expect(res.body.error).toMatch(/fixed_price|discount_percent|buy_x_get_y/);
    });

    it('rejects an unknown product with 404', async () => {
      const res = await request
        .post('/api/v1/promotions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Ghost', productId: '5f0b6b3f1c9d440000000001', type: 'fixed_price', value: 900 })
        .expect(404);
      expect(res.body.error).toMatch(/product/i);
    });

    it('stores getQuantity for buy_x_get_y and defaults absent to null (legacy)', async () => {
      const productId = await createPricedProduct(adminToken, 100);

      const withQty = await createPromo(adminToken, {
        name: 'Paga4Llevas5',
        productId,
        type: 'buy_x_get_y',
        value: 4,
        getQuantity: 5
      });
      expect(withQty.getQuantity).toBe(5);

      const legacy = await createPromo(adminToken, {
        name: 'Legacy2x1',
        productId,
        type: 'buy_x_get_y',
        value: 2
      });
      expect(legacy.getQuantity).toBeNull();
    });

    it('rejects getQuantity <= value with 400', async () => {
      const productId = await createPricedProduct(adminToken, 100);

      const equal = await request
        .post('/api/v1/promotions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Equal', productId, type: 'buy_x_get_y', value: 4, getQuantity: 4 })
        .expect(400);
      expect(equal.body.error).toMatch(/getQuantity must be greater than value/i);

      const lower = await request
        .post('/api/v1/promotions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Lower', productId, type: 'buy_x_get_y', value: 4, getQuantity: 3 })
        .expect(400);
      expect(lower.body.error).toMatch(/getQuantity must be greater than value/i);
    });

    it('rejects getQuantity < 1 and non-integer getQuantity with 400', async () => {
      const productId = await createPricedProduct(adminToken, 100);

      await request
        .post('/api/v1/promotions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Zero', productId, type: 'buy_x_get_y', value: 4, getQuantity: 0 })
        .expect(400);

      await request
        .post('/api/v1/promotions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Decimal', productId, type: 'buy_x_get_y', value: 4, getQuantity: 4.5 })
        .expect(400);
    });

    it('updates getQuantity and clears it back to null', async () => {
      const productId = await createPricedProduct(adminToken, 100);
      const promo = await createPromo(adminToken, {
        name: 'Bogo',
        productId,
        type: 'buy_x_get_y',
        value: 2
      });
      expect(promo.getQuantity).toBeNull();

      const updated = await request
        .put(`/api/v1/promotions/${promo._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ getQuantity: 3 })
        .expect(200);
      expect(updated.body.getQuantity).toBe(3);

      const cleared = await request
        .put(`/api/v1/promotions/${promo._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ getQuantity: null })
        .expect(200);
      expect(cleared.body.getQuantity).toBeNull();
    });

    it('filters the list by status and productId', async () => {
      const productA = await createPricedProduct(adminToken, 1000);
      const productB = await createPricedProduct(adminToken, 500);

      await createPromo(adminToken, { name: 'A1', productId: productA, type: 'fixed_price', value: 900 });
      await createPromo(adminToken, { name: 'B1', productId: productB, type: 'fixed_price', value: 450 });
      const inactive = await createPromo(adminToken, { name: 'A2', productId: productA, type: 'discount_percent', value: 10 });
      await request
        .patch(`/api/v1/promotions/${inactive._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'inactive' })
        .expect(200);

      const byStatus = await request
        .get('/api/v1/promotions?status=inactive')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(byStatus.body).toHaveLength(1);
      expect(byStatus.body[0]._id).toBe(inactive._id);

      const byProduct = await request
        .get(`/api/v1/promotions?productId=${productA}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(byProduct.body).toHaveLength(2);
    });

    it('updates a promotion without resetting status/unit defaults', async () => {
      const productId = await createPricedProduct(adminToken, 1000);
      const promo = await createPromo(adminToken, {
        name: 'Old',
        productId,
        type: 'fixed_price',
        value: 900,
        unit: 'maple'
      });

      // Deactivate, then update only the name — status must stay 'inactive'.
      await request
        .patch(`/api/v1/promotions/${promo._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'inactive' })
        .expect(200);

      const updated = await request
        .put(`/api/v1/promotions/${promo._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'NewName' })
        .expect(200);

      expect(updated.body.name).toBe('NewName');
      expect(updated.body.status).toBe('inactive');
      expect(updated.body.unit).toBe('maple');
    });

    it('clears a stock limit by sending null', async () => {
      const productId = await createPricedProduct(adminToken, 1000);
      const promo = await createPromo(adminToken, {
        name: 'Limited',
        productId,
        type: 'fixed_price',
        value: 900,
        stockLimit: 5
      });
      expect(promo.stockLimit).toBe(5);

      const updated = await request
        .put(`/api/v1/promotions/${promo._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ stockLimit: null })
        .expect(200);
      expect(updated.body.stockLimit).toBeNull();
    });

    it('deactivates and reactivates via PATCH status', async () => {
      const productId = await createPricedProduct(adminToken, 1000);
      const promo = await createPromo(adminToken, {
        name: 'Toggle',
        productId,
        type: 'fixed_price',
        value: 900
      });

      const off = await request
        .patch(`/api/v1/promotions/${promo._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'inactive' })
        .expect(200);
      expect(off.body.status).toBe('inactive');

      const on = await request
        .patch(`/api/v1/promotions/${promo._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'active' })
        .expect(200);
      expect(on.body.status).toBe('active');
    });

    it('404 on unknown promotion (get / status / delete)', async () => {
      const unknown = '5f0b6b3f1c9d440000000001';
      await request.get(`/api/v1/promotions/${unknown}`).set('Authorization', `Bearer ${adminToken}`).expect(404);
      await request.patch(`/api/v1/promotions/${unknown}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'inactive' }).expect(404);
      await request.delete(`/api/v1/promotions/${unknown}`).set('Authorization', `Bearer ${adminToken}`).expect(404);
    });

    it('deletes a promotion (204)', async () => {
      const productId = await createPricedProduct(adminToken, 1000);
      const promo = await createPromo(adminToken, {
        name: 'Gone',
        productId,
        type: 'fixed_price',
        value: 900
      });

      await request
        .delete(`/api/v1/promotions/${promo._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      await request.get(`/api/v1/promotions/${promo._id}`).set('Authorization', `Bearer ${adminToken}`).expect(404);
    });
  });

  // ─── isPromoActive (R2 lifecycle) ───────────────────────────────────────

  describe('isPromoActive', () => {
    it('requires status active', () => {
      expect(isPromoActive({ status: 'inactive', expiresAt: null, stockLimit: null, soldQuantity: 0 })).toBe(false);
      expect(isPromoActive({ status: 'active', expiresAt: null, stockLimit: null, soldQuantity: 0 })).toBe(true);
    });

    it('is inactive when expiresAt is in the past', () => {
      expect(isPromoActive({ status: 'active', expiresAt: new Date(Date.now() - 1000), stockLimit: null, soldQuantity: 0 })).toBe(false);
    });

    it('is active when expiresAt is in the future or absent', () => {
      expect(isPromoActive({ status: 'active', expiresAt: new Date(Date.now() + 86_400_000), stockLimit: null, soldQuantity: 0 })).toBe(true);
      expect(isPromoActive({ status: 'active', expiresAt: null, stockLimit: null, soldQuantity: 0 })).toBe(true);
    });

    it('is inactive once soldQuantity reaches stockLimit', () => {
      expect(isPromoActive({ status: 'active', expiresAt: null, stockLimit: 10, soldQuantity: 10 })).toBe(false);
      expect(isPromoActive({ status: 'active', expiresAt: null, stockLimit: 10, soldQuantity: 9 })).toBe(true);
    });
  });

  // ─── applyPromoPrice (R3 pricing) ───────────────────────────────────────

  describe('applyPromoPrice', () => {
    it('fixed_price group pricing: full groups at group price, leftover units at base', () => {
      // base 6000, "3 x $16.000" → value 16000, group size (minQuantity) 3
      const promo = { type: 'fixed_price', value: 16000, minQuantity: 3 } as const;

      expect(applyPromoPrice(6000, promo, 3)).toEqual({ unitPrice: 5333.33, subtotal: 16000 });
      expect(applyPromoPrice(6000, promo, 4)).toEqual({ unitPrice: 5500, subtotal: 22000 });
      expect(applyPromoPrice(6000, promo, 6)).toEqual({ unitPrice: 5333.33, subtotal: 32000 });
      expect(applyPromoPrice(6000, promo, 7)).toEqual({ unitPrice: 5428.57, subtotal: 38000 });
    });

    it('fixed_price below the group size falls back to the base price', () => {
      const promo = { type: 'fixed_price', value: 16000, minQuantity: 3 } as const;
      expect(applyPromoPrice(6000, promo, 2)).toEqual({ unitPrice: 6000, subtotal: 12000 });
    });

    it('fixed_price legacy (minQuantity null) behaves as qty × value', () => {
      const r = applyPromoPrice(1000, { type: 'fixed_price', value: 900 }, 2);
      expect(r.unitPrice).toBe(900);
      expect(r.subtotal).toBe(1800);

      const r4 = applyPromoPrice(6000, { type: 'fixed_price', value: 16000, minQuantity: null }, 4);
      expect(r4.unitPrice).toBe(16000);
      expect(r4.subtotal).toBe(64000);
    });

    it('discount_percent applies the % off', () => {
      const r = applyPromoPrice(100, { type: 'discount_percent', value: 10 }, 5);
      expect(r.unitPrice).toBe(90);
      expect(r.subtotal).toBe(450);
    });

    it('buy_x_get_y legacy (getQuantity null): totalPerGroup = value + 1, only paid units are charged', () => {
      // value 2 (get 1 free) → group of 3; qty 5 → 1 free, 4 paid × 100 = 400; unit 400/5 = 80
      const r = applyPromoPrice(100, { type: 'buy_x_get_y', value: 2 }, 5);
      expect(r.subtotal).toBe(400);
      expect(r.unitPrice).toBe(80);
    });

    it('buy_x_get_y legacy (getQuantity null): qty 7 value 3 → group of 4, 1 free, 6 paid', () => {
      const r = applyPromoPrice(100, { type: 'buy_x_get_y', value: 3 }, 7);
      expect(r.subtotal).toBe(600);
      expect(r.unitPrice).toBeCloseTo(600 / 7, 2);
    });

    it('buy_x_get_y with getQuantity: pagás 4 llevás 5', () => {
      // value 4, getQuantity 5 → group of 5; qty 5 → 1 free, 4 paid × 100 = 400
      const r5 = applyPromoPrice(100, { type: 'buy_x_get_y', value: 4, getQuantity: 5 }, 5);
      expect(r5.subtotal).toBe(400);
      expect(r5.unitPrice).toBe(80);

      // qty 10 → 2 free, 8 paid × 100 = 800
      const r10 = applyPromoPrice(100, { type: 'buy_x_get_y', value: 4, getQuantity: 5 }, 10);
      expect(r10.subtotal).toBe(800);
      expect(r10.unitPrice).toBe(80);
    });

    it('buy_x_get_y 2x1 (value 1, getQuantity 2): pay 1 take 2', () => {
      // qty 2 → 1 free, 1 paid × 100 = 100
      const r2 = applyPromoPrice(100, { type: 'buy_x_get_y', value: 1, getQuantity: 2 }, 2);
      expect(r2.subtotal).toBe(100);
      expect(r2.unitPrice).toBe(50);

      // qty 5 → 2 free, 3 paid × 100 = 300
      const r5 = applyPromoPrice(100, { type: 'buy_x_get_y', value: 1, getQuantity: 2 }, 5);
      expect(r5.subtotal).toBe(300);
      expect(r5.unitPrice).toBe(60);
    });

    it('buy_x_get_y legacy at group boundary: value 3 → pay 3 take 4', () => {
      const r = applyPromoPrice(100, { type: 'buy_x_get_y', value: 3 }, 4);
      expect(r.subtotal).toBe(300);
      expect(r.unitPrice).toBe(75);
    });
  });

  // ─── resolveBestPromo (most favorable) ──────────────────────────────────

  describe('resolveBestPromo', () => {
    it('returns null when no promo exists', async () => {
      const productId = await createPricedProduct(adminToken, 1000);
      expect(await resolveBestPromo(productId, 'maple', 2)).toBeNull();
    });

    it('returns null when there is no active base price', async () => {
      const res = await request
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ variety: 'blanco', caliber: 'chico' })
        .expect(201);
      const productId = res.body._id as string;
      await createPromo(adminToken, { name: 'Orphan', productId, type: 'fixed_price', value: 900 });
      expect(await resolveBestPromo(productId, 'maple', 2)).toBeNull();
    });

    it('picks the lowest effective price (fixed 900 beats 5% discount on 1000)', async () => {
      const productId = await createPricedProduct(adminToken, 1000);

      const discount = await createPromo(adminToken, { name: 'FiveOff', productId, type: 'discount_percent', value: 5 });
      const fixed = await createPromo(adminToken, { name: 'Fixed900', productId, type: 'fixed_price', value: 900 });

      const best = await resolveBestPromo(productId, 'maple', 2);
      expect(best).not.toBeNull();
      expect(best!._id.toString()).toBe(fixed._id);

      // Sanity: the discount promo alone would yield 950 > 900
      const solo = await resolveBestPromo(productId, 'maple', 2);
      expect(solo!.name).toBe('Fixed900');
      expect(discount._id).toBeDefined();
    });

    it('skips promos whose quantity is outside min/max bounds', async () => {
      const productId = await createPricedProduct(adminToken, 1000);

      await createPromo(adminToken, { name: 'Min5', productId, type: 'fixed_price', value: 900, minQuantity: 5 });
      const unbounded = await createPromo(adminToken, { name: 'AnyQty', productId, type: 'fixed_price', value: 950 });

      // qty 2 < minQuantity 5 → only the unbounded promo applies
      const low = await resolveBestPromo(productId, 'maple', 2);
      expect(low!._id.toString()).toBe(unbounded._id);

      // qty 6 within bounds → the cheaper Min5 promo wins
      const high = await resolveBestPromo(productId, 'maple', 6);
      expect(high!.name).toBe('Min5');
    });

    it('respects maxQuantity (caps paid+free for buy_x_get_y)', async () => {
      const productId = await createPricedProduct(adminToken, 1000);
      await createPromo(adminToken, { name: 'Max10', productId, type: 'fixed_price', value: 900, maxQuantity: 10 });

      expect(await resolveBestPromo(productId, 'maple', 11)).toBeNull();
      expect(await resolveBestPromo(productId, 'maple', 10)).not.toBeNull();
    });

    it('skips a group fixed_price below its group size, applies it at/above N', async () => {
      const productId = await createPricedProduct(adminToken, 6000);
      await createPromo(adminToken, {
        name: 'Three16000',
        productId,
        type: 'fixed_price',
        value: 16000,
        minQuantity: 3,
        maxQuantity: 10
      });

      // qty < N → not eligible, no promo applies
      expect(await resolveBestPromo(productId, 'maple', 2)).toBeNull();

      // qty === N → eligible
      expect(await resolveBestPromo(productId, 'maple', 3)).not.toBeNull();
      expect(await resolveBestPromo(productId, 'maple', 4)).not.toBeNull();
    });

    it('compares group fixed_price by its effective (average) unit price', async () => {
      const productId = await createPricedProduct(adminToken, 6000);

      // "3 x $16.000" → effective unit 5333.33 at qty 3; a flat 10% off → 5400.
      const group = await createPromo(adminToken, {
        name: 'Group3x16000',
        productId,
        type: 'fixed_price',
        value: 16000,
        minQuantity: 3,
        maxQuantity: 10
      });
      await createPromo(adminToken, { name: 'TenOff', productId, type: 'discount_percent', value: 10 });

      const best = await resolveBestPromo(productId, 'maple', 3);
      expect(best!._id.toString()).toBe(group._id);
    });

    it('skips date-expired and stock-exhausted promos', async () => {
      const productId = await createPricedProduct(adminToken, 1000);

      await createPromo(adminToken, { name: 'Expired', productId, type: 'fixed_price', value: 1, expiresAt: yesterday() });
      const exhausted = await createPromo(adminToken, { name: 'Exhausted', productId, type: 'fixed_price', value: 2, stockLimit: 2 });
      await Promotion.updateOne({ _id: exhausted._id }, { $set: { soldQuantity: 2 } });

      expect(await resolveBestPromo(productId, 'maple', 1)).toBeNull();
    });

    it('is unit-scoped (maple promo does not apply to cajón lines)', async () => {
      const productId = await createPricedProduct(adminToken, 1000);
      await createPromo(adminToken, { name: 'MapleOnly', productId, type: 'fixed_price', value: 900, unit: 'maple' });

      expect(await resolveBestPromo(productId, 'maple', 2)).not.toBeNull();
      expect(await resolveBestPromo(productId, 'cajon', 2)).toBeNull();
    });

    it('supports a medio cajón promo: validates and prices against its own base price', async () => {
      const productId = await createPricedProduct(adminToken, 1000); // maple base price 1000
      // A medio cajón base price so the promo has something to price against.
      await PriceEntry.create({
        productId,
        price: 600,
        unit: 'medio_cajon',
        effectiveFrom: new Date(yesterday())
      });

      const promo = await createPromo(adminToken, {
        name: 'HalfFixed',
        productId,
        type: 'fixed_price',
        value: 500,
        unit: 'medio_cajon'
      });
      expect(promo.unit).toBe('medio_cajon');

      const best = await resolveBestPromo(productId, 'medio_cajon', 2);
      expect(best).not.toBeNull();
      expect(best!.name).toBe('HalfFixed');

      // Unit-scoped: the maple-scoped lookup is unaffected, and cajón has no
      // base price so no promo applies.
      expect(await resolveBestPromo(productId, 'maple', 2)).toBeNull();
      expect(await resolveBestPromo(productId, 'cajon', 2)).toBeNull();
    });
  });

  // ─── soldQuantity accounting (D5) ───────────────────────────────────────

  describe('incrementSold / restoreSold', () => {
    it('atomically guards the stock limit', async () => {
      const productId = await createPricedProduct(adminToken, 1000);
      const promo = await createPromo(adminToken, {
        name: 'Atomic',
        productId,
        type: 'fixed_price',
        value: 900,
        stockLimit: 2
      });

      expect(await incrementSold(promo._id as string, 1)).toBe(true);
      expect(await incrementSold(promo._id as string, 1)).toBe(true);
      // Third unit does not fit → 409 guard rejects it
      await expect(incrementSold(promo._id as string, 1)).rejects.toMatchObject({ status: 409 });

      const after = await Promotion.findById(promo._id);
      expect(after!.soldQuantity).toBe(2);
    });

    it('rejects a quantity larger than the whole stock limit (no partial booking)', async () => {
      const productId = await createPricedProduct(adminToken, 1000);
      const promo = await createPromo(adminToken, {
        name: 'FullFit',
        productId,
        type: 'fixed_price',
        value: 900,
        stockLimit: 10
      });

      await expect(incrementSold(promo._id as string, 100)).rejects.toMatchObject({ status: 409 });
      const after = await Promotion.findById(promo._id);
      expect(after!.soldQuantity).toBe(0);
    });

    it('clamps restoreSold at zero (never negative)', async () => {
      const productId = await createPricedProduct(adminToken, 1000);
      const promo = await createPromo(adminToken, {
        name: 'ClampMe',
        productId,
        type: 'fixed_price',
        value: 900,
        stockLimit: 10
      });

      await incrementSold(promo._id as string, 2);
      await restoreSold(promo._id as string, 5);
      let after = await Promotion.findById(promo._id);
      expect(after!.soldQuantity).toBe(0);

      // Repeating the restore keeps it at zero instead of going negative.
      await restoreSold(promo._id as string, 5);
      after = await Promotion.findById(promo._id);
      expect(after!.soldQuantity).toBe(0);
    });

    it('restores soldQuantity on cancel', async () => {
      const productId = await createPricedProduct(adminToken, 1000);
      const promo = await createPromo(adminToken, {
        name: 'Restore',
        productId,
        type: 'fixed_price',
        value: 900,
        stockLimit: 10
      });

      await incrementSold(promo._id as string, 3);
      await restoreSold(promo._id as string, 1);

      const after = await Promotion.findById(promo._id);
      expect(after!.soldQuantity).toBe(2);
    });
  });
});