import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { Types } from 'mongoose';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  seedDriverUser,
  loginAs
} from './helpers.js';
import { app } from '../app.js';
import { Vehicle } from '../modules/vehicles/model.js';
import { User } from '../modules/auth/model.js';
import { Expense } from '../modules/expenses/model.js';
import { Route } from '../modules/routes/model.js';

const request = supertest(app);

describe('Vehicles API', () => {
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

  describe('POST /api/v1/vehicles', () => {
    it('creates a vehicle as active and returns 201 (R1)', async () => {
      const res = await request
        .post('/api/v1/vehicles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Fiorino', model: 'Furgón', plate: 'AB123CD', fuelType: 'nafta', km: 1200 })
        .expect(201);

      expect(res.body.name).toBe('Fiorino');
      expect(res.body.model).toBe('Furgón');
      expect(res.body.plate).toBe('AB123CD');
      expect(res.body.fuelType).toBe('nafta');
      expect(res.body.km).toBe(1200);
      expect(res.body.active).toBe(true);
      expect(res.body.driverId).toBeNull();
      expect(res.body._id).toBeDefined();
    });

    it('rejects a duplicate plate with 409 (R2)', async () => {
      await Vehicle.create({ name: 'Fiorino', plate: 'AB123CD' });

      const res = await request
        .post('/api/v1/vehicles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Otra camioneta', plate: 'AB123CD' })
        .expect(409);

      expect(res.body.error).toMatch(/plate/i);
    });

    it('rejects a non-driver driverId with 400 (R3)', async () => {
      const adminUser = await User.findOne({ role: 'admin' });

      const res = await request
        .post('/api/v1/vehicles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Fiorino', plate: 'AB123CD', driverId: adminUser!._id.toString() })
        .expect(400);

      expect(res.body.error).toMatch(/not a driver/i);
    });

    it('rejects an unknown driverId with 404 (R3)', async () => {
      const res = await request
        .post('/api/v1/vehicles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Fiorino', plate: 'AB123CD', driverId: '000000000000000000000000' })
        .expect(404);

      expect(res.body.error).toMatch(/driver not found/i);
    });

    it('accepts a driver driverId and stores it (R3)', async () => {
      const driver = await User.findOne({ role: 'driver' });

      const res = await request
        .post('/api/v1/vehicles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Fiorino', plate: 'AB123CD', driverId: driver!._id.toString() })
        .expect(201);

      expect(res.body.driverId).toBe(driver!._id.toString());
    });

    it('returns 401 without a token', async () => {
      await request
        .post('/api/v1/vehicles')
        .send({ name: 'Sin token', plate: 'AB123CD' })
        .expect(401);
    });

    it('returns 403 for a driver (admin only)', async () => {
      await request
        .post('/api/v1/vehicles')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ name: 'Driver attempt', plate: 'AB123CD' })
        .expect(403);
    });
  });

  describe('GET /api/v1/vehicles', () => {
    it('returns only active vehicles by default', async () => {
      await Vehicle.create([
        { name: 'Fiorino A', plate: 'AAA111', active: true },
        { name: 'Fiorino B', plate: 'BBB222', active: false },
        { name: 'Fiorino C', plate: 'CCC333', active: true }
      ]);

      const res = await request
        .get('/api/v1/vehicles')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body.every((v: { active: boolean }) => v.active === true)).toBe(true);
    });

    it('returns inactive vehicles too when includeInactive=true', async () => {
      await Vehicle.create([
        { name: 'Fiorino A', plate: 'AAA111', active: true },
        { name: 'Fiorino B', plate: 'BBB222', active: false }
      ]);

      const res = await request
        .get('/api/v1/vehicles?includeInactive=true')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveLength(2);
    });
  });

  describe('PUT /api/v1/vehicles/:id', () => {
    it('updates fields and returns 200', async () => {
      const vehicle = await Vehicle.create({ name: 'Fiorino', plate: 'AB123CD' });

      const res = await request
        .put(`/api/v1/vehicles/${vehicle._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Fiorino 2024', km: 5000, consumptionKmPerL: 12.5 })
        .expect(200);

      expect(res.body.name).toBe('Fiorino 2024');
      expect(res.body.km).toBe(5000);
      expect(res.body.consumptionKmPerL).toBe(12.5);
      expect(res.body.plate).toBe('AB123CD');
    });

    it('returns 404 for an unknown vehicle', async () => {
      await request
        .put('/api/v1/vehicles/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Xx' })
        .expect(404);
    });
  });

  describe('PATCH /api/v1/vehicles/:id/status', () => {
    it('deactivates an active vehicle and excludes it from the default list', async () => {
      const vehicle = await Vehicle.create({ name: 'Fiorino', plate: 'AB123CD' });

      const res = await request
        .patch(`/api/v1/vehicles/${vehicle._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'inactive' })
        .expect(200);

      expect(res.body.active).toBe(false);

      const list = await request
        .get('/api/v1/vehicles')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(list.body).toHaveLength(0);
    });

    it('reactivates a deactivated vehicle', async () => {
      const vehicle = await Vehicle.create({ name: 'Fiorino', plate: 'AB123CD', active: false });

      const res = await request
        .patch(`/api/v1/vehicles/${vehicle._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'active' })
        .expect(200);

      expect(res.body.active).toBe(true);
    });

    it('returns 409 when deactivating an already inactive vehicle', async () => {
      const vehicle = await Vehicle.create({ name: 'Fiorino', plate: 'AB123CD', active: false });

      await request
        .patch(`/api/v1/vehicles/${vehicle._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'inactive' })
        .expect(409);
    });
  });

  describe('GET /api/v1/vehicles/:id (detail)', () => {
    it('aggregates costsByCategory, deliveryStats and recentRoutes', async () => {
      const vehicle = await Vehicle.create({ name: 'Fiorino', plate: 'AB123CD' });
      const other = await Vehicle.create({ name: 'Kangoo', plate: 'ZZZ999' });
      const driver = await User.findOne({ role: 'driver' });

      // Tagged fuel/repair/insurance count; salary is excluded; other vehicle
      // expenses are excluded (vehicleId filter).
      await Expense.create([
        { amount: 100, category: 'fuel', date: new Date('2026-08-01'), description: 'Fuel', createdBy: 'admin', vehicleId: vehicle._id },
        { amount: 200, category: 'repair', date: new Date('2026-08-02'), description: 'Repair', createdBy: 'admin', vehicleId: vehicle._id },
        { amount: 50, category: 'insurance', date: new Date('2026-08-03'), description: 'Insurance', createdBy: 'admin', vehicleId: vehicle._id },
        { amount: 999, category: 'salary', date: new Date('2026-08-04'), description: 'Salary', createdBy: 'admin', vehicleId: vehicle._id },
        { amount: 777, category: 'fuel', date: new Date('2026-08-05'), description: 'Other vehicle', createdBy: 'admin', vehicleId: other._id }
      ]);

      const makeRoute = async (
        routeNumber: string,
        date: string,
        delivered: number,
        skipped = 0
      ): Promise<void> => {
        const stops = [];
        for (let i = 1; i <= delivered; i++) {
          stops.push({
            orderId: new Types.ObjectId(),
            orderNumber: `${routeNumber}-O${i}`,
            customerId: new Types.ObjectId(),
            customerName: 'Cliente',
            customerAddress: 'Calle 1',
            customerPhone: '1234',
            sequence: i,
            status: 'delivered',
            deliveredAt: new Date()
          });
        }
        for (let i = delivered + 1; i <= delivered + skipped; i++) {
          stops.push({
            orderId: new Types.ObjectId(),
            orderNumber: `${routeNumber}-O${i}`,
            customerId: new Types.ObjectId(),
            customerName: 'Cliente',
            customerAddress: 'Calle 1',
            customerPhone: '1234',
            sequence: i,
            status: 'skipped'
          });
        }
        await Route.create({
          routeNumber,
          driverId: driver!._id,
          driverName: 'Test Driver',
          vehicleId: vehicle._id,
          vehicleName: 'Fiorino',
          kmTravelled: 10,
          plannedDate: new Date(date),
          status: 'completed',
          stops
        });
      };

      await makeRoute('RTE-TEST-001', '2026-08-10', 2, 1);
      await makeRoute('RTE-TEST-002', '2026-08-11', 2);

      const res = await request
        .get(`/api/v1/vehicles/${vehicle._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.costsByCategory).toEqual({ fuel: 100, repair: 200, insurance: 50, maintenance: 0 });
      expect(res.body.deliveryStats.routesCount).toBe(2);
      expect(res.body.deliveryStats.deliveredStops).toBe(4);
      // Σ tagged (350) ÷ 4 delivered stops
      expect(res.body.deliveryStats.costPerDelivery).toBe(87.5);
      expect(res.body.recentRoutes).toHaveLength(2);
      expect(res.body.recentRoutes[0].routeNumber).toBe('RTE-TEST-002');
      expect(res.body.name).toBe('Fiorino');
    });

    it('returns zeros and empty recentRoutes for a vehicle without expenses or routes', async () => {
      const vehicle = await Vehicle.create({ name: 'Fiorino', plate: 'AB123CD' });

      const res = await request
        .get(`/api/v1/vehicles/${vehicle._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.costsByCategory).toEqual({ fuel: 0, repair: 0, insurance: 0, maintenance: 0 });
      expect(res.body.deliveryStats).toEqual({ routesCount: 0, deliveredStops: 0, costPerDelivery: 0 });
      expect(res.body.recentRoutes).toEqual([]);
    });

    it('returns 404 for an unknown vehicle', async () => {
      await request
        .get('/api/v1/vehicles/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });
});