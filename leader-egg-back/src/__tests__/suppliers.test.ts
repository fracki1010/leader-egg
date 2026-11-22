import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { Types } from 'mongoose';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  loginAs
} from './helpers.js';
import { app } from '../app.js';
import { Supplier } from '../modules/suppliers/model.js';

const request = supertest(app);

describe('Suppliers API', () => {
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

  describe('POST /api/v1/suppliers', () => {
    it('creates a supplier as active and returns 201 (R1)', async () => {
      const res = await request
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Granja Don Pedro', contact: 'Pedro', phone: '+54 9 351 555-1234' })
        .expect(201);

      expect(res.body.name).toBe('Granja Don Pedro');
      expect(res.body.contact).toBe('Pedro');
      expect(res.body.phone).toBe('+54 9 351 555-1234');
      expect(res.body.active).toBe(true);
      expect(res.body._id).toBeDefined();
    });

    it('returns 400 when name is missing (R1)', async () => {
      await request
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ contact: 'Pedro' })
        .expect(400);
    });

    it('returns 401 without a token', async () => {
      await request
        .post('/api/v1/suppliers')
        .send({ name: 'Sin token' })
        .expect(401);
    });
  });

  describe('GET /api/v1/suppliers', () => {
    it('returns only active suppliers by default (R2)', async () => {
      await Supplier.create([
        { name: 'Granja Activa A', active: true },
        { name: 'Granja Inactiva', active: false },
        { name: 'Granja Activa B', active: true }
      ]);

      const res = await request
        .get('/api/v1/suppliers')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body.every((s: { active: boolean }) => s.active === true)).toBe(true);
    });

    it('returns inactive suppliers too when includeInactive=true', async () => {
      await Supplier.create([
        { name: 'Granja A', active: true },
        { name: 'Granja B', active: false }
      ]);

      const res = await request
        .get('/api/v1/suppliers?includeInactive=true')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveLength(2);
    });
  });

  describe('PUT /api/v1/suppliers/:id', () => {
    it('updates editable fields and returns 200 (R3)', async () => {
      const supplier = await Supplier.create({ name: 'Granja Vieja', contact: 'Viejo' });

      const res = await request
        .put(`/api/v1/suppliers/${supplier._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ contact: 'Nuevo contacto', phone: '351 000 0000' })
        .expect(200);

      expect(res.body.contact).toBe('Nuevo contacto');
      expect(res.body.phone).toBe('351 000 0000');
      expect(res.body.name).toBe('Granja Vieja');
    });

    it('returns 404 for an unknown supplier (R3)', async () => {
      await request
        .put('/api/v1/suppliers/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ contact: 'X' })
        .expect(404);
    });
  });

  describe('PATCH /api/v1/suppliers/:id/status', () => {
    it('deactivates an active supplier and excludes it from the default list (R3)', async () => {
      const supplier = await Supplier.create({ name: 'Granja Activa' });

      const res = await request
        .patch(`/api/v1/suppliers/${supplier._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'inactive' })
        .expect(200);

      expect(res.body.active).toBe(false);

      const list = await request
        .get('/api/v1/suppliers')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(list.body).toHaveLength(0);
    });

    it('reactivates a deactivated supplier', async () => {
      const supplier = await Supplier.create({ name: 'Granja Dormida', active: false });

      const res = await request
        .patch(`/api/v1/suppliers/${supplier._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'active' })
        .expect(200);

      expect(res.body.active).toBe(true);
    });

    it('returns 404 for an unknown supplier (R3)', async () => {
      await request
        .patch('/api/v1/suppliers/507f1f77bcf86cd799439011/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'inactive' })
        .expect(404);
    });
  });

  describe('DELETE /api/v1/suppliers/:id', () => {
    it('deletes a supplier with no purchase history (204)', async () => {
      const supplier = await Supplier.create({ name: 'Granja Efimera' });

      await request
        .delete(`/api/v1/suppliers/${supplier._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);
    });

    it('returns 409 when the supplier has purchase history', async () => {
      const supplier = await Supplier.create({ name: 'Granja Con Historial' });
      const { Purchase } = await import('../modules/purchases/model.js');
      await Purchase.create({
        purchaseNumber: `PUR-TEST-${Date.now()}`,
        supplierId: supplier._id,
        date: new Date(),
        items: [{ productId: new Types.ObjectId(), productName: 'X', unit: 'maple', quantity: 1, quantityMaples: 1, unitCost: 10, unitCostPerMaple: 10, subtotal: 10 }],
        totalCost: 10,
        createdBy: 'test'
      });

      await request
        .delete(`/api/v1/suppliers/${supplier._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });
  });
});