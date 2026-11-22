import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  seedDriverUser,
  loginAs,
  createTestCustomer,
  getProductIds
} from './helpers.js';
import { app } from '../app.js';
import { Product } from '../modules/products/model.js';
import { PriceEntry } from '../modules/products/price-list-model.js';
import { Inventory } from '../modules/inventory/model.js';
import { convertToMaples } from '../modules/products/service.js';

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

/**
 * Creates a fresh product via the API (so maplesPerCajon is stored through
 * the real schema path) and seeds an inventory record with the given stock.
 */
const createCajonProduct = async (
  token: string,
  name: 'blanco' | 'castaño',
  caliber: 'chico' | 'mediano' | 'grande' | 'extragrande' | 'surtido',
  maplesPerCajon: number,
  stock: number
): Promise<string> => {
  const res = await request
    .post('/api/v1/products')
    .set('Authorization', `Bearer ${token}`)
    .send({ variety: name, caliber, maplesPerCajon })
    .expect(201);

  const productId = res.body._id as string;
  await Inventory.updateOne(
    { productId },
    { $set: { quantity: stock, lastUpdated: new Date() } },
    { upsert: true }
  );
  return productId;
};

const setPrice = async (
  token: string,
  productId: string,
  price: number,
  unit: 'maple' | 'medio_cajon' | 'cajon',
  from: string,
  to: string | null = null
): Promise<void> => {
  await request
    .post(`/api/v1/products/${productId}/prices`)
    .set('Authorization', `Bearer ${token}`)
    .send({ price, unit, effectiveFrom: from, effectiveTo: to })
    .expect(201);
};

