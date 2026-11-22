import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  loginAs,
  app
} from './helpers.js';
import { Product } from '../modules/products/model.js';
import { Inventory } from '../modules/inventory/model.js';

const request = supertest(app);

describe('Products — variety × caliber model', () => {
  let adminToken: string;

  beforeAll(async () => { await startTestDatabase(); });
  afterAll(async () => { await stopTestDatabase(); });

  beforeEach(async () => {
    await clearDatabase();
    const creds = await seedAdminUser();
    adminToken = await loginAs(request, creds.email, creds.password);
  });

  const post = (body: Record<string, unknown>) =>
    request
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);

  it('creates a product with variety + caliber and derives displayName', async () => {
    const res = await post({ variety: 'blanco', caliber: 'chico' }).expect(201);

    expect(res.body.variety).toBe('blanco');
    expect(res.body.caliber).toBe('chico');
    expect(res.body.displayName).toBe('Blanco Chico');
    expect(res.body.eggsPerMaple).toBe(30);
    expect(res.body.maplesPerCajon).toBe(12);
    expect(res.body.lowStockThreshold).toBe(20);
  });

  it('derives "Extra Grande" and "Surtido" labels', async () => {
    const extra = await post({ variety: 'castaño', caliber: 'extragrande' }).expect(201);
    expect(extra.body.displayName).toBe('Castaño Extra Grande');

    const surtido = await post({ variety: 'blanco', caliber: 'surtido' }).expect(201);
    expect(surtido.body.displayName).toBe('Blanco Surtido');
  });

  it('creates a zero-quantity inventory record for the new product', async () => {
    const res = await post({ variety: 'blanco', caliber: 'mediano' }).expect(201);
    const inventory = await Inventory.findOne({ productId: res.body._id });
    expect(inventory).not.toBeNull();
    expect(inventory!.quantity).toBe(0);
  });

  it('honors initialQuantity when provided', async () => {
    const res = await post({ variety: 'blanco', caliber: 'grande', initialQuantity: 42 }).expect(201);
    const inventory = await Inventory.findOne({ productId: res.body._id });
    expect(inventory!.quantity).toBe(42);
  });

  it('rejects a duplicate (variety, caliber) with 409', async () => {
    await post({ variety: 'blanco', caliber: 'chico' }).expect(201);
    const res = await post({ variety: 'blanco', caliber: 'chico' }).expect(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('allows the same caliber for a different variety', async () => {
    await post({ variety: 'blanco', caliber: 'chico' }).expect(201);
    await post({ variety: 'castaño', caliber: 'chico' }).expect(201);
    expect(await Product.countDocuments()).toBe(2);
  });

  it('rejects an unknown caliber with 400', async () => {
    await post({ variety: 'blanco', caliber: 'jumbo' }).expect(400);
  });

  it('lists products filtered by variety and caliber', async () => {
    await post({ variety: 'blanco', caliber: 'chico' }).expect(201);
    await post({ variety: 'blanco', caliber: 'grande' }).expect(201);
    await post({ variety: 'castaño', caliber: 'chico' }).expect(201);

    const byVariety = await request
      .get('/api/v1/products?variety=blanco')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(byVariety.body).toHaveLength(2);
    expect(byVariety.body.every((p: { variety: string }) => p.variety === 'blanco')).toBe(true);

    const byCaliber = await request
      .get('/api/v1/products?caliber=chico')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(byCaliber.body).toHaveLength(2);

    const exact = await request
      .get('/api/v1/products?variety=blanco&caliber=grande')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(exact.body).toHaveLength(1);
    expect(exact.body[0].displayName).toBe('Blanco Grande');
  });

  it('rejects an invalid variety filter with 400', async () => {
    await request
      .get('/api/v1/products?variety=verde')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it('GET /products/options returns the full variety×caliber catalog', async () => {
    const res = await request
      .get('/api/v1/products/options')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.varieties).toHaveLength(2);
    expect(res.body.calibers).toHaveLength(5);
    expect(res.body.combos).toHaveLength(10);
    expect(res.body.calibers).toEqual(
      expect.arrayContaining([{ value: 'extragrande', label: 'Extra Grande' }])
    );
    expect(res.body.combos).toEqual(
      expect.arrayContaining([{ variety: 'blanco', caliber: 'surtido', displayName: 'Blanco Surtido' }])
    );
  });

  it('deletes a product', async () => {
    const created = await post({ variety: 'blanco', caliber: 'chico' }).expect(201);
    await request
      .delete(`/api/v1/products/${created.body._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
    expect(await Product.findById(created.body._id)).toBeNull();
  });
});
