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

const request = supertest(app);

const DAY_MS = 24 * 60 * 60 * 1000;

/** A deterministic fixed base date (3 days ago) so ranges never straddle "now". */
const baseDate = (): Date => new Date(Date.now() - 3 * DAY_MS);

const iso = (date: Date): string => date.toISOString();

type Unit = 'maple' | 'medio_cajon' | 'cajon';

/** Creates a fresh product via the API and returns its id. */
const createProduct = async (token: string): Promise<string> => {
  const res = await request
    .post('/api/v1/products')
    .set('Authorization', `Bearer ${token}`)
    .send({ variety: 'blanco', caliber: 'chico' })
    .expect(201);
  return res.body._id as string;
};

/** POST a price entry and return the supertest response (caller sets expectations). */
const postPrice = (
  token: string,
  productId: string,
  price: number,
  unit: Unit,
  from: Date,
  to: Date | null = null
) =>
  request
    .post(`/api/v1/products/${productId}/prices`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      price,
      unit,
      effectiveFrom: iso(from),
      effectiveTo: to ? iso(to) : null
    });

const listPrices = async (
  token: string,
  productId: string
): Promise<Array<{ price: number; unit: string; effectiveFrom: string; effectiveTo: string | null }>> => {
  const res = await request
    .get(`/api/v1/products/${productId}/prices`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return res.body as Array<{
    price: number;
    unit: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  }>;
};

const activePrice = async (
  token: string,
  productId: string,
  unit: Unit,
  date: Date
): Promise<number> => {
  const res = await request
    .get(`/api/v1/products/${productId}/prices/active`)
    .query({ unit, date: iso(date) })
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return res.body.price as number;
};

describe('Price supersession (Product prices)', () => {
  let adminToken: string;

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
  });

  it('closes the previous price when a new one starts later', async () => {
    const productId = await createProduct(adminToken);
    const D = baseDate();
    const D7 = new Date(D.getTime() + 7 * DAY_MS);

    await postPrice(adminToken, productId, 100, 'maple', D, null).expect(201);
    await postPrice(adminToken, productId, 150, 'maple', D7, null).expect(201);

    const entries = await listPrices(adminToken, productId);
    expect(entries).toHaveLength(2);

    const previous = entries.find((e) => e.price === 100);
    expect(previous).toBeDefined();
    // The old entry is closed 1ms before the new one starts (inclusive ranges).
    expect(new Date(previous!.effectiveTo as string).getTime()).toBe(D7.getTime() - 1);

    // D served the old price; D+7 serves the new one.
    expect(await activePrice(adminToken, productId, 'maple', D)).toBe(100);
    expect(await activePrice(adminToken, productId, 'maple', D7)).toBe(150);
  });

  it('updates in place when re-saving the same effective start', async () => {
    const productId = await createProduct(adminToken);
    const D = baseDate();
    const fromIso = iso(D);

    await postPrice(adminToken, productId, 100, 'maple', D, null).expect(201);
    const res = await postPrice(adminToken, productId, 175, 'maple', D, null).expect(201);
    expect(res.body.price).toBe(175);

    const entries = (await listPrices(adminToken, productId)).filter((e) => e.unit === 'maple');
    // Exactly one entry — no duplicate, no zero-length window.
    expect(entries).toHaveLength(1);
    expect(entries[0]!.price).toBe(175);
    expect(entries[0]!.effectiveFrom).toBe(fromIso);
    expect(entries[0]!.effectiveTo).toBeNull();
  });

  it('scheduling a future price does not break the current one', async () => {
    const productId = await createProduct(adminToken);
    const D = baseDate();
    const D7 = new Date(D.getTime() + 7 * DAY_MS);

    await postPrice(adminToken, productId, 100, 'maple', D, null).expect(201);
    await postPrice(adminToken, productId, 200, 'maple', D7, null).expect(201);

    // The current price remains active on D.
    expect(await activePrice(adminToken, productId, 'maple', D)).toBe(100);
    // And the current entry is still open-ended until the boundary.
    const current = (await listPrices(adminToken, productId)).find((e) => e.price === 100);
    expect(new Date(current!.effectiveTo as string).getTime()).toBe(D7.getTime() - 1);
  });

  it('keeps units independent when changing one price', async () => {
    const productId = await createProduct(adminToken);
    const D = baseDate();
    const D7 = new Date(D.getTime() + 7 * DAY_MS);

    await postPrice(adminToken, productId, 100, 'maple', D, null).expect(201);
    await postPrice(adminToken, productId, 600, 'medio_cajon', D, null).expect(201);
    await postPrice(adminToken, productId, 1200, 'cajon', D, null).expect(201);

    // Change only the cajón price (later start → closes the previous cajón entry).
    await postPrice(adminToken, productId, 1300, 'cajon', D7, null).expect(201);

    const entries = await listPrices(adminToken, productId);
    const maple = entries.filter((e) => e.unit === 'maple');
    const medio = entries.filter((e) => e.unit === 'medio_cajon');
    const cajon = entries.filter((e) => e.unit === 'cajon');

    // Maple and medio cajón are untouched: still a single open-ended entry each.
    expect(maple).toHaveLength(1);
    expect(maple[0]!.price).toBe(100);
    expect(maple[0]!.effectiveTo).toBeNull();
    expect(medio).toHaveLength(1);
    expect(medio[0]!.price).toBe(600);
    expect(medio[0]!.effectiveTo).toBeNull();

    // Only the cajón history changed.
    expect(cajon).toHaveLength(2);
    expect(await activePrice(adminToken, productId, 'maple', D7)).toBe(100);
    expect(await activePrice(adminToken, productId, 'medio_cajon', D7)).toBe(600);
    expect(await activePrice(adminToken, productId, 'cajon', D)).toBe(1200);
    expect(await activePrice(adminToken, productId, 'cajon', D7)).toBe(1300);
  });

  it('still rejects a genuine conflict with 409', async () => {
    const productId = await createProduct(adminToken);
    const D = baseDate();

    // Two disjoint bounded entries, both starting after D.
    await postPrice(adminToken, productId, 100, 'maple', new Date(D.getTime() + 1 * DAY_MS), new Date(D.getTime() + 2 * DAY_MS)).expect(201);
    await postPrice(adminToken, productId, 110, 'maple', new Date(D.getTime() + 5 * DAY_MS), new Date(D.getTime() + 6 * DAY_MS)).expect(201);

    // A new range covering BOTH cannot be resolved by a single supersede → 409.
    const res = await postPrice(adminToken, productId, 999, 'maple', D, new Date(D.getTime() + 10 * DAY_MS)).expect(409);
    expect(res.body.error).toMatch(/overlap/i);
  });
});
