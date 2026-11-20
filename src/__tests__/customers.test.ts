import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { Types } from 'mongoose';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  seedDriverUser,
  loginAs,
  createTestCustomer
} from './helpers.js';
import { app } from '../app.js';
import { CustomerCharge } from '../modules/customer-charges/model.js';
import { Order } from '../modules/orders/model.js';

const request = supertest(app);

describe('Customers Integration', () => {
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

  describe('POST /api/v1/customers', () => {
    it('creates a B2C customer', async () => {
      const response = await request
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Maria Garcia',
          type: 'B2C',
          phone: '+56912345678',
          address: 'Santiago, Chile'
        })
        .expect(201);

      expect(response.body.name).toBe('Maria Garcia');
      expect(response.body.type).toBe('B2C');
      expect(response.body.status).toBe('active');
      expect(response.body._id).toBeDefined();
    });

    it('creates a B2B customer with taxId', async () => {
      const response = await request
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Supermarket ABC',
          type: 'B2B',
          phone: '+56922223333',
          address: 'Av. Principal 123',
          taxId: '76.123.456-7'
        })
        .expect(201);

      expect(response.body.type).toBe('B2B');
      expect(response.body.taxId).toBe('76.123.456-7');
    });

    it('allows B2B customer without taxId (CUIT/CUIL is optional)', async () => {
      const response = await request
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Supermarket ABC',
          type: 'B2B',
          phone: '+56922223333',
          address: 'Av. Principal 123'
        })
        .expect(201);

      expect(response.body.type).toBe('B2B');
      expect(response.body.taxId).toBeUndefined();
    });

    it('returns 403 when driver tries to create', async () => {
      await request
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          name: 'Test',
          type: 'B2C',
          phone: '+1234567890',
          address: '123 St'
        })
        .expect(403);
    });

    it('creates customer with credit config', async () => {
      const response = await request
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Credit Customer',
          type: 'B2B',
          phone: '+56911111111',
          address: 'Credit St',
          taxId: '12.345.678-9',
          creditConfig: { limit: 5000, termDays: 15 }
        })
        .expect(201);

      expect(response.body.creditConfig.limit).toBe(5000);
      expect(response.body.creditConfig.termDays).toBe(15);
    });

    it('persists optional location (GeoJSON Point) on create', async () => {
      const response = await request
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Located Customer',
          type: 'B2C',
          phone: '+56955556666',
          address: 'Av. Libertador 1500',
          location: { type: 'Point', coordinates: [-58.3816, -34.6037] }
        })
        .expect(201);

      expect(response.body.location).toEqual({ type: 'Point', coordinates: [-58.3816, -34.6037] });
    });

    it('persists optional addressDetail on create', async () => {
      const response = await request
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Detailed Customer',
          type: 'B2C',
          phone: '+56977778888',
          address: 'Av. Corrientes 1234, Almagro, CABA, Buenos Aires',
          addressDetail: {
            street: 'Av. Corrientes',
            number: '1234',
            floor: '3B',
            neighborhood: 'Almagro',
            city: 'CABA',
            province: 'Buenos Aires',
            postalCode: '1043',
            reference: 'Cerca de la estación Medrano'
          }
        })
        .expect(201);

      expect(response.body.addressDetail).toEqual({
        street: 'Av. Corrientes',
        number: '1234',
        floor: '3B',
        neighborhood: 'Almagro',
        city: 'CABA',
        province: 'Buenos Aires',
        postalCode: '1043',
        reference: 'Cerca de la estación Medrano'
      });
      // address (composed display string) remains independent and required
      expect(response.body.address).toBe('Av. Corrientes 1234, Almagro, CABA, Buenos Aires');
    });

    it('does not persist an all-empty addressDetail on create', async () => {
      const response = await request
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'No Detail',
          type: 'B2C',
          phone: '+56988889999',
          address: 'Calle 1 200',
          addressDetail: { street: '', number: '', city: '' }
        })
        .expect(201);

      expect(response.body.addressDetail).toBeUndefined();
    });
  });

  describe('GET /api/v1/customers', () => {
    it('lists active customers only by default', async () => {
      await createTestCustomer({ name: 'Active One' });
      await createTestCustomer({ name: 'Active Two' });
      await createTestCustomer({ name: 'Inactive One', status: 'inactive' });

      const response = await request
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body.every((c: { status: string }) => c.status === 'active')).toBe(true);
    });

    it('searches accent-insensitively (Calderon finds Calderón and vice versa)', async () => {
      await request
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Jorgelina Hernández Calderón',
          type: 'B2C',
          phone: '+5492611111111',
          address: 'Tunuyán, Mendoza'
        })
        .expect(201);

      // Unaccented + different case must match the accented stored name.
      const unaccented = await request
        .get('/api/v1/customers')
        .query({ search: 'jorgelina hernandez calderon', limit: '10' })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(unaccented.body.items).toHaveLength(1);
      expect(unaccented.body.items[0].name).toBe('Jorgelina Hernández Calderón');

      // Accented query must still match.
      const accented = await request
        .get('/api/v1/customers')
        .query({ search: 'JORGELINA HERNÁNDEZ CALDERÓN', limit: '10' })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(accented.body.items).toHaveLength(1);
    });

    it('includes inactive customers when ?includeInactive=true', async () => {
      await createTestCustomer({ name: 'Active One' });
      await createTestCustomer({ name: 'Inactive One', status: 'inactive' });

      const response = await request
        .get('/api/v1/customers?includeInactive=true')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveLength(2);
    });

    it('driver can read customers', async () => {
      await createTestCustomer({ name: 'Test' });

      await request
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(200);
    });
  });

  describe('GET /api/v1/customers/:id', () => {
    it('returns a customer by ID', async () => {
      const customer = await createTestCustomer({ name: 'Find Me' });

      const response = await request
        .get(`/api/v1/customers/${customer._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.name).toBe('Find Me');
    });

    it('returns 404 for non-existent ID', async () => {
      const fakeId = '507f1f77bcf86cd799439011';

      await request
        .get(`/api/v1/customers/${fakeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('PUT /api/v1/customers/:id', () => {
    it('updates customer fields', async () => {
      const customer = await createTestCustomer({ name: 'Old Name' });

      const response = await request
        .put(`/api/v1/customers/${customer._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'New Name', phone: '+56999999999' })
        .expect(200);

      expect(response.body.name).toBe('New Name');
      expect(response.body.phone).toBe('+56999999999');
    });

    it('updates customer location', async () => {
      const customer = await createTestCustomer({ name: 'Location Update' });

      const response = await request
        .put(`/api/v1/customers/${customer._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ location: { type: 'Point', coordinates: [-64.1888, -31.4201] } })
        .expect(200);

      expect(response.body.location).toEqual({ type: 'Point', coordinates: [-64.1888, -31.4201] });
    });

    it('updates customer addressDetail', async () => {
      const customer = await createTestCustomer({ name: 'Detail Update' });

      const response = await request
        .put(`/api/v1/customers/${customer._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          addressDetail: {
            street: 'San Martín',
            number: '890',
            city: 'Rosario',
            province: 'Santa Fe'
          }
        })
        .expect(200);

      expect(response.body.addressDetail).toEqual({
        street: 'San Martín',
        number: '890',
        city: 'Rosario',
        province: 'Santa Fe'
      });
    });

    it('returns 403 for driver', async () => {
      const customer = await createTestCustomer();

      await request
        .put(`/api/v1/customers/${customer._id}`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ name: 'Hacked' })
        .expect(403);
    });
  });

  describe('PATCH /api/v1/customers/:id/status', () => {
    it('deactivates an active customer', async () => {
      const customer = await createTestCustomer({ name: 'Deactivate Me' });

      const response = await request
        .patch(`/api/v1/customers/${customer._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'inactive' })
        .expect(200);

      expect(response.body.status).toBe('inactive');
    });

    it('activates an inactive customer', async () => {
      const customer = await createTestCustomer({ name: 'Activate Me', status: 'inactive' });

      const response = await request
        .patch(`/api/v1/customers/${customer._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'active' })
        .expect(200);

      expect(response.body.status).toBe('active');
    });

    it('rejects deactivating already inactive customer', async () => {
      const customer = await createTestCustomer({ status: 'inactive' });

      await request
        .patch(`/api/v1/customers/${customer._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'inactive' })
        .expect(409);
    });
  });

  describe('GET /api/v1/customers/:id/summary', () => {
    it('includes the net manual charge term in the pending balance', async () => {
      const customer = await createTestCustomer({ name: 'Resumen Manual' });
      const customerId = String(customer._id);

      await CustomerCharge.create([
        {
          customerId: new Types.ObjectId(customerId),
          type: 'charge',
          amount: 5000,
          reason: 'manual_debt',
          source: 'manual',
          createdBy: new Types.ObjectId()
        },
        {
          customerId: new Types.ObjectId(customerId),
          type: 'credit',
          amount: 2000,
          reason: 'forgiveness',
          source: 'manual',
          createdBy: new Types.ObjectId()
        }
      ]);

      const response = await request
        .get(`/api/v1/customers/${customerId}/summary`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.outstandingBalance).toBe(3000); // 5000 − 2000
    });

    it('includes openingDebt and manual charges without double counting', async () => {
      const customer = await createTestCustomer({ name: 'Resumen Inicial', openingDebt: 400 });
      const customerId = String(customer._id);

      await Order.create({
        orderNumber: `ORD-SUM-OPEN-${Date.now()}`,
        customerId: new Types.ObjectId(customerId),
        customerName: 'Resumen Inicial',
        channel: 'phone',
        items: [{ productId: new Types.ObjectId(), productName: 'Blanco', quantity: 1, unitPrice: 600, subtotal: 600 }],
        totalAmount: 600,
        paidAmount: 0,
        balance: 600,
        paymentStatus: 'unpaid'
      });

      await CustomerCharge.create([
        { customerId: new Types.ObjectId(customerId), type: 'charge', amount: 250, reason: 'manual_debt', source: 'manual', createdBy: new Types.ObjectId() },
        { customerId: new Types.ObjectId(customerId), type: 'credit', amount: 50, reason: 'forgiveness', source: 'manual', createdBy: new Types.ObjectId() }
      ]);

      const response = await request
        .get(`/api/v1/customers/${customerId}/summary`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // 400 openingDebt + 600 order + 250 charge − 50 credit = 1200
      expect(response.body.outstandingBalance).toBe(1200);
    });
  });
});