describe('Cajón Equivalence (T7–T8)', () => {
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
    const adminCreds = await seedAdminUser();
    const driverCreds = await seedDriverUser();
    adminToken = await loginAs(request, adminCreds.email, adminCreds.password);
    driverToken = await loginAs(request, driverCreds.email, driverCreds.password);
  });

  // ─── T7: maplesPerCajon + unit-aware price list ────────────────────────

  describe('Product maplesPerCajon', () => {
    it('stores maplesPerCajon (default 12) when omitted', async () => {
      const res = await request
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ variety: 'blanco', caliber: 'chico' })
        .expect(201);

      expect(res.body.maplesPerCajon).toBe(12);
    });

    it('accepts a custom maplesPerCajon', async () => {
      const res = await request
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ variety: 'blanco', caliber: 'mediano', maplesPerCajon: 20 })
        .expect(201);

      expect(res.body.maplesPerCajon).toBe(20);
    });

    it('rejects maplesPerCajon below 1 with 400', async () => {
      const res = await request
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ variety: 'blanco', caliber: 'grande', maplesPerCajon: 0 })
        .expect(400);

      expect(res.body.error).toMatch(/maplesPerCajon/i);
    });

    it('updates maplesPerCajon via PATCH', async () => {
      const productId = await createCajonProduct(adminToken, 'castaño', 'chico', 12, 0);

      const res = await request
        .patch(`/api/v1/products/${productId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ maplesPerCajon: 20 })
        .expect(200);

      expect(res.body.maplesPerCajon).toBe(20);
    });

    it('updates costPrice via PATCH without touching maplesPerCajon', async () => {
      const productId = await createCajonProduct(adminToken, 'castaño', 'mediano', 12, 0);

      const res = await request
        .patch(`/api/v1/products/${productId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ costPrice: 25 })
        .expect(200);

      expect(res.body.costPrice).toBe(25);
      expect(res.body.maplesPerCajon).toBe(12);
    });
  });

  describe('Unit-aware price list', () => {
    it('lets maple and cajón entries coexist over the same range', async () => {
      const productId = await createCajonProduct(adminToken, 'castaño', 'grande', 12, 0);

      await setPrice(adminToken, productId, 100, 'maple', yesterday());
      await setPrice(adminToken, productId, 1200, 'cajon', yesterday());

      const prices = await request
        .get(`/api/v1/products/${productId}/prices`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(prices.body).toHaveLength(2);
      const units = prices.body.map((p: { unit: string }) => p.unit).sort();
      expect(units).toEqual(['cajon', 'maple']);
    });

    it('supersedes an overlapping entry in the same unit instead of 409 (same start)', async () => {
      const productId = await createCajonProduct(adminToken, 'castaño', 'extragrande', 12, 0);
      // Capture the exact same start so this exercises the "re-save the same
      // effective start" path (update in place).
      const from = yesterday();

      await setPrice(adminToken, productId, 100, 'maple', from);
      const res = await request
        .post(`/api/v1/products/${productId}/prices`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: 110, unit: 'maple', effectiveFrom: from, effectiveTo: tomorrow() })
        .expect(201);
      expect(res.body.price).toBe(110);

      // No duplicate maple entry was created — the old one was updated in place.
      const prices = await request
        .get(`/api/v1/products/${productId}/prices`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const mapleEntries = (prices.body as Array<{ unit: string }>).filter((p) => p.unit === 'maple');
      expect(mapleEntries).toHaveLength(1);

      // A cajón entry over the same range succeeds (different unit stays independent)
      await setPrice(adminToken, productId, 1200, 'cajon', from);
    });

    it('defaults effectiveFrom to now when it is omitted', async () => {
      const productId = await createCajonProduct(adminToken, 'castaño', 'grande', 12, 0);

      const created = await request
        .post(`/api/v1/products/${productId}/prices`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: 500, unit: 'maple' })
        .expect(201);

      expect(created.body.unit).toBe('maple');
      expect(created.body.price).toBe(500);
      // effectiveFrom must default to ~now instead of 400-ing.
      expect(created.body.effectiveFrom).toBeTruthy();
      const from = new Date(created.body.effectiveFrom as string).getTime();
      expect(Math.abs(Date.now() - from)).toBeLessThan(60_000);
    });

    it('returns the active price for the requested unit', async () => {
      const productId = await createCajonProduct(adminToken, 'castaño', 'surtido', 12, 0);

      await setPrice(adminToken, productId, 100, 'maple', yesterday());
      await setPrice(adminToken, productId, 1200, 'cajon', yesterday());

      const cajon = await request
        .get(`/api/v1/products/${productId}/prices/active?unit=cajon`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(cajon.body.unit).toBe('cajon');
      expect(cajon.body.price).toBe(1200);

      const maple = await request
        .get(`/api/v1/products/${productId}/prices/active?unit=maple`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(maple.body.unit).toBe('maple');
      expect(maple.body.price).toBe(100);

      // Default (no unit param) behaves as 'maple'
      const defaultUnit = await request
        .get(`/api/v1/products/${productId}/prices/active`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(defaultUnit.body.unit).toBe('maple');
    });

    it('returns the active medio cajón price independent of maple and cajón', async () => {
      const productId = await createCajonProduct(adminToken, 'blanco', 'mediano', 12, 0);

      await setPrice(adminToken, productId, 100, 'maple', yesterday());
      await setPrice(adminToken, productId, 600, 'medio_cajon', yesterday());
      await setPrice(adminToken, productId, 1200, 'cajon', yesterday());

      // All three units coexist over the same range
      const prices = await request
        .get(`/api/v1/products/${productId}/prices`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const units = prices.body.map((p: { unit: string }) => p.unit).sort();
      expect(units).toEqual(['cajon', 'maple', 'medio_cajon']);

      const medio = await request
        .get(`/api/v1/products/${productId}/prices/active?unit=medio_cajon`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(medio.body.unit).toBe('medio_cajon');
      expect(medio.body.price).toBe(600);
    });

    it('does NOT serve a medio cajón price when only a cajón price exists', async () => {
      const productId = await createCajonProduct(adminToken, 'blanco', 'grande', 12, 0);

      await setPrice(adminToken, productId, 1200, 'cajon', yesterday());

      // No medio cajón price was created → the existing "no active price" path
      const res = await request
        .get(`/api/v1/products/${productId}/prices/active?unit=medio_cajon`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
      expect(res.body.error).toMatch(/no active price/i);

      // And the cajón price itself is still served
      await request
        .get(`/api/v1/products/${productId}/prices/active?unit=cajon`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('rejects an invalid unit query parameter', async () => {
      const productId = await createCajonProduct(adminToken, 'blanco', 'extragrande', 12, 0);
      await setPrice(adminToken, productId, 100, 'maple', yesterday());

      const res = await request
        .get(`/api/v1/products/${productId}/prices/active?unit=box`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);

      expect(res.body.error).toMatch(/unit/i);
    });

    it('treats legacy price entries without a unit as maple and supersedes them', async () => {
      const productId = await createCajonProduct(adminToken, 'blanco', 'surtido', 12, 0);

      // Legacy doc — no unit field
      await PriceEntry.create({
        productId,
        price: 90,
        effectiveFrom: new Date(yesterday())
      });

      // A new maple entry supersedes the legacy one for the same effective
      // (product, unit) scope instead of 409-ing: the legacy doc is treated as
      // maple, so the new price closes it (or updates it in place if the start
      // matches exactly).
      await request
        .post(`/api/v1/products/${productId}/prices`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: 95, unit: 'maple', effectiveFrom: yesterday() })
        .expect(201);

      const maple = await request
        .get(`/api/v1/products/${productId}/prices/active?unit=maple`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(maple.body.price).toBe(95);

      // A cajón entry over the same range is fine
      await setPrice(adminToken, productId, 1100, 'cajon', yesterday());
    });
  });

  describe('convertToMaples helper', () => {
    it('converts cajón quantity via maplesPerCajon', () => {
      expect(convertToMaples({ maplesPerCajon: 12 }, 2, 'cajon')).toBe(24);
      expect(convertToMaples({ maplesPerCajon: 20 }, 3, 'cajon')).toBe(60);
    });

    it('passes maple quantity through unchanged', () => {
      expect(convertToMaples({ maplesPerCajon: 12 }, 10, 'maple')).toBe(10);
      expect(convertToMaples({ maplesPerCajon: 12 }, 10)).toBe(10);
    });

    it('converts medio cajón quantity to half the cajón equivalent', () => {
      expect(convertToMaples({ maplesPerCajon: 12 }, 2, 'medio_cajon')).toBe(12);
      expect(convertToMaples({ maplesPerCajon: 20 }, 3, 'medio_cajon')).toBe(30);
    });

    it('keeps the math exact when maplesPerCajon is odd (no silent rounding)', () => {
      expect(convertToMaples({ maplesPerCajon: 13 }, 2, 'medio_cajon')).toBe(13);
      expect(convertToMaples({ maplesPerCajon: 13 }, 1, 'medio_cajon')).toBe(6.5);
    });

    it('falls back to 12 maples per cajón when the product lacks the field', () => {
      expect(convertToMaples({}, 2, 'cajon')).toBe(24);
    });
  });

  // ─── T8: order items with unit + cajón conversion ──────────────────────

  describe('Order with unit-aware items', () => {
    it('creates an order with a cajón item storing unit/mapleQty and cajón pricing', async () => {
      const customer = await createTestCustomer();
      const productId = await createCajonProduct(adminToken, 'castaño', 'chico', 12, 100);

      await setPrice(adminToken, productId, 100, 'maple', yesterday());
      await setPrice(adminToken, productId, 1200, 'cajon', yesterday());

      const res = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId, quantity: 2, unit: 'cajon' }]
        })
        .expect(201);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].quantity).toBe(2);
      expect(res.body.items[0].unit).toBe('cajon');
      expect(res.body.items[0].mapleQty).toBe(24); // 2 × 12
      expect(res.body.items[0].unitPrice).toBe(1200);
      expect(res.body.items[0].subtotal).toBe(2400);
      expect(res.body.totalAmount).toBe(2400);
    });

    it('uses the maple price and defaults unit to maple', async () => {
      const customer = await createTestCustomer();
      const productId = await createCajonProduct(adminToken, 'castaño', 'mediano', 12, 100);

      await setPrice(adminToken, productId, 100, 'maple', yesterday());
      await setPrice(adminToken, productId, 1200, 'cajon', yesterday());

      const res = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId, quantity: 10 }] // no unit → maple
        })
        .expect(201);

      expect(res.body.items[0].unit).toBe('maple');
      expect(res.body.items[0].mapleQty).toBe(10);
      expect(res.body.items[0].unitPrice).toBe(100);
      expect(res.body.items[0].subtotal).toBe(1000);
      expect(res.body.totalAmount).toBe(1000);
    });

    it('creates a medio cajón item that resolves its OWN active price and sets mapleQty = qty × 6', async () => {
      const customer = await createTestCustomer();
      const productId = await createCajonProduct(adminToken, 'castaño', 'grande', 12, 100);

      await setPrice(adminToken, productId, 100, 'maple', yesterday());
      await setPrice(adminToken, productId, 600, 'medio_cajon', yesterday());
      await setPrice(adminToken, productId, 1200, 'cajon', yesterday());

      const res = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId, quantity: 3, unit: 'medio_cajon' }]
        })
        .expect(201);

      expect(res.body.items[0].unit).toBe('medio_cajon');
      expect(res.body.items[0].mapleQty).toBe(18); // 3 × (12 / 2)
      expect(res.body.items[0].unitPrice).toBe(600); // its own price, not the maple or cajón one
      expect(res.body.items[0].subtotal).toBe(1800);
      expect(res.body.totalAmount).toBe(1800);
    });

    it('computes mixed maple + cajón totals correctly', async () => {
      const customer = await createTestCustomer();
      const productId = await createCajonProduct(adminToken, 'castaño', 'grande', 12, 500);

      await setPrice(adminToken, productId, 100, 'maple', yesterday());
      await setPrice(adminToken, productId, 1200, 'cajon', yesterday());

      const res = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [
            { productId, quantity: 2, unit: 'cajon' },  // 2 × 1200 = 2400
            { productId, quantity: 10, unit: 'maple' }  // 10 × 100 = 1000
          ]
        })
        .expect(201);

      expect(res.body.totalAmount).toBe(3400);
      expect(res.body.items[0].mapleQty).toBe(24);
      expect(res.body.items[1].mapleQty).toBe(10);
    });

    it('rejects an invalid item unit with 400', async () => {
      const customer = await createTestCustomer();
      const productId = await createCajonProduct(adminToken, 'castaño', 'extragrande', 12, 100);
      await setPrice(adminToken, productId, 100, 'maple', yesterday());

      await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId, quantity: 2, unit: 'box' }]
        })
        .expect(400);
    });

    it('delivery decrements stock by mapleQty for cajón items', async () => {
      const customer = await createTestCustomer();
      const productId = await createCajonProduct(adminToken, 'castaño', 'surtido', 12, 100);

      await setPrice(adminToken, productId, 100, 'maple', yesterday());
      await setPrice(adminToken, productId, 1200, 'cajon', yesterday());

      const order = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId, quantity: 2, unit: 'cajon' }] // mapleQty 24
        })
        .expect(201);

      // Stock untouched until delivery
      let inv = await Inventory.findOne({ productId });
      expect(inv!.quantity).toBe(100);

      // Build route with the order and deliver it (driver flow)
      const driver = await (await import('../modules/auth/model.js')).User.findOne({ role: 'driver' });
      const routeRes = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId: driver!._id.toString(), plannedDate: '2026-09-29' })
        .expect(201);

      const withStop = await request
        .post(`/api/v1/routes/${routeRes.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order.body._id })
        .expect(201);

      await request
        .patch(`/api/v1/routes/${routeRes.body._id}/start`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const stopId = withStop.body.stops[0]._id;
      await request
        .patch(`/api/v1/routes/${routeRes.body._id}/stops/${stopId}/advance`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'in_transit' })
        .expect(200);
      await request
        .patch(`/api/v1/routes/${routeRes.body._id}/stops/${stopId}/advance`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'delivered' })
        .expect(200);

      // Stock decremented by mapleQty (24), not raw cajón quantity (2)
      inv = await Inventory.findOne({ productId });
      expect(inv!.quantity).toBe(76); // 100 - 24
    });

    it('direct delivery decrements stock by mapleQty for cajón items', async () => {
      const customer = await createTestCustomer();
      const productId = await createCajonProduct(adminToken, 'castaño', 'surtido', 12, 100);

      await setPrice(adminToken, productId, 100, 'maple', yesterday());
      await setPrice(adminToken, productId, 1200, 'cajon', yesterday());

      const order = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId, quantity: 2, unit: 'cajon' }] // mapleQty 24
        })
        .expect(201);

      // Stock untouched until delivery
      let inv = await Inventory.findOne({ productId });
      expect(inv!.quantity).toBe(100);

      // Direct delivery via the order status endpoint (no route)
      await request.patch(`/api/v1/orders/${order.body._id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'assigned' }).expect(200);
      await request.patch(`/api/v1/orders/${order.body._id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'in_transit' }).expect(200);
      await request.patch(`/api/v1/orders/${order.body._id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'delivered' }).expect(200);

      // Stock decremented by mapleQty (24), not raw cajón quantity (2)
      inv = await Inventory.findOne({ productId });
      expect(inv!.quantity).toBe(76); // 100 - 24
    });

    it('route delivery decrements stock by mapleQty for medio cajón items', async () => {
      const customer = await createTestCustomer();
      const productId = await createCajonProduct(adminToken, 'castaño', 'chico', 12, 100);

      await setPrice(adminToken, productId, 100, 'maple', yesterday());
      await setPrice(adminToken, productId, 600, 'medio_cajon', yesterday());

      const order = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId, quantity: 4, unit: 'medio_cajon' }] // mapleQty 24
        })
        .expect(201);
      expect(order.body.items[0].mapleQty).toBe(24);

      let inv = await Inventory.findOne({ productId });
      expect(inv!.quantity).toBe(100);

      const driver = await (await import('../modules/auth/model.js')).User.findOne({ role: 'driver' });
      const routeRes = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId: driver!._id.toString(), plannedDate: '2026-09-29' })
        .expect(201);

      const withStop = await request
        .post(`/api/v1/routes/${routeRes.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order.body._id })
        .expect(201);

      await request
        .patch(`/api/v1/routes/${routeRes.body._id}/start`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const stopId = withStop.body.stops[0]._id;
      await request
        .patch(`/api/v1/routes/${routeRes.body._id}/stops/${stopId}/advance`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'in_transit' })
        .expect(200);
      await request
        .patch(`/api/v1/routes/${routeRes.body._id}/stops/${stopId}/advance`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'delivered' })
        .expect(200);

      inv = await Inventory.findOne({ productId });
      expect(inv!.quantity).toBe(76); // 100 - 24
    });

    it('direct delivery decrements stock by mapleQty for medio cajón items', async () => {
      const customer = await createTestCustomer();
      const productId = await createCajonProduct(adminToken, 'castaño', 'mediano', 12, 100);

      await setPrice(adminToken, productId, 100, 'maple', yesterday());
      await setPrice(adminToken, productId, 600, 'medio_cajon', yesterday());

      const order = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId, quantity: 4, unit: 'medio_cajon' }] // mapleQty 24
        })
        .expect(201);

      let inv = await Inventory.findOne({ productId });
      expect(inv!.quantity).toBe(100);

      await request.patch(`/api/v1/orders/${order.body._id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'assigned' }).expect(200);
      await request.patch(`/api/v1/orders/${order.body._id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'in_transit' }).expect(200);
      await request.patch(`/api/v1/orders/${order.body._id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'delivered' }).expect(200);

      inv = await Inventory.findOne({ productId });
      expect(inv!.quantity).toBe(76); // 100 - 24
    });
  });
});