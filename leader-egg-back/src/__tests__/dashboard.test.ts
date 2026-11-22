import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { Types } from 'mongoose';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  seedDriverUser,
  seedProducts,
  loginAs,
  createTestCustomer,
  getProductIds
} from './helpers.js';
import { app } from '../app.js';
import { Order } from '../modules/orders/model.js';
import { Inventory } from '../modules/inventory/model.js';

const request = supertest(app);

describe('Dashboard Alerts — GET /api/v1/dashboard/alerts', () => {
  let adminToken: string;
  let driverToken: string;
  let productIds: Record<string, string>;

  beforeAll(async () => { await startTestDatabase(); });
  afterAll(async () => { await stopTestDatabase(); });

  beforeEach(async () => {
    await clearDatabase();
    await seedProducts();
    productIds = await getProductIds();
    const admin = await seedAdminUser();
    const driver = await seedDriverUser();
    adminToken = await loginAs(request, admin.email, admin.password);
    driverToken = await loginAs(request, driver.email, driver.password);
  });

  describe('Auth guard', () => {
    it('returns 401 without token', async () => {
      const res = await request.get('/api/v1/dashboard/alerts');
      expect(res.status).toBe(401);
    });

    it('returns 403 for driver role', async () => {
      const res = await request
        .get('/api/v1/dashboard/alerts')
        .set('Authorization', `Bearer ${driverToken}`);
      expect(res.status).toBe(403);
    });

    it('returns 200 for admin role', async () => {
      const res = await request
        .get('/api/v1/dashboard/alerts')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('Empty state', () => {
    it('returns empty array when no alerts', async () => {
      // Set all inventory above threshold (default: 20)
      for (const id of Object.values(productIds)) {
        await Inventory.findOneAndUpdate(
          { productId: id },
          { productId: new Types.ObjectId(id), quantity: 100, lastUpdated: new Date() },
          { upsert: true }
        );
      }

      const res = await request
        .get('/api/v1/dashboard/alerts')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const alerts = res.body as Array<Record<string, unknown>>;
      // No overdue, no low stock, no pending orders
      expect(alerts.find(a => a.type === 'overdue_debts')).toBeUndefined();
      expect(alerts.find(a => a.type === 'low_stock')).toBeUndefined();
      expect(alerts.find(a => a.type === 'pending_orders')).toBeUndefined();
    });
  });

  describe('Overdue debts alert', () => {
    it('returns overdue_debts alert when orders are past due', async () => {
      const customer = await createTestCustomer({ name: 'Debtor' });

      // Create 2 overdue orders (past dueDate, not paid)
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 10);

      await Order.create([
        {
          orderNumber: `ORD-OD-1-${Date.now()}`,
          customerId: new Types.ObjectId(customer._id as string),
          customerName: 'Debtor',
          channel: 'phone',
          items: [{ productId: new Types.ObjectId(), productName: 'Blanco', quantity: 5, unitPrice: 25, subtotal: 125 }],
          totalAmount: 125,
          status: 'delivered',
          paymentStatus: 'unpaid',
          paidAmount: 0,
          balance: 125,
          dueDate: pastDate
        },
        {
          orderNumber: `ORD-OD-2-${Date.now()}`,
          customerId: new Types.ObjectId(customer._id as string),
          customerName: 'Debtor',
          channel: 'phone',
          items: [{ productId: new Types.ObjectId(), productName: 'Blanco', quantity: 10, unitPrice: 25, subtotal: 250 }],
          totalAmount: 250,
          status: 'delivered',
          paymentStatus: 'partial',
          paidAmount: 50,
          balance: 200,
          dueDate: pastDate
        }
      ]);

      const res = await request
        .get('/api/v1/dashboard/alerts')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const alerts = res.body as Array<Record<string, unknown>>;
      const overdue = alerts.find(a => a.type === 'overdue_debts');
      expect(overdue).toBeDefined();
      expect(overdue!.severity).toBe('critical');
      expect(overdue!.count).toBe(2);
      expect(overdue!.totalAmount).toBe(325);
    });

    it('does NOT include overdue_debts when all orders are paid', async () => {
      const customer = await createTestCustomer({ name: 'Paid Up' });
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 5);

      await Order.create({
        orderNumber: `ORD-PAID-${Date.now()}`,
        customerId: new Types.ObjectId(customer._id as string),
        customerName: 'Paid Up',
        channel: 'phone',
        items: [{ productId: new Types.ObjectId(), productName: 'Blanco', quantity: 5, unitPrice: 25, subtotal: 125 }],
        totalAmount: 125,
        status: 'delivered',
        paymentStatus: 'paid',
        paidAmount: 125,
        balance: 0,
        dueDate: pastDate
      });

      const res = await request
        .get('/api/v1/dashboard/alerts')
        .set('Authorization', `Bearer ${adminToken}`);

      const alerts = res.body as Array<Record<string, unknown>>;
      expect(alerts.find(a => a.type === 'overdue_debts')).toBeUndefined();
    });

    it('does NOT include cancelled orders in overdue', async () => {
      const customer = await createTestCustomer({ name: 'Cancelled' });
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 5);

      await Order.create({
        orderNumber: `ORD-CANC-${Date.now()}`,
        customerId: new Types.ObjectId(customer._id as string),
        customerName: 'Cancelled',
        channel: 'phone',
        items: [{ productId: new Types.ObjectId(), productName: 'Blanco', quantity: 5, unitPrice: 25, subtotal: 125 }],
        totalAmount: 125,
        status: 'cancelled',
        paymentStatus: 'unpaid',
        paidAmount: 0,
        balance: 125,
        dueDate: pastDate
      });

      const res = await request
        .get('/api/v1/dashboard/alerts')
        .set('Authorization', `Bearer ${adminToken}`);

      const alerts = res.body as Array<Record<string, unknown>>;
      expect(alerts.find(a => a.type === 'overdue_debts')).toBeUndefined();
    });
  });

  describe('Low stock alert', () => {
    it('returns low_stock alert with products below threshold', async () => {
      // Set Castaño below threshold (20), Blanco above
      await Inventory.findOneAndUpdate(
        { productId: productIds['castaño-chico'] },
        { productId: new Types.ObjectId(productIds['castaño-chico']), quantity: 5, lastUpdated: new Date() },
        { upsert: true }
      );
      await Inventory.findOneAndUpdate(
        { productId: productIds['blanco-chico'] },
        { productId: new Types.ObjectId(productIds['blanco-chico']), quantity: 100, lastUpdated: new Date() },
        { upsert: true }
      );

      const res = await request
        .get('/api/v1/dashboard/alerts')
        .set('Authorization', `Bearer ${adminToken}`);

      const alerts = res.body as Array<Record<string, unknown>>;
      const lowStock = alerts.find(a => a.type === 'low_stock');
      expect(lowStock).toBeDefined();
      expect(lowStock!.severity).toBe('warning');
      expect(lowStock!.count).toBe(1); // Only Castaño (5) < 20
      const products = lowStock!.products as Array<Record<string, unknown>>;
      expect(products).toHaveLength(1);
      expect(products[0]!.currentStock).toBe(5);
    });
  });

  describe('Pending orders alert', () => {
    it('returns pending_orders alert when pending orders exist', async () => {
      const customer = await createTestCustomer({ name: 'Pending Buyer' });

      await Order.create([
        {
          orderNumber: `ORD-PEND-1-${Date.now()}`,
          customerId: new Types.ObjectId(customer._id as string),
          customerName: 'Pending Buyer',
          channel: 'phone',
          items: [{ productId: new Types.ObjectId(), productName: 'Blanco', quantity: 5, unitPrice: 25, subtotal: 125 }],
          totalAmount: 125,
          status: 'pending',
          paymentStatus: 'unpaid',
          paidAmount: 0,
          balance: 125,
          dueDate: null
        },
        {
          orderNumber: `ORD-PEND-2-${Date.now()}`,
          customerId: new Types.ObjectId(customer._id as string),
          customerName: 'Pending Buyer',
          channel: 'whatsapp',
          items: [{ productId: new Types.ObjectId(), productName: 'Castaño', quantity: 3, unitPrice: 26, subtotal: 78 }],
          totalAmount: 78,
          status: 'pending',
          paymentStatus: 'unpaid',
          paidAmount: 0,
          balance: 78,
          dueDate: null
        }
      ]);

      const res = await request
        .get('/api/v1/dashboard/alerts')
        .set('Authorization', `Bearer ${adminToken}`);

      const alerts = res.body as Array<Record<string, unknown>>;
      const pending = alerts.find(a => a.type === 'pending_orders');
      expect(pending).toBeDefined();
      expect(pending!.severity).toBe('info');
      expect(pending!.count).toBe(2);
    });

    it('does NOT include pending_orders when no pending orders', async () => {
      const res = await request
        .get('/api/v1/dashboard/alerts')
        .set('Authorization', `Bearer ${adminToken}`);

      const alerts = res.body as Array<Record<string, unknown>>;
      expect(alerts.find(a => a.type === 'pending_orders')).toBeUndefined();
    });
  });

  describe('Combined alerts', () => {
    it('returns multiple alerts simultaneously', async () => {
      const customer = await createTestCustomer({ name: 'Multi Alert' });
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 5);

      // Set one product below threshold for low_stock alert
      await Inventory.findOneAndUpdate(
        { productId: productIds['castaño-chico'] },
        { productId: new Types.ObjectId(productIds['castaño-chico']), quantity: 3, lastUpdated: new Date() },
        { upsert: true }
      );

      // Overdue order
      await Order.create({
        orderNumber: `ORD-COMB-1-${Date.now()}`,
        customerId: new Types.ObjectId(customer._id as string),
        customerName: 'Multi Alert',
        channel: 'phone',
        items: [{ productId: new Types.ObjectId(), productName: 'Blanco', quantity: 5, unitPrice: 25, subtotal: 125 }],
        totalAmount: 125,
        status: 'delivered',
        paymentStatus: 'unpaid',
        paidAmount: 0,
        balance: 125,
        dueDate: pastDate
      });

      // Pending order
      await Order.create({
        orderNumber: `ORD-COMB-2-${Date.now()}`,
        customerId: new Types.ObjectId(customer._id as string),
        customerName: 'Multi Alert',
        channel: 'phone',
        items: [{ productId: new Types.ObjectId(), productName: 'Blanco', quantity: 2, unitPrice: 25, subtotal: 50 }],
        totalAmount: 50,
        status: 'pending',
        paymentStatus: 'unpaid',
        paidAmount: 0,
        balance: 50,
        dueDate: null
      });

      const res = await request
        .get('/api/v1/dashboard/alerts')
        .set('Authorization', `Bearer ${adminToken}`);

      const alerts = res.body as Array<Record<string, unknown>>;
      // Should have all 3 alert types
      expect(alerts.find(a => a.type === 'overdue_debts')).toBeDefined();
      expect(alerts.find(a => a.type === 'low_stock')).toBeDefined();
      expect(alerts.find(a => a.type === 'pending_orders')).toBeDefined();
      expect(alerts.length).toBe(3);
    });
  });
});
