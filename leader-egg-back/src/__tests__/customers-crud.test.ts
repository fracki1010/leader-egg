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
import { Order, type OrderStatus } from '../modules/orders/model.js';
import { Customer } from '../modules/customers/model.js';

const request = supertest(app);

let orderCounter = 0;

/**
 * Creates an order directly in the DB (deterministic, no product seeding needed).
 */
const createDirectOrder = async (
  customer: Record<string, unknown>,
  overrides: {
    status?: OrderStatus;
    totalAmount?: number;
    balance?: number;
    paymentStatus?: 'unpaid' | 'partial' | 'paid';
    createdAt?: Date;
  } = {}
): Promise<Record<string, unknown>> => {
  orderCounter += 1;
  const total = overrides.totalAmount ?? 25;
  const order = await Order.create({
    orderNumber: `ORD-TEST-${Date.now()}-${orderCounter}`,
    customerId: customer._id as Types.ObjectId,
    customerName: customer.name as string,
    channel: 'phone',
    deliveryAddress: '123 Test St',
    items: [{ productId: new Types.ObjectId(), productName: 'Blanco', quantity: 1, unitPrice: 25, subtotal: 25 }],
    totalAmount: total,
    status: overrides.status ?? 'pending',
    paymentStatus: overrides.paymentStatus ?? 'unpaid',
    paidAmount: 0,
    balance: overrides.balance ?? total,
    dueDate: null,
    createdAt: overrides.createdAt ?? new Date()
  });
  return order.toObject() as unknown as Record<string, unknown>;
};

