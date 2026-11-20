import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import supertest from 'supertest';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  seedDriverUser,
  loginAs
} from './helpers.js';
import { app } from '../app.js';
import { geocodeAddress, resetGeocodeState } from '../modules/geocode/service.js';

const request = supertest(app);

const nominatimResponse = (results: Array<Record<string, unknown>>) => ({
  ok: true,
  json: async () => results
});

const nominatimReverseResponse = (payload: Record<string, unknown>) => ({
  ok: true,
  json: async () => payload
});

// ─── HTTP integration ─────────────────────────────────────────────────────────

describe('Geocode Integration', () => {
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
    resetGeocodeState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('POST /api/v1/geocode', () => {
    it('returns coordinates for a valid address', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        nominatimResponse([{ lat: '-34.6037', lon: '-58.3816', display_name: 'Buenos Aires, Argentina' }])
      );
      vi.stubGlobal('fetch', mockFetch);

      const response = await request
        .post('/api/v1/geocode')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ address: 'Av. Corrientes 1234, Buenos Aires' })
        .expect(200);

      expect(response.body.lat).toBe(-34.6037);
      expect(response.body.lng).toBe(-58.3816);
      expect(response.body.displayName).toBe('Buenos Aires, Argentina');
    });

    it('sends the Nominatim search query and descriptive User-Agent', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        nominatimResponse([{ lat: '-34.6037', lon: '-58.3816', display_name: 'Buenos Aires' }])
      );
      vi.stubGlobal('fetch', mockFetch);

      await request
        .post('/api/v1/geocode')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ address: 'Buenos Aires' })
        .expect(200);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0]!;
      expect(String(url)).toContain('/search');
      expect(String(url)).toContain('format=jsonv2');
      expect(init).toMatchObject({
        headers: { 'User-Agent': 'leader-egg-app/1.0 (contact@leaderegg.com)' }
      });
    });

    it('returns 404 when Nominatim has no results for the address', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(nominatimResponse([])));

      const response = await request
        .post('/api/v1/geocode')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ address: 'Nowhere 12345' })
        .expect(404);

      expect(response.body.error).toBe('No se pudo geocodificar la dirección');
    });

    it('returns 400 for missing, empty or non-string address', async () => {
      await request.post('/api/v1/geocode').set('Authorization', `Bearer ${adminToken}`).send({}).expect(400);
      await request.post('/api/v1/geocode').set('Authorization', `Bearer ${adminToken}`).send({ address: '   ' }).expect(400);
      await request.post('/api/v1/geocode').set('Authorization', `Bearer ${adminToken}`).send({ address: 123 }).expect(400);
    });

    it('returns 502 when Nominatim responds with an HTTP error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));

      const response = await request
        .post('/api/v1/geocode')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ address: 'Cualquier Dirección' })
        .expect(502);

      expect(response.body.error).toBe('Geocoding service unavailable');
    });

    it('returns 502 when the upstream request fails (network error)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      await request
        .post('/api/v1/geocode')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ address: 'Cualquier Dirección' })
        .expect(502);
    });

    it('serves repeat requests from cache — single upstream call, case/whitespace variants hit the same entry', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        nominatimResponse([{ lat: '-31.4201', lon: '-64.1888', display_name: 'Córdoba, Argentina' }])
      );
      vi.stubGlobal('fetch', mockFetch);

      const first = await request
        .post('/api/v1/geocode')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ address: 'Córdoba, Argentina' })
        .expect(200);

      const second = await request
        .post('/api/v1/geocode')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ address: '  CÓRDOBA,   ARGENTINA ' }) // case/whitespace variant
        .expect(200);

      expect(second.body).toEqual(first.body);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('returns 401 without a token', async () => {
      await request.post('/api/v1/geocode').send({ address: 'Buenos Aires' }).expect(401);
    });

    it('allows driver role to geocode (any authenticated user)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        nominatimResponse([{ lat: '-34.6', lon: '-58.4', display_name: 'BA' }])
      ));

      await request
        .post('/api/v1/geocode')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ address: 'Buenos Aires' })
        .expect(200);
    });
  });

  describe('POST /api/v1/geocode/reverse', () => {
    it('returns a structured address for valid coordinates', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        nominatimReverseResponse({
          display_name: 'Avenida Corrientes 1234, Buenos Aires, Argentina',
          address: {
            house_number: '1234',
            road: 'Avenida Corrientes',
            suburb: 'San Nicolás',
            city: 'Buenos Aires',
            state: 'Ciudad Autónoma de Buenos Aires',
            postcode: 'C1043'
          }
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      const response = await request
        .post('/api/v1/geocode/reverse')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lat: -34.6037, lng: -58.3816 })
        .expect(200);

      expect(response.body).toEqual({
        displayName: 'Avenida Corrientes 1234, Buenos Aires, Argentina',
        street: 'Avenida Corrientes',
        number: '1234',
        neighborhood: 'San Nicolás',
        city: 'Buenos Aires',
        province: 'Ciudad Autónoma de Buenos Aires',
        postalCode: 'C1043'
      });
    });

    it('sends the Nominatim reverse query with addressdetails and User-Agent', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        nominatimReverseResponse({ display_name: 'Place', address: { road: 'Calle' } })
      );
      vi.stubGlobal('fetch', mockFetch);

      await request
        .post('/api/v1/geocode/reverse')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lat: -31.42, lng: -64.18 })
        .expect(200);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0]!;
      expect(String(url)).toContain('/reverse');
      expect(String(url)).toContain('format=jsonv2');
      expect(String(url)).toContain('addressdetails=1');
      expect(String(url)).toContain('lat=-31.42');
      expect(String(url)).toContain('lon=-64.18');
      expect(init).toMatchObject({
        headers: { 'User-Agent': 'leader-egg-app/1.0 (contact@leaderegg.com)' }
      });
    });

    it('handles missing address fields (only the present ones are returned)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        nominatimReverseResponse({ address: { state: 'Córdoba' } })
      ));

      const response = await request
        .post('/api/v1/geocode/reverse')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lat: -31.42, lng: -64.18 })
        .expect(200);

      expect(response.body.province).toBe('Córdoba');
      expect(response.body.street).toBeUndefined();
      expect(response.body.number).toBeUndefined();
      expect(response.body.neighborhood).toBeUndefined();
      expect(response.body.city).toBeUndefined();
      expect(response.body.postalCode).toBeUndefined();
    });

    it('falls back across city/town/village/municipality and suburb/neighbourhood', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        nominatimReverseResponse({ address: { village: 'Villa General Belgrano', neighbourhood: 'Centro' } })
      ));

      const response = await request
        .post('/api/v1/geocode/reverse')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lat: -31.98, lng: -64.55 })
        .expect(200);

      expect(response.body.city).toBe('Villa General Belgrano');
      expect(response.body.neighborhood).toBe('Centro');
    });

    it('returns 404 when Nominatim has no result for the point', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        nominatimReverseResponse({ error: 'Unable to geocode' })
      ));

      const response = await request
        .post('/api/v1/geocode/reverse')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lat: 0, lng: 0 })
        .expect(404);

      expect(response.body.error).toBe('No se pudo obtener la dirección');
    });

    it('returns 404 when the response has no address object', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(nominatimReverseResponse({ display_name: 'Nowhere' })));

      await request
        .post('/api/v1/geocode/reverse')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lat: 0, lng: 0 })
        .expect(404);
    });

    it('returns 400 for missing or out-of-range coordinates', async () => {
      await request.post('/api/v1/geocode/reverse').set('Authorization', `Bearer ${adminToken}`).send({}).expect(400);
      await request.post('/api/v1/geocode/reverse').set('Authorization', `Bearer ${adminToken}`).send({ lat: 200, lng: 0 }).expect(400);
      await request.post('/api/v1/geocode/reverse').set('Authorization', `Bearer ${adminToken}`).send({ lat: 0, lng: 999 }).expect(400);
      await request.post('/api/v1/geocode/reverse').set('Authorization', `Bearer ${adminToken}`).send({ lat: 'x', lng: 0 }).expect(400);
    });

    it('returns 502 when Nominatim responds with an HTTP error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));

      const response = await request
        .post('/api/v1/geocode/reverse')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lat: -34.6, lng: -58.4 })
        .expect(502);

      expect(response.body.error).toBe('Geocoding service unavailable');
    });

    it('returns 502 when the upstream request fails (network error)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      await request
        .post('/api/v1/geocode/reverse')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lat: -34.6, lng: -58.4 })
        .expect(502);
    });

    it('serves repeat requests from cache — same coords hit one upstream call', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        nominatimReverseResponse({ display_name: 'Córdoba', address: { state: 'Córdoba' } })
      );
      vi.stubGlobal('fetch', mockFetch);

      const first = await request
        .post('/api/v1/geocode/reverse')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lat: -31.42011, lng: -64.18881 })
        .expect(200);

      const second = await request
        .post('/api/v1/geocode/reverse')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lat: -31.420114, lng: -64.188814 }) // rounds to the same ~5-decimal key
        .expect(200);

      expect(second.body).toEqual(first.body);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('returns 401 without a token', async () => {
      await request.post('/api/v1/geocode/reverse').send({ lat: -34.6, lng: -58.4 }).expect(401);
    });

    it('allows driver role to reverse geocode (any authenticated user)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        nominatimReverseResponse({ address: { state: 'Córdoba' } })
      ));

      await request
        .post('/api/v1/geocode/reverse')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ lat: -31.42, lng: -64.18 })
        .expect(200);
    });
  });
});

