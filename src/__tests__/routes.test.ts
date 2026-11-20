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
  indexTestUser,
  app
} from './helpers.js';
import { User } from '../modules/auth/model.js';
import { Vehicle } from '../modules/vehicles/model.js';
import { Inventory } from '../modules/inventory/model.js';
import { StockTransaction } from '../modules/inventory/transaction-model.js';

const request = supertest(app);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const createOrderViaApi = async (token: string, customerId: string, productId: string) => {
  const response = await request
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      customerId,
      channel: 'phone',
      items: [{ productId, quantity: 1 }]
    });
  return response.body;
};

const getDriverId = async (): Promise<string> => {
  const driver = await User.findOne({ role: 'driver' });
  return driver!._id.toString();
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Routes Integration', () => {
  let adminToken: string;
  let driverToken: string;
  let secondDriverToken: string;

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

    // Seed a second driver for permission tests
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.default.hash('testpassword', 10);
    const otherDriver = await User.create({ name: 'Other Driver', email: 'other-driver@test.com', passwordHash: hash, role: 'driver' });
    await indexTestUser('other-driver@test.com', otherDriver._id);
    secondDriverToken = await loginAs(request, 'other-driver@test.com', 'testpassword');
  });

  // ─── POST /api/v1/routes ──────────────────────────────────────────────────

  describe('POST /api/v1/routes', () => {
    it('creates a route with valid data', async () => {
      const driverId = await getDriverId();
      const response = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' })
        .expect(201);

      expect(response.body.routeNumber).toMatch(/^RTE-/);
      expect(response.body.driverId).toBe(driverId);
      expect(response.body.status).toBe('planned');
      expect(response.body.stops).toEqual([]);
      expect(response.body.startedAt).toBeNull();
    });

    it('rejects creation with non-driver user', async () => {
      const adminUser = await User.findOne({ role: 'admin' });
      const response = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId: adminUser!._id.toString(), plannedDate: '2026-08-25' })
        .expect(400);

      expect(response.body.error).toMatch(/not a driver/i);
    });

    it('rejects creation with invalid driver ID', async () => {
      const fakeId = '000000000000000000000000';
      const response = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId: fakeId, plannedDate: '2026-08-25' })
        .expect(404);

      expect(response.body.error).toMatch(/driver not found/i);
    });

    it('rejects creation without auth', async () => {
      const driverId = await getDriverId();
      await request
        .post('/api/v1/routes')
        .send({ driverId, plannedDate: '2026-08-25' })
        .expect(401);
    });

    it('rejects creation by driver (admin only)', async () => {
      const driverId = await getDriverId();
      await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ driverId, plannedDate: '2026-08-25' })
        .expect(403);
    });

    it('generates sequential route numbers', async () => {
      const driverId = await getDriverId();

      const r1 = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' })
        .expect(201);

      const r2 = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' })
        .expect(201);

      expect(r1.body.routeNumber).toMatch(/RTE-\d{8}-001/);
      expect(r2.body.routeNumber).toMatch(/RTE-\d{8}-002/);
    });
  });

  // ─── GET /api/v1/routes ───────────────────────────────────────────────────

  describe('GET /api/v1/routes', () => {
    it('admin lists all routes', async () => {
      const driverId = await getDriverId();
      await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      const response = await request
        .get('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.length).toBe(1);
    });

    it('driver sees only own routes', async () => {
      const driverId = await getDriverId();

      // Create route for the logged-in driver
      await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      // Create route for a different driver
      const otherDriver = await User.findOne({ email: 'other-driver@test.com' });
      await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId: otherDriver!._id.toString(), plannedDate: '2026-08-25' });

      const response = await request
        .get('/api/v1/routes')
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(200);

      expect(response.body.length).toBe(1);
      expect(response.body[0].driverId).toBe(driverId);
    });

    it('filters by status', async () => {
      const driverId = await getDriverId();
      const createRes = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      // Start the route
      await request
        .patch(`/api/v1/routes/${createRes.body._id}/start`)
        .set('Authorization', `Bearer ${adminToken}`);

      const response = await request
        .get('/api/v1/routes?status=in_progress')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.length).toBe(1);
      expect(response.body[0].status).toBe('in_progress');
    });
  });

  // ─── GET /api/v1/routes/:id ───────────────────────────────────────────────

  describe('GET /api/v1/routes/:id', () => {
    it('admin gets route by ID', async () => {
      const driverId = await getDriverId();
      const created = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      const response = await request
        .get(`/api/v1/routes/${created.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.routeNumber).toBe(created.body.routeNumber);
    });

    it('driver gets own route by ID', async () => {
      const driverId = await getDriverId();
      const created = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      const response = await request
        .get(`/api/v1/routes/${created.body._id}`)
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(200);

      expect(response.body._id).toBe(created.body._id);
    });

    it('driver cannot see another driver route', async () => {
      const otherDriver = await User.findOne({ email: 'other-driver@test.com' });
      const created = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId: otherDriver!._id.toString(), plannedDate: '2026-08-25' });

      await request
        .get(`/api/v1/routes/${created.body._id}`)
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(403);
    });

    it('returns 404 for non-existent route', async () => {
      await request
        .get('/api/v1/routes/000000000000000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  // ─── GET /api/v1/routes/driver/active ─────────────────────────────────────

  describe('GET /api/v1/routes/driver/active', () => {
    it('returns driver active in_progress route', async () => {
      const driverId = await getDriverId();
      const created = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      await request
        .patch(`/api/v1/routes/${created.body._id}/start`)
        .set('Authorization', `Bearer ${adminToken}`);

      const response = await request
        .get('/api/v1/routes/driver/active')
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(200);

      expect(response.body.status).toBe('in_progress');
    });

    it('returns 404 when no active route', async () => {
      await request
        .get('/api/v1/routes/driver/active')
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(404);
    });

    it('admin cannot access driver/active (driver-only)', async () => {
      await request
        .get('/api/v1/routes/driver/active')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
    });
  });

  // ─── POST /api/v1/routes/:id/stops ────────────────────────────────────────

  describe('POST /api/v1/routes/:id/stops', () => {
    it('adds a stop to a planned route', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);

      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      const response = await request
        .post(`/api/v1/routes/${route.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order._id })
        .expect(201);

      expect(response.body.stops).toHaveLength(1);
      expect(response.body.stops[0].orderNumber).toBe(order.orderNumber);
      expect(response.body.stops[0].sequence).toBe(1);
      expect(response.body.stops[0].status).toBe('pending');
      expect(response.body.stops[0].customerName).toBe('Test Customer');
    });

    it('auto-transitions order to assigned when adding to route', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);

      expect(order.status).toBe('pending');

      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      await request
        .post(`/api/v1/routes/${route.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order._id })
        .expect(201);

      // Verify order status changed
      const orderRes = await request
        .get(`/api/v1/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(orderRes.body.status).toBe('assigned');
      expect(orderRes.body.routeId).toBe(route.body._id);
    });

    it('rejects adding order already on a route', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);

      const r1 = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      const r2 = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      // Add to first route
      await request
        .post(`/api/v1/routes/${r1.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order._id });

      // Try adding to second route
      const response = await request
        .post(`/api/v1/routes/${r2.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order._id })
        .expect(409);

      expect(response.body.error).toMatch(/already assigned/i);
    });

    it('rejects adding stop to non-planned route', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);

      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      await request
        .patch(`/api/v1/routes/${route.body._id}/start`)
        .set('Authorization', `Bearer ${adminToken}`);

      await request
        .post(`/api/v1/routes/${route.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order._id })
        .expect(409);
    });

    it('assigns incrementing sequences to stops', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const o1 = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);
      const o2 = await createOrderViaApi(adminToken, customer._id as string, products['castaño-chico']!);

      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      await request
        .post(`/api/v1/routes/${route.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: o1._id });

      const res = await request
        .post(`/api/v1/routes/${route.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: o2._id })
        .expect(201);

      expect(res.body.stops).toHaveLength(2);
      expect(res.body.stops[0].sequence).toBe(1);
      expect(res.body.stops[1].sequence).toBe(2);
    });

    it('snapshots stop location from the order deliveryLocation', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer(); // no customer location
      const products = await getProductIds();

      const orderRes = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: products['blanco-chico'], quantity: 1 }],
          deliveryLocation: { lat: -34.6037, lng: -58.3816 }
        })
        .expect(201);

      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      const response = await request
        .post(`/api/v1/routes/${route.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: orderRes.body._id })
        .expect(201);

      expect(response.body.stops[0].location).toEqual({ lat: -34.6037, lng: -58.3816 });
    });

    it('falls back to the customer location when the order has none', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer({
        location: { type: 'Point', coordinates: [-58.4, -34.6] } // [lng, lat]
      });
      const products = await getProductIds();
      const order = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);

      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      const response = await request
        .post(`/api/v1/routes/${route.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order._id })
        .expect(201);

      expect(response.body.stops[0].location).toEqual({ lat: -34.6, lng: -58.4 });
    });

    it('leaves stop location undefined when neither order nor customer has coordinates', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);

      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      const response = await request
        .post(`/api/v1/routes/${route.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order._id })
        .expect(201);

      expect(response.body.stops[0].location).toBeUndefined();
    });
  });

  // ─── DELETE /api/v1/routes/:id/stops/:stopId ──────────────────────────────

  describe('DELETE /api/v1/routes/:id/stops/:stopId', () => {
    it('removes a pending stop and clears order route link', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);

      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      const withStop = await request
        .post(`/api/v1/routes/${route.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order._id });

      const stopId = withStop.body.stops[0]._id;

      const response = await request
        .delete(`/api/v1/routes/${route.body._id}/stops/${stopId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.stops).toHaveLength(0);

      // Verify order route link cleared
      const orderRes = await request
        .get(`/api/v1/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(orderRes.body.routeId).toBeNull();
      expect(orderRes.body.routeStopId).toBeNull();
    });

    it('re-sequences remaining stops after removal', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const o1 = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);
      const o2 = await createOrderViaApi(adminToken, customer._id as string, products['castaño-chico']!);
      const o3 = await createOrderViaApi(adminToken, customer._id as string, products['blanco-grande']!);

      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      await request.post(`/api/v1/routes/${route.body._id}/stops`).set('Authorization', `Bearer ${adminToken}`).send({ orderId: o1._id });
      const s2 = await request.post(`/api/v1/routes/${route.body._id}/stops`).set('Authorization', `Bearer ${adminToken}`).send({ orderId: o2._id });
      await request.post(`/api/v1/routes/${route.body._id}/stops`).set('Authorization', `Bearer ${adminToken}`).send({ orderId: o3._id });

      // Remove middle stop
      const midStopId = s2.body.stops[1]._id;
      const response = await request
        .delete(`/api/v1/routes/${route.body._id}/stops/${midStopId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.stops).toHaveLength(2);
      expect(response.body.stops[0].sequence).toBe(1);
      expect(response.body.stops[1].sequence).toBe(2);
    });
  });

  // ─── PATCH /api/v1/routes/:id/stops/reorder ───────────────────────────────

  describe('PATCH /api/v1/routes/:id/stops/reorder', () => {
    it('reorders stops with new sequences', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const o1 = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);
      const o2 = await createOrderViaApi(adminToken, customer._id as string, products['castaño-chico']!);

      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      await request.post(`/api/v1/routes/${route.body._id}/stops`).set('Authorization', `Bearer ${adminToken}`).send({ orderId: o1._id });
      await request.post(`/api/v1/routes/${route.body._id}/stops`).set('Authorization', `Bearer ${adminToken}`).send({ orderId: o2._id });

      // Get current route to get stop IDs
      const current = await request
        .get(`/api/v1/routes/${route.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      const stopIds = current.body.stops.map((s: { _id: string }) => s._id);

      // Reverse order
      const response = await request
        .patch(`/api/v1/routes/${route.body._id}/stops/reorder`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ stopOrder: [stopIds[1], stopIds[0]] })
        .expect(200);

      // Verify sequences swapped
      const reordered = response.body.stops.sort((a: { sequence: number }, b: { sequence: number }) => a.sequence - b.sequence);
      expect(reordered[0].orderNumber).toBe(o2.orderNumber);
      expect(reordered[1].orderNumber).toBe(o1.orderNumber);
    });

    it('rejects reorder with missing stop IDs', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const o1 = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);

      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      await request.post(`/api/v1/routes/${route.body._id}/stops`).set('Authorization', `Bearer ${adminToken}`).send({ orderId: o1._id });

      await request
        .patch(`/api/v1/routes/${route.body._id}/stops/reorder`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ stopOrder: [] })
        .expect(400);
    });
  });

  // ─── Route lifecycle: start, complete, cancel ─────────────────────────────

  describe('Route lifecycle', () => {
    it('starts a planned route', async () => {
      const driverId = await getDriverId();
      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      const response = await request
        .patch(`/api/v1/routes/${route.body._id}/start`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.status).toBe('in_progress');
      expect(response.body.startedAt).not.toBeNull();
    });

    it('completes route when all stops delivered', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);

      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      const withStop = await request
        .post(`/api/v1/routes/${route.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order._id });

      await request.patch(`/api/v1/routes/${route.body._id}/start`).set('Authorization', `Bearer ${adminToken}`);

      // Advance stop: pending → in_transit → delivered
      const stopId = withStop.body.stops[0]._id;
      await request
        .patch(`/api/v1/routes/${route.body._id}/stops/${stopId}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'in_transit' });

      await request
        .patch(`/api/v1/routes/${route.body._id}/stops/${stopId}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'delivered' });

      const response = await request
        .patch(`/api/v1/routes/${route.body._id}/complete`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.status).toBe('completed');
      expect(response.body.completedAt).not.toBeNull();
    });

    it('rejects completing route with pending stops', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);

      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      await request
        .post(`/api/v1/routes/${route.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order._id });

      await request.patch(`/api/v1/routes/${route.body._id}/start`).set('Authorization', `Bearer ${adminToken}`);

      const response = await request
        .patch(`/api/v1/routes/${route.body._id}/complete`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);

      expect(response.body.error).toMatch(/pending|in transit/i);
    });

    it('cancels route and clears pending stop links', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);

      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      await request
        .post(`/api/v1/routes/${route.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order._id });

      const response = await request
        .patch(`/api/v1/routes/${route.body._id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.status).toBe('cancelled');

      // Verify order route link cleared
      const orderRes = await request
        .get(`/api/v1/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(orderRes.body.routeId).toBeNull();
    });

    it('rejects starting a completed route', async () => {
      const driverId = await getDriverId();
      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      // Start → complete (no stops, so can complete immediately)
      await request.patch(`/api/v1/routes/${route.body._id}/start`).set('Authorization', `Bearer ${adminToken}`);
      await request.patch(`/api/v1/routes/${route.body._id}/complete`).set('Authorization', `Bearer ${adminToken}`);

      // Try starting again
      await request
        .patch(`/api/v1/routes/${route.body._id}/start`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });
  });

  // ─── Advance stop (driver operations) ─────────────────────────────────────

  describe('PATCH /api/v1/routes/:id/stops/:stopId/advance', () => {
    it('driver advances stop pending → in_transit', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);

      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      const withStop = await request
        .post(`/api/v1/routes/${route.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order._id });

      await request.patch(`/api/v1/routes/${route.body._id}/start`).set('Authorization', `Bearer ${adminToken}`);

      const stopId = withStop.body.stops[0]._id;
      const response = await request
        .patch(`/api/v1/routes/${route.body._id}/stops/${stopId}/advance`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'in_transit' })
        .expect(200);

      expect(response.body.stops[0].status).toBe('in_transit');

      // Verify order also transitioned
      const orderRes = await request
        .get(`/api/v1/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(orderRes.body.status).toBe('in_transit');
    });

    it('driver advances stop in_transit → delivered', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);

      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      const withStop = await request
        .post(`/api/v1/routes/${route.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order._id });

      await request.patch(`/api/v1/routes/${route.body._id}/start`).set('Authorization', `Bearer ${adminToken}`);

      const stopId = withStop.body.stops[0]._id;
      await request
        .patch(`/api/v1/routes/${route.body._id}/stops/${stopId}/advance`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'in_transit' });

      const response = await request
        .patch(`/api/v1/routes/${route.body._id}/stops/${stopId}/advance`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'delivered' })
        .expect(200);

      expect(response.body.stops[0].status).toBe('delivered');
      expect(response.body.stops[0].deliveredAt).not.toBeNull();

      // Verify order also delivered
      const orderRes = await request
        .get(`/api/v1/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(orderRes.body.status).toBe('delivered');

      // Stock left the warehouse and the tracking flag is set (enables
      // restore when the delivery is undone or the order cancelled).
      expect(orderRes.body.stockDeducted).toBe(true);
    });

    it('route delivery decrements stock exactly once (no double decrement)', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const productId = products['blanco-chico']!;
      const order = await createOrderViaApi(adminToken, customer._id as string, productId);

      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      const withStop = await request
        .post(`/api/v1/routes/${route.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order._id });

      await request.patch(`/api/v1/routes/${route.body._id}/start`).set('Authorization', `Bearer ${adminToken}`);

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

      // advanceStop deducts once, then transitionOrderStatus must see
      // stockDeducted=true and skip its own decrement → stock drops by 1 only.
      const inv = await Inventory.findOne({ productId });
      expect(inv!.quantity).toBe(99); // 100 - 1

      const txns = await StockTransaction.find({ orderId: order._id, type: 'delivery' });
      expect(txns).toHaveLength(1);
      expect(txns[0]!.quantity).toBe(-1);
    });

    it('driver advances stop to skipped — clears order route link', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);

      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      const withStop = await request
        .post(`/api/v1/routes/${route.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order._id });

      await request.patch(`/api/v1/routes/${route.body._id}/start`).set('Authorization', `Bearer ${adminToken}`);

      const stopId = withStop.body.stops[0]._id;
      await request
        .patch(`/api/v1/routes/${route.body._id}/stops/${stopId}/advance`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'skipped' })
        .expect(200);

      // Verify order route link cleared
      const orderRes = await request
        .get(`/api/v1/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(orderRes.body.routeId).toBeNull();
    });

    it('rejects driver advancing stop on another driver route', async () => {
      const otherDriver = await User.findOne({ email: 'other-driver@test.com' });
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);

      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId: otherDriver!._id.toString(), plannedDate: '2026-08-25' });

      const withStop = await request
        .post(`/api/v1/routes/${route.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order._id });

      await request.patch(`/api/v1/routes/${route.body._id}/start`).set('Authorization', `Bearer ${adminToken}`);

      const stopId = withStop.body.stops[0]._id;
      await request
        .patch(`/api/v1/routes/${route.body._id}/stops/${stopId}/advance`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'in_transit' })
        .expect(403);
    });

    it('rejects invalid stop transition (delivered → pending)', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);

      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      const withStop = await request
        .post(`/api/v1/routes/${route.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order._id });

      await request.patch(`/api/v1/routes/${route.body._id}/start`).set('Authorization', `Bearer ${adminToken}`);

      const stopId = withStop.body.stops[0]._id;
      // pending → delivered (skip in_transit) should fail
      await request
        .patch(`/api/v1/routes/${route.body._id}/stops/${stopId}/advance`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'delivered' })
        .expect(409);
    });

    it('rejects advancing stop when route not in progress', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);

      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      const withStop = await request
        .post(`/api/v1/routes/${route.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order._id });

      // Route is still planned, not started
      const stopId = withStop.body.stops[0]._id;
      await request
        .patch(`/api/v1/routes/${route.body._id}/stops/${stopId}/advance`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'in_transit' })
        .expect(409);
    });

    it('driver can add notes to stop', async () => {
      const driverId = await getDriverId();
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);

      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' });

      const withStop = await request
        .post(`/api/v1/routes/${route.body._id}/stops`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId: order._id });

      await request.patch(`/api/v1/routes/${route.body._id}/start`).set('Authorization', `Bearer ${adminToken}`);

      const stopId = withStop.body.stops[0]._id;
      const response = await request
        .patch(`/api/v1/routes/${route.body._id}/stops/${stopId}/notes`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ notes: 'Customer not home, will retry' })
        .expect(200);

      expect(response.body.stops[0].notes).toBe('Customer not home, will retry');
    });
  });

  // ─── POST /api/v1/routes/:id/optimize ────────────────────────────────────

  describe('POST /api/v1/routes/:id/optimize', () => {
    const createOrderWithLocation = async (
      token: string,
      customerId: string,
      productId: string,
      location: { lat: number; lng: number }
    ) => {
      const response = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({
          customerId,
          channel: 'phone',
          items: [{ productId, quantity: 1 }],
          deliveryLocation: location
        })
        .expect(201);
      return response.body;
    };

    const createRouteWithStops = async (stops: Array<{ orderId: string }>) => {
      const driverId = await getDriverId();
      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' })
        .expect(201);

      for (const stop of stops) {
        await request
          .post(`/api/v1/routes/${route.body._id}/stops`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ orderId: stop.orderId })
          .expect(201);
      }
      return route.body;
    };

    const sortedStops = (route: { stops: Array<{ orderNumber: string; sequence: number }> }) =>
      [...route.stops].sort((a, b) => a.sequence - b.sequence).map((s) => s.orderNumber);

    it('orders 3 stops by proximity from the given start', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const oNear = await createOrderWithLocation(adminToken, customer._id as string, products['blanco-chico']!, { lat: 0, lng: 0.5 });
      const oMid = await createOrderWithLocation(adminToken, customer._id as string, products['castaño-chico']!, { lat: 0, lng: 1 });
      const oFar = await createOrderWithLocation(adminToken, customer._id as string, products['blanco-grande']!, { lat: 10, lng: 10 });

      const route = await createRouteWithStops([
        { orderId: oFar._id },
        { orderId: oNear._id },
        { orderId: oMid._id }
      ]);

      const response = await request
        .post(`/api/v1/routes/${route._id}/optimize`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ start: { lat: 0, lng: 0 } })
        .expect(200);

      expect(sortedStops(response.body)).toEqual([oNear.orderNumber, oMid.orderNumber, oFar.orderNumber]);
    });

    it('falls back to the first stop location when no start is provided', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const o1 = await createOrderWithLocation(adminToken, customer._id as string, products['blanco-chico']!, { lat: 0, lng: 1 });
      const o2 = await createOrderWithLocation(adminToken, customer._id as string, products['castaño-chico']!, { lat: 0, lng: 0.5 });

      const route = await createRouteWithStops([
        { orderId: o1._id },
        { orderId: o2._id }
      ]);

      const response = await request
        .post(`/api/v1/routes/${route._id}/optimize`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(200);

      // Start = first stop (o1 at lng 1) → o2 is closer than nothing left.
      expect(sortedStops(response.body)).toEqual([o1.orderNumber, o2.orderNumber]);
    });

    it('appends stops without location at the end', async () => {
      const customer = await createTestCustomer();
      const noLocationCustomer = await createTestCustomer();
      const products = await getProductIds();
      const oA = await createOrderWithLocation(adminToken, customer._id as string, products['blanco-chico']!, { lat: 0, lng: 1 });
      const oB = await createOrderWithLocation(adminToken, customer._id as string, products['castaño-chico']!, { lat: 0, lng: 0.5 });
      // Order without deliveryLocation + customer without location → stop has no coords
      const oNoLoc = await createOrderViaApi(adminToken, noLocationCustomer._id as string, products['blanco-grande']!);

      const route = await createRouteWithStops([
        { orderId: oA._id },
        { orderId: oNoLoc._id },
        { orderId: oB._id }
      ]);

      const response = await request
        .post(`/api/v1/routes/${route._id}/optimize`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ start: { lat: 0, lng: 0 } })
        .expect(200);

      const order = sortedStops(response.body);
      expect(order.slice(0, 2)).toEqual([oB.orderNumber, oA.orderNumber]);
      expect(order[2]).toBe(oNoLoc.orderNumber);
    });

    it('is a no-op on a route with no stops', async () => {
      const driverId = await getDriverId();
      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' })
        .expect(201);

      const response = await request
        .post(`/api/v1/routes/${route.body._id}/optimize`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ start: { lat: 0, lng: 0 } })
        .expect(200);

      expect(response.body.stops).toEqual([]);
    });

    it('returns 404 for a non-existent route', async () => {
      await request
        .post('/api/v1/routes/000000000000000000000000/optimize')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ start: { lat: 0, lng: 0 } })
        .expect(404);
    });

    it('rejects optimization by driver (admin only)', async () => {
      const driverId = await getDriverId();
      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' })
        .expect(201);

      await request
        .post(`/api/v1/routes/${route.body._id}/optimize`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ start: { lat: 0, lng: 0 } })
        .expect(403);
    });

    it('rejects invalid start coordinates', async () => {
      const driverId = await getDriverId();
      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' })
        .expect(201);

      await request
        .post(`/api/v1/routes/${route.body._id}/optimize`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ start: { lat: 999, lng: 0 } })
        .expect(400);
    });
  });

  // ─── Order state machine extensions (in_transit) ──────────────────────────

  describe('Order state machine — in_transit', () => {
    it('admin can transition assigned → in_transit', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);

      await request
        .patch(`/api/v1/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'assigned' });

      const response = await request
        .patch(`/api/v1/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'in_transit' })
        .expect(200);

      expect(response.body.status).toBe('in_transit');
    });

    it('admin can transition in_transit → delivered', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);

      await request.patch(`/api/v1/orders/${order._id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'assigned' });
      await request.patch(`/api/v1/orders/${order._id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'in_transit' });

      const response = await request
        .patch(`/api/v1/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'delivered' })
        .expect(200);

      expect(response.body.status).toBe('delivered');
    });

    it('rejects pending → in_transit (must go through assigned)', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);

      await request
        .patch(`/api/v1/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'in_transit' })
        .expect(409);
    });

    it('driver can transition assigned → in_transit via driver endpoint', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);

      await request
        .patch(`/api/v1/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'assigned' });

      const response = await request
        .patch(`/api/v1/orders/${order._id}/driver-transition`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'in_transit' })
        .expect(200);

      expect(response.body.status).toBe('in_transit');
    });

    it('driver cannot transition to delivered via driver endpoint', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();
      const order = await createOrderViaApi(adminToken, customer._id as string, products['blanco-chico']!);

      await request.patch(`/api/v1/orders/${order._id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'assigned' });
      await request.patch(`/api/v1/orders/${order._id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'in_transit' });

      await request
        .patch(`/api/v1/orders/${order._id}/driver-transition`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'delivered' })
        .expect(403);
    });
  });

  // ─── Route vehicle link (route-vehicle-link R1) ───────────────────────────

  describe('POST /api/v1/routes with vehicleId', () => {
    it('stores vehicleId and vehicleName snapshot when vehicleId is provided', async () => {
      const driverId = await getDriverId();
      const vehicle = await Vehicle.create({ name: 'Fiorino', plate: 'AB123CD' });

      const res = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25', vehicleId: vehicle._id.toString() })
        .expect(201);

      expect(res.body.vehicleId).toBe(vehicle._id.toString());
      expect(res.body.vehicleName).toBe('Fiorino');
    });

    it('leaves vehicleId/vehicleName null when omitted', async () => {
      const driverId = await getDriverId();

      const res = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' })
        .expect(201);

      expect(res.body.vehicleId).toBeNull();
      expect(res.body.vehicleName).toBe('');
    });

    it('returns 404 when the vehicle does not exist', async () => {
      const driverId = await getDriverId();

      const res = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25', vehicleId: '000000000000000000000000' })
        .expect(404);

      expect(res.body.error).toMatch(/vehicle not found/i);
    });
  });

  // ─── Route completion with kmTravelled (route-vehicle-link R2) ────────────

  describe('PATCH /api/v1/routes/:id/complete with kmTravelled', () => {
    it('persists kmTravelled when provided', async () => {
      const driverId = await getDriverId();
      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' })
        .expect(201);

      await request
        .patch(`/api/v1/routes/${route.body._id}/start`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const res = await request
        .patch(`/api/v1/routes/${route.body._id}/complete`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ kmTravelled: 42 })
        .expect(200);

      expect(res.body.status).toBe('completed');
      expect(res.body.kmTravelled).toBe(42);
    });

    it('keeps kmTravelled null when omitted', async () => {
      const driverId = await getDriverId();
      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' })
        .expect(201);

      await request
        .patch(`/api/v1/routes/${route.body._id}/start`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const res = await request
        .patch(`/api/v1/routes/${route.body._id}/complete`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.status).toBe('completed');
      expect(res.body.kmTravelled).toBeNull();
    });

    it('rejects a negative kmTravelled', async () => {
      const driverId = await getDriverId();
      const route = await request
        .post('/api/v1/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driverId, plannedDate: '2026-08-25' })
        .expect(201);

      await request
        .patch(`/api/v1/routes/${route.body._id}/start`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request
        .patch(`/api/v1/routes/${route.body._id}/complete`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ kmTravelled: -5 })
        .expect(400);
    });
  });
});