describe('Customers CRUD Integration', () => {
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

  describe('DELETE /api/v1/customers/:id', () => {
    it('deletes a customer with no orders and returns 204', async () => {
      const customer = await createTestCustomer({ name: 'Delete Me' });
      const id = String(customer._id);

      await request
        .delete(`/api/v1/customers/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      await request
        .get(`/api/v1/customers/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('returns 404 for a non-existent customer', async () => {
      await request
        .delete('/api/v1/customers/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('returns 409 when the customer has order history', async () => {
      const customer = await createTestCustomer({ name: 'Has Orders' });
      await createDirectOrder(customer);

      await request
        .delete(`/api/v1/customers/${String(customer._id)}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });

    it('returns 401 without a token', async () => {
      const customer = await createTestCustomer();

      await request
        .delete(`/api/v1/customers/${String(customer._id)}`)
        .expect(401);
    });

    it('returns 403 for driver role', async () => {
      const customer = await createTestCustomer();

      await request
        .delete(`/api/v1/customers/${String(customer._id)}`)
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(403);
    });
  });

  describe('GET /api/v1/customers — search, filters and pagination', () => {
    it('searches customers by name and phone (case-insensitive)', async () => {
      await createTestCustomer({ name: 'Juan Perez', phone: '+56911111111' });
      await createTestCustomer({ name: 'Maria Lopez', phone: '+56922222222' });
      await createTestCustomer({ name: 'Juan Carlos', phone: '+56933333333' });

      const byName = await request
        .get('/api/v1/customers?search=juan&page=1&limit=50')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(byName.body.total).toBe(2);
      expect(byName.body.items).toHaveLength(2);

      // '+' must be URL-encoded (%2B) — a raw '+' is decoded as a space by the query parser
      const byPhone = await request
        .get('/api/v1/customers?search=%2B56922222222&page=1&limit=50')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(byPhone.body.total).toBe(1);
      expect(byPhone.body.items[0].name).toBe('Maria Lopez');
    });

    it('filters customers by type', async () => {
      await createTestCustomer({ name: 'B2B One', type: 'B2B', phone: '+56910000001', address: 'A St' });
      await createTestCustomer({ name: 'B2B Two', type: 'B2B', phone: '+56910000002', address: 'B St' });
      await createTestCustomer({ name: 'B2C One', type: 'B2C', phone: '+56910000003', address: 'C St' });

      const response = await request
        .get('/api/v1/customers?type=B2B&page=1&limit=50')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.total).toBe(2);
      expect(response.body.items.every((c: { type: string }) => c.type === 'B2B')).toBe(true);
    });

    it('returns a paginated envelope sorted by createdAt desc', async () => {
      await Customer.create([
        { name: 'Alpha', type: 'B2C', phone: '+56920000001', address: 'A St', createdAt: new Date('2026-01-01T10:00:00.000Z') },
        { name: 'Beta', type: 'B2C', phone: '+56920000002', address: 'B St', createdAt: new Date('2026-01-02T10:00:00.000Z') },
        { name: 'Gamma', type: 'B2C', phone: '+56920000003', address: 'C St', createdAt: new Date('2026-01-03T10:00:00.000Z') },
        { name: 'Delta', type: 'B2C', phone: '+56920000004', address: 'D St', createdAt: new Date('2026-01-04T10:00:00.000Z') },
        { name: 'Epsilon', type: 'B2C', phone: '+56920000005', address: 'E St', createdAt: new Date('2026-01-05T10:00:00.000Z') }
      ]);

      const response = await request
        .get('/api/v1/customers?page=2&limit=2')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.items).toHaveLength(2);
      expect(response.body.total).toBe(5);
      expect(response.body.page).toBe(2);
      expect(response.body.limit).toBe(2);
      expect(response.body.items[0].name).toBe('Gamma');
      expect(response.body.items[1].name).toBe('Beta');
    });

    it('returns a plain array for legacy includeInactive without pagination', async () => {
      await createTestCustomer({ name: 'Active One' });
      await createTestCustomer({ name: 'Inactive One', status: 'inactive' });

      const response = await request
        .get('/api/v1/customers?includeInactive=true')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);

      const defaultResponse = await request
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(defaultResponse.body)).toBe(true);
      expect(defaultResponse.body).toHaveLength(1);
    });
  });

  describe('GET /api/v1/customers/:id/summary', () => {
    it('returns correct totals when the customer has orders', async () => {
      const customer = await createTestCustomer({ name: 'Summary Customer' });
      await createDirectOrder(customer, {
        status: 'delivered',
        totalAmount: 50,
        balance: 50,
        createdAt: new Date('2026-01-01T10:00:00.000Z')
      });
      await createDirectOrder(customer, {
        status: 'pending',
        totalAmount: 26,
        balance: 26,
        createdAt: new Date('2026-01-02T10:00:00.000Z')
      });

      const response = await request
        .get(`/api/v1/customers/${String(customer._id)}/summary`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.orderCount).toBe(2);
      expect(response.body.totalSpent).toBe(76);
      expect(response.body.outstandingBalance).toBe(76);
      expect(response.body.hasPendingOrders).toBe(true);
      expect(new Date(response.body.lastOrderDate).getTime()).toBe(new Date('2026-01-02T10:00:00.000Z').getTime());
      expect(response.body.customer._id).toBe(String(customer._id));
    });

    it('returns zeros when the customer has no orders', async () => {
      const customer = await createTestCustomer({ name: 'No Orders' });

      const response = await request
        .get(`/api/v1/customers/${String(customer._id)}/summary`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.orderCount).toBe(0);
      expect(response.body.totalSpent).toBe(0);
      expect(response.body.outstandingBalance).toBe(0);
      expect(response.body.lastOrderDate).toBeNull();
      expect(response.body.hasPendingOrders).toBe(false);
    });

    it('returns 404 for a non-existent customer', async () => {
      await request
        .get('/api/v1/customers/507f1f77bcf86cd799439011/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('driver can read the summary', async () => {
      const customer = await createTestCustomer();
      await createDirectOrder(customer);

      await request
        .get(`/api/v1/customers/${String(customer._id)}/summary`)
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(200);
    });
  });

  describe('GET /api/v1/customers/:id/orders', () => {
    it('returns paginated orders with a status filter', async () => {
      const customer = await createTestCustomer({ name: 'Orders Customer' });
      await createDirectOrder(customer, { status: 'delivered', createdAt: new Date('2026-01-01T10:00:00.000Z') });
      await createDirectOrder(customer, { status: 'delivered', createdAt: new Date('2026-01-02T10:00:00.000Z') });
      await createDirectOrder(customer, { status: 'pending', createdAt: new Date('2026-01-03T10:00:00.000Z') });

      const page1 = await request
        .get(`/api/v1/customers/${String(customer._id)}/orders?status=delivered&limit=1&page=1`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(page1.body.items).toHaveLength(1);
      expect(page1.body.total).toBe(2);
      expect(page1.body.page).toBe(1);
      expect(page1.body.limit).toBe(1);
      expect(page1.body.items[0].status).toBe('delivered');
      expect(new Date(page1.body.items[0].createdAt).getTime()).toBe(new Date('2026-01-02T10:00:00.000Z').getTime());

      const page2 = await request
        .get(`/api/v1/customers/${String(customer._id)}/orders?status=delivered&limit=1&page=2`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(page2.body.items).toHaveLength(1);
      expect(page2.body.items[0].status).toBe('delivered');

      const pending = await request
        .get(`/api/v1/customers/${String(customer._id)}/orders?status=pending`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(pending.body.total).toBe(1);
      expect(pending.body.page).toBe(1);
      expect(pending.body.limit).toBe(50);
    });

    it('returns 404 for a non-existent customer', async () => {
      await request
        .get('/api/v1/customers/507f1f77bcf86cd799439011/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('driver can read customer orders', async () => {
      const customer = await createTestCustomer();
      await createDirectOrder(customer);

      const response = await request
        .get(`/api/v1/customers/${String(customer._id)}/orders`)
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(200);

      expect(response.body.total).toBe(1);
    });
  });
});