// ─── Service unit: rate limit, single-flight, normalization ──────────────────

describe('Geocode service — rate limit & single-flight', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetGeocodeState();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('spaces outgoing Nominatim calls at least 1000 ms apart', async () => {
    const callTimes: number[] = [];
    const mockFetch = vi.fn().mockImplementation(() => {
      callTimes.push(Date.now());
      return Promise.resolve(nominatimResponse([{ lat: '1', lon: '2', display_name: 'One' }]));
    });
    vi.stubGlobal('fetch', mockFetch);

    const first = geocodeAddress('Address One');
    await vi.advanceTimersByTimeAsync(0);
    await first;

    const second = geocodeAddress('Address Two');
    await vi.advanceTimersByTimeAsync(999);
    expect(mockFetch).toHaveBeenCalledTimes(1); // still inside the 1s window
    await vi.advanceTimersByTimeAsync(1);
    await second;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(callTimes[1]! - callTimes[0]!).toBeGreaterThanOrEqual(1000);
  });

  it('deduplicates identical concurrent requests (single-flight)', async () => {
    let resolveFetch!: (value: unknown) => void;
    const mockFetch = vi.fn().mockImplementation(() => new Promise(resolve => { resolveFetch = resolve; }));
    vi.stubGlobal('fetch', mockFetch);

    const first = geocodeAddress('Same Place');
    const second = geocodeAddress('same   place'); // normalized identical → joins in-flight

    await vi.advanceTimersByTimeAsync(1000); // first passes the rate-limit wait
    expect(mockFetch).toHaveBeenCalledTimes(1);

    resolveFetch(nominatimResponse([{ lat: '-34.6', lon: '-58.4', display_name: 'Place' }]));
    await vi.advanceTimersByTimeAsync(0);

    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toEqual(r2);
    expect(r1.lat).toBe(-34.6);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('normalizes address case and whitespace to the same cache key', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      nominatimResponse([{ lat: '1', lon: '2', display_name: 'Normalized' }])
    );
    vi.stubGlobal('fetch', mockFetch);

    const a = await geocodeAddress('Av. Siempre Viva 742');
    const b = await geocodeAddress('  av. siempre   viva 742 ');

    expect(a).toEqual(b);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});