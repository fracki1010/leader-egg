import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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
import { Expense } from '../modules/expenses/model.js';
import { Vehicle } from '../modules/vehicles/model.js';

const request = supertest(app);

describe('Expenses Integration', () => {
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

  describe('POST /api/v1/expenses', () => {
    it('creates an expense with valid data', async () => {
      const response = await request
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 150,
          category: 'fuel',
          date: '2026-08-25',
          description: 'Diesel for route 3'
        })
        .expect(201);

      expect(response.body.amount).toBe(150);
      expect(response.body.category).toBe('fuel');
      expect(response.body.description).toBe('Diesel for route 3');
      expect(response.body._id).toBeDefined();
      expect(response.body.createdAt).toBeDefined();
    });

    it('creates an expense with optional reference', async () => {
      const response = await request
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 200,
          category: 'supplies',
          date: '2026-08-25',
          description: 'Cardboard boxes',
          reference: 'INV-001'
        })
        .expect(201);

      expect(response.body.reference).toBe('INV-001');
    });

    it('defaults account to cash when omitted (cuentas-dinero R2)', async () => {
      const response = await request
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 80,
          category: 'fuel',
          date: '2026-08-25',
          description: 'Nafta'
        })
        .expect(201);

      expect(response.body.account).toBe('cash');
    });

    it('persists an explicit account (mp)', async () => {
      const response = await request
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 120,
          category: 'supplies',
          date: '2026-08-25',
          description: 'Insumos desde MP',
          account: 'mp'
        })
        .expect(201);

      expect(response.body.account).toBe('mp');
    });

    it('rejects an invalid account value', async () => {
      await request
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 50,
          category: 'other',
          date: '2026-08-25',
          description: 'Cuenta inválida',
          account: 'bitcoin'
        })
        .expect(400);
    });

    it('rejects invalid category', async () => {
      const response = await request
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 100,
          category: 'travel',
          date: '2026-08-25',
          description: 'Travel expense'
        })
        .expect(400);

      expect(response.body.error).toBeDefined();
    });

    it('rejects negative amount', async () => {
      const response = await request
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: -50,
          category: 'fuel',
          date: '2026-08-25',
          description: 'Negative test'
        })
        .expect(400);

      expect(response.body.error).toBeDefined();
    });

    it('rejects zero amount', async () => {
      await request
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 0,
          category: 'fuel',
          date: '2026-08-25',
          description: 'Zero test'
        })
        .expect(400);
    });

    it('rejects description over 200 chars', async () => {
      await request
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 100,
          category: 'fuel',
          date: '2026-08-25',
          description: 'x'.repeat(201)
        })
        .expect(400);
    });

    it('returns 403 when driver tries to create', async () => {
      await request
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          amount: 100,
          category: 'fuel',
          date: '2026-08-25',
          description: 'Driver attempt'
        })
        .expect(403);
    });

    it('returns 401 without auth', async () => {
      await request
        .post('/api/v1/expenses')
        .send({
          amount: 100,
          category: 'fuel',
          date: '2026-08-25',
          description: 'No auth'
        })
        .expect(401);
    });

    it('stores vehicleId when provided (expense-vehicle-link R1)', async () => {
      const vehicle = await Vehicle.create({ name: 'Fiorino', plate: 'AB123CD' });

      const response = await request
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 150,
          category: 'repair',
          date: '2026-08-25',
          description: 'Cambio de correa',
          vehicleId: vehicle._id.toString()
        })
        .expect(201);

      expect(response.body.vehicleId).toBe(vehicle._id.toString());
      expect(response.body.category).toBe('repair');
    });

    it('accepts the insurance category', async () => {
      const response = await request
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 120,
          category: 'insurance',
          date: '2026-08-25',
          description: 'Seguro del mes'
        })
        .expect(201);

      expect(response.body.category).toBe('insurance');
    });

    it('accepts legacy categories unchanged', async () => {
      for (const category of ['fuel', 'salary', 'maintenance', 'supplies', 'other']) {
        const response = await request
          .post('/api/v1/expenses')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            amount: 10,
            category,
            date: '2026-08-25',
            description: category
          })
          .expect(201);

        expect(response.body.category).toBe(category);
      }
    });

    it('leaves vehicleId null when omitted', async () => {
      const response = await request
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 150,
          category: 'fuel',
          date: '2026-08-25',
          description: 'Combustible'
        })
        .expect(201);

      expect(response.body.vehicleId).toBeNull();
    });
  });

  describe('GET /api/v1/expenses', () => {
    it('lists expenses sorted by date desc', async () => {
      await Expense.create([
        { amount: 100, category: 'fuel', date: new Date('2026-08-01'), description: 'Aug 1', createdBy: 'admin' },
        { amount: 200, category: 'salary', date: new Date('2026-08-15'), description: 'Aug 15', createdBy: 'admin' },
        { amount: 50, category: 'supplies', date: new Date('2026-08-10'), description: 'Aug 10', createdBy: 'admin' }
      ]);

      const response = await request
        .get('/api/v1/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.expenses).toHaveLength(3);
      expect(response.body.expenses[0].description).toBe('Aug 15');
      expect(response.body.expenses[1].description).toBe('Aug 10');
      expect(response.body.expenses[2].description).toBe('Aug 1');
      expect(response.body.total).toBe(3);
    });

    it('filters by date range', async () => {
      await Expense.create([
        { amount: 100, category: 'fuel', date: new Date('2026-08-01'), description: 'Aug 1', createdBy: 'admin' },
        { amount: 200, category: 'fuel', date: new Date('2026-08-10'), description: 'Aug 10', createdBy: 'admin' },
        { amount: 50, category: 'fuel', date: new Date('2026-08-20'), description: 'Aug 20', createdBy: 'admin' }
      ]);

      const response = await request
        .get('/api/v1/expenses?startDate=2026-08-05&endDate=2026-08-15')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.expenses).toHaveLength(1);
      expect(response.body.expenses[0].description).toBe('Aug 10');
    });

    it('filters by category', async () => {
      await Expense.create([
        { amount: 100, category: 'fuel', date: new Date('2026-08-01'), description: 'Fuel', createdBy: 'admin' },
        { amount: 200, category: 'salary', date: new Date('2026-08-02'), description: 'Salary', createdBy: 'admin' },
        { amount: 50, category: 'fuel', date: new Date('2026-08-03'), description: 'Fuel 2', createdBy: 'admin' }
      ]);

      const response = await request
        .get('/api/v1/expenses?category=fuel')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.expenses).toHaveLength(2);
      expect(response.body.expenses.every((e: { category: string }) => e.category === 'fuel')).toBe(true);
    });

    it('supports pagination', async () => {
      const expenses = Array.from({ length: 25 }, (_, i) => ({
        amount: 10 + i,
        category: 'fuel' as const,
        date: new Date('2026-08-01'),
        description: `Expense ${i}`,
        createdBy: 'admin'
      }));
      await Expense.create(expenses);

      const response = await request
        .get('/api/v1/expenses?page=1&limit=10')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.expenses).toHaveLength(10);
      expect(response.body.total).toBe(25);
      expect(response.body.page).toBe(1);
      expect(response.body.limit).toBe(10);
    });

    it('returns 400 when startDate > endDate', async () => {
      await request
        .get('/api/v1/expenses?startDate=2026-08-20&endDate=2026-08-01')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('returns 403 for driver', async () => {
      await request
        .get('/api/v1/expenses')
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(403);
    });
  });

  describe('GET /api/v1/expenses/totals', () => {
    it('returns monthly totals with breakdown', async () => {
      await Expense.create([
        { amount: 100, category: 'fuel', date: new Date('2026-08-05'), description: 'Fuel 1', createdBy: 'admin' },
        { amount: 200, category: 'fuel', date: new Date('2026-08-15'), description: 'Fuel 2', createdBy: 'admin' },
        { amount: 150, category: 'salary', date: new Date('2026-08-10'), description: 'Salary', createdBy: 'admin' },
        { amount: 50, category: 'supplies', date: new Date('2026-08-20'), description: 'Supplies', createdBy: 'admin' }
      ]);

      const response = await request
        .get('/api/v1/expenses/totals?period=monthly&date=2026-08')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.total).toBe(500);
      expect(response.body.count).toBe(4);
      expect(response.body.breakdown.fuel).toBe(300);
      expect(response.body.breakdown.salary).toBe(150);
      expect(response.body.breakdown.supplies).toBe(50);
    });

    it('returns weekly totals with weekStart/weekEnd', async () => {
      // Create expenses on known dates (Mon Aug 24 2026 is a Monday)
      await Expense.create([
        // Local (ART) calendar days: new Date('YYYY-MM-DD') is UTC midnight,
        // i.e. 21:00 of the previous day in ART.
        { amount: 100, category: 'fuel', date: new Date(2026, 7, 24, 12), description: 'Mon', createdBy: 'admin' },
        { amount: 200, category: 'fuel', date: new Date(2026, 7, 26, 12), description: 'Wed', createdBy: 'admin' },
        { amount: 50, category: 'fuel', date: new Date(2026, 7, 30, 12), description: 'Sun', createdBy: 'admin' }
      ]);

      const response = await request
        .get('/api/v1/expenses/totals?period=weekly&date=2026-08-25')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.total).toBe(350);
      expect(response.body.count).toBe(3);
      expect(response.body.weekStart).toBeDefined();
      expect(response.body.weekEnd).toBeDefined();
    });

    it('returns zeros for empty period', async () => {
      const response = await request
        .get('/api/v1/expenses/totals?period=monthly&date=2025-01')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.total).toBe(0);
      expect(response.body.count).toBe(0);
      expect(response.body.breakdown).toEqual({});
    });

    it('returns 403 for driver', async () => {
      await request
        .get('/api/v1/expenses/totals?period=monthly')
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(403);
    });
  });

  describe('DELETE /api/v1/expenses/:id', () => {
    it('deletes an existing expense', async () => {
      const expense = await Expense.create({
        amount: 100,
        category: 'fuel',
        date: new Date('2026-08-25'),
        description: 'To delete',
        createdBy: 'admin'
      });

      await request
        .delete(`/api/v1/expenses/${expense._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      const found = await Expense.findById(expense._id);
      expect(found).toBeNull();
    });

    it('returns 404 for non-existent expense', async () => {
      const fakeId = '507f1f77bcf86cd799439011';

      await request
        .delete(`/api/v1/expenses/${fakeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('returns 403 for driver', async () => {
      const expense = await Expense.create({
        amount: 100,
        category: 'fuel',
        date: new Date('2026-08-25'),
        description: 'Test',
        createdBy: 'admin'
      });

      await request
        .delete(`/api/v1/expenses/${expense._id}`)
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(403);
    });
  });
});

describe('Product costPrice', () => {
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

  it('creates a product with costPrice', async () => {
    const response = await request
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        variety: 'blanco',
        caliber: 'chico',
        costPrice: 18.50
      })
      .expect(201);

    expect(response.body.costPrice).toBe(18.50);
  });

  it('creates a product without costPrice (defaults to null)', async () => {
    const response = await request
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ variety: 'blanco', caliber: 'chico' })
      .expect(201);

    expect(response.body.costPrice).toBeNull();
  });

  it('updates costPrice via PATCH', async () => {
    const createResponse = await request
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ variety: 'blanco', caliber: 'chico', costPrice: 18.50 })
      .expect(201);

    const response = await request
      .patch(`/api/v1/products/${createResponse.body._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ costPrice: 19.00 })
      .expect(200);

    expect(response.body.costPrice).toBe(19);
  });

  it('rejects negative costPrice', async () => {
    const createResponse = await request
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ variety: 'blanco', caliber: 'chico' })
      .expect(201);

    await request
      .patch(`/api/v1/products/${createResponse.body._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ costPrice: -5 })
      .expect(400);
  });

  it('sets costPrice to null', async () => {
    const createResponse = await request
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ variety: 'blanco', caliber: 'chico', costPrice: 18.50 })
      .expect(201);

    const response = await request
      .patch(`/api/v1/products/${createResponse.body._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ costPrice: null })
      .expect(200);

    expect(response.body.costPrice).toBeNull();
  });
});
