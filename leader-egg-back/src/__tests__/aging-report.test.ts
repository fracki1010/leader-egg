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
  createCreditCustomer,
  getProductIds
} from './helpers.js';
import { app } from './helpers.js';
import { Order } from '../modules/orders/model.js';

const request = supertest(app);

describe('Aging Report — Integration', () => {
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
    await seedProducts();
    const adminCreds = await seedAdminUser();
    const driverCreds = await seedDriverUser();
    adminToken = await loginAs(request, adminCreds.email, adminCreds.password);
    driverToken = await loginAs(request, driverCreds.email, driverCreds.password);
  });

  const daysAgo = (days: number): Date => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d;
  };

  const seedAgingOrders = async (customerId: string) => {
    const products = await getProductIds();
    const productId = products['blanco-chico'];

    await Order.create([
      {
        orderNumber: 'ORD-AGE-5',
        customerId,
        customerName: 'Test',
        channel: 'phone',
        items: [{ productId, productName: 'X', quantity: 1, unitPrice: 500, subtotal: 500 }],
        totalAmount: 500,
        paidAmount: 0,
        balance: 500,
        paymentStatus: 'unpaid',
        dueDate: daysAgo(5)
      },
      {
        orderNumber: 'ORD-AGE-45',
        customerId,
        customerName: 'Test',
        channel: 'phone',
        items: [{ productId, productName: 'X', quantity: 1, unitPrice: 300, subtotal: 300 }],
        totalAmount: 300,
        paidAmount: 0,
        balance: 300,
        paymentStatus: 'unpaid',
        dueDate: daysAgo(45)
      },
      {
        orderNumber: 'ORD-AGE-100',
        customerId,
        customerName: 'Test',
        channel: 'phone',
        items: [{ productId, productName: 'X', quantity: 1, unitPrice: 200, subtotal: 200 }],
        totalAmount: 200,
        paidAmount: 0,
        balance: 200,
        paymentStatus: 'partial',
        dueDate: daysAgo(100)
      },
      {
        orderNumber: 'ORD-AGE-FUTURE',
        customerId,
        customerName: 'Test',
        channel: 'phone',
        items: [{ productId, productName: 'X', quantity: 1, unitPrice: 100, subtotal: 100 }],
        totalAmount: 100,
        paidAmount: 0,
        balance: 100,
        paymentStatus: 'unpaid',
        dueDate: daysAgo(-5) // 5 days in the future
      }
    ]);
  };

  describe('GET /api/v1/reports/aging', () => {
    it('returns 403 for non-admin (driver)', async () => {
      await request
        .get('/api/v1/reports/aging')
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(403);
    });

    it('returns 401 without auth', async () => {
      await request
        .get('/api/v1/reports/aging')
        .expect(401);
    });

    it('returns all buckets with zero counts when no overdue orders', async () => {
      const response = await request
        .get('/api/v1/reports/aging')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.buckets).toHaveLength(5);
      expect(response.body.totalOverdue).toBe(0);

      const labels = response.body.buckets.map((b: { label: string }) => b.label);
      expect(labels).toContain('current');
      expect(labels).toContain('1-30');
      expect(labels).toContain('31-60');
      expect(labels).toContain('61-90');
      expect(labels).toContain('90+');
    });

    it('buckets overdue orders correctly', async () => {
      const customer = await createCreditCustomer(50000, 30);
      await seedAgingOrders(customer._id as string);

      const response = await request
        .get('/api/v1/reports/aging')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const buckets = response.body.buckets;
      const getBucket = (label: string) => buckets.find((b: { label: string }) => b.label === label);

      // 5 days overdue → 1-30 bucket
      expect(getBucket('1-30').count).toBe(1);
      expect(getBucket('1-30').totalAmount).toBe(500);

      // 45 days overdue → 31-60 bucket
      expect(getBucket('31-60').count).toBe(1);
      expect(getBucket('31-60').totalAmount).toBe(300);

      // 100 days overdue → 90+ bucket
      expect(getBucket('90+').count).toBe(1);
      expect(getBucket('90+').totalAmount).toBe(200);

      // Future order → current bucket
      expect(getBucket('current').count).toBe(1);
      expect(getBucket('current').totalAmount).toBe(100);

      // totalOverdue excludes "current"
      expect(response.body.totalOverdue).toBe(1000); // 500 + 300 + 200
    });
  });

  describe('GET /api/v1/reports/aging?customerId=:id', () => {
    it('returns customer-specific aging with oldestDueDate', async () => {
      const customer = await createCreditCustomer(50000, 30);
      await seedAgingOrders(customer._id as string);

      const response = await request
        .get(`/api/v1/reports/aging?customerId=${customer._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.customerId).toBe(String(customer._id));
      expect(response.body.totalOverdue).toBe(1000);
      expect(response.body.oldestDueDate).not.toBeNull();

      // oldestDueDate should be ~100 days ago
      const oldest = new Date(response.body.oldestDueDate);
      const diffDays = Math.round((Date.now() - oldest.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBe(100);
    });

    it('returns empty report for customer with no overdue orders', async () => {
      const customer = await createCreditCustomer(5000, 15);

      const response = await request
        .get(`/api/v1/reports/aging?customerId=${customer._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.totalOverdue).toBe(0);
      expect(response.body.oldestDueDate).toBeNull();
    });
  });
});
