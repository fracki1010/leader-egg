import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { Types } from 'mongoose';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  seedPuestoUser,
  seedProducts,
  loginAs,
  createTestCustomer,
  getProductIds
} from './helpers.js';
import { app } from '../app.js';
import { Order } from '../modules/orders/model.js';

const request = supertest(app);

/** Direct DB order — deterministic fixture, bypasses API price/credit logic. */
const dbOrderPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  orderNumber: `ORD-PU-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  customerId: new Types.ObjectId(),
  customerName: 'Cliente Puesto',
  channel: 'walk_in',
  paymentPreference: 'cash',
  salesChannel: 'puesto',
  items: [
    {
      productId: new Types.ObjectId(),
      productName: 'Blanco',
      quantity: 5,
      unit: 'maple',
      mapleQty: 5,
      unitPrice: 25,
      subtotal: 125
    }
  ],
  totalAmount: 125,
  status: 'pending',
  paymentStatus: 'unpaid',
  paidAmount: 0,
  balance: 125,
  dueDate: null,
  ...overrides
});

describe('Puesto (stall) role — orders', () => {
  let adminToken: string;
  let puestoToken: string;

  beforeAll(async () => { await startTestDatabase(); });
  afterAll(async () => { await stopTestDatabase(); });

  beforeEach(async () => {
    await clearDatabase();
    await seedProducts();
    const adminCreds = await seedAdminUser();
    const puestoCreds = await seedPuestoUser();
    adminToken = await loginAs(request, adminCreds.email, adminCreds.password);
    puestoToken = await loginAs(request, puestoCreds.email, puestoCreds.password);
  });

  describe('POST /api/v1/orders — stall enforcement', () => {
    it('forces salesChannel=puesto and channel=walk_in when omitted', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      const res = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${puestoToken}`)
        .send({
          customerId: customer._id,
          items: [{ productId: products['blanco-chico'], quantity: 2 }]
        })
        .expect(201);

      expect(res.body.salesChannel).toBe('puesto');
      expect(res.body.channel).toBe('walk_in');

      const stored = await Order.findById(res.body._id);
      expect(stored!.salesChannel).toBe('puesto');
      expect(stored!.channel).toBe('walk_in');
    });

    it('accepts explicit salesChannel=puesto + channel=walk_in', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      const res = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${puestoToken}`)
        .send({
          customerId: customer._id,
          salesChannel: 'puesto',
          channel: 'walk_in',
          items: [{ productId: products['blanco-chico'], quantity: 1 }]
        })
        .expect(201);

      expect(res.body.salesChannel).toBe('puesto');
      expect(res.body.channel).toBe('walk_in');
    });

    it('rejects a non-stall salesChannel with 400 and persists nothing', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      const res = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${puestoToken}`)
        .send({
          customerId: customer._id,
          salesChannel: 'reparto',
          channel: 'walk_in',
          items: [{ productId: products['blanco-chico'], quantity: 1 }]
        })
        .expect(400);

      expect(res.body.error).toMatch(/mostrador/i);
      expect(await Order.countDocuments()).toBe(0);
    });

    it('rejects a non-walk_in channel with 400 and persists nothing', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      const res = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${puestoToken}`)
        .send({
          customerId: customer._id,
          salesChannel: 'puesto',
          channel: 'whatsapp',
          items: [{ productId: products['blanco-chico'], quantity: 1 }]
        })
        .expect(400);

      expect(res.body.error).toMatch(/mostrador/i);
      expect(await Order.countDocuments()).toBe(0);
    });

    it('an admin can still create a reparto phone order (no regression)', async () => {
      const customer = await createTestCustomer();
      const products = await getProductIds();

      const res = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          salesChannel: 'reparto',
          items: [{ productId: products['blanco-chico'], quantity: 1 }]
        })
        .expect(201);

      expect(res.body.salesChannel).toBe('reparto');
      expect(res.body.channel).toBe('phone');
    });
  });

  describe('GET /api/v1/orders — read scoping', () => {
    it('puesto lists only stall orders', async () => {
      await Order.create(dbOrderPayload({ salesChannel: 'puesto', orderNumber: 'ORD-PU-A' }));
      await Order.create(dbOrderPayload({ salesChannel: 'reparto', orderNumber: 'ORD-PU-B' }));
      await Order.create(dbOrderPayload({ salesChannel: 'whatsapp', orderNumber: 'ORD-PU-C' }));

      const res = await request
        .get('/api/v1/orders')
        .set('Authorization', `Bearer ${puestoToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]!.salesChannel).toBe('puesto');
      expect(res.body.total).toBe(1);
    });

    it('admin sees every salesChannel', async () => {
      await Order.create(dbOrderPayload({ salesChannel: 'puesto', orderNumber: 'ORD-PU-D' }));
      await Order.create(dbOrderPayload({ salesChannel: 'reparto', orderNumber: 'ORD-PU-E' }));

      const res = await request
        .get('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.total).toBe(2);
    });

    it('puesto GET /orders/:id returns 404 for a non-stall order', async () => {
      const adminOrder = await Order.create(dbOrderPayload({ salesChannel: 'reparto', orderNumber: 'ORD-PU-F' }));
      const stallOrder = await Order.create(dbOrderPayload({ salesChannel: 'puesto', orderNumber: 'ORD-PU-G' }));

      const hidden = await request
        .get(`/api/v1/orders/${adminOrder._id.toString()}`)
        .set('Authorization', `Bearer ${puestoToken}`);
      expect(hidden.status).toBe(404);
      expect(hidden.body.error).toMatch(/not found/i);

      const visible = await request
        .get(`/api/v1/orders/${stallOrder._id.toString()}`)
        .set('Authorization', `Bearer ${puestoToken}`);
      expect(visible.status).toBe(200);
      expect(visible.body.salesChannel).toBe('puesto');
    });

    it('puesto GET /orders/today sums only stall orders', async () => {
      await Order.create(dbOrderPayload({ salesChannel: 'puesto', totalAmount: 300, orderNumber: 'ORD-PU-H' }));
      await Order.create(dbOrderPayload({ salesChannel: 'reparto', totalAmount: 999, orderNumber: 'ORD-PU-I' }));

      const res = await request
        .get('/api/v1/orders/today')
        .set('Authorization', `Bearer ${puestoToken}`)
        .expect(200);

      expect(res.body.orders).toHaveLength(1);
      expect(res.body.orders[0]!.salesChannel).toBe('puesto');
      expect(res.body.summary.total).toBe(300);
      expect(res.body.summary.count).toBe(1);
    });
  });

  describe('write restrictions — admin only', () => {
    it('puesto cannot PATCH, transition, or delete an order (403)', async () => {
      const order = await Order.create(dbOrderPayload({ salesChannel: 'puesto', orderNumber: 'ORD-PU-J' }));
      const id = order._id.toString();

      await request
        .patch(`/api/v1/orders/${id}`)
        .set('Authorization', `Bearer ${puestoToken}`)
        .send({ deliveryNotes: 'edit' })
        .expect(403);

      await request
        .patch(`/api/v1/orders/${id}/status`)
        .set('Authorization', `Bearer ${puestoToken}`)
        .send({ status: 'assigned' })
        .expect(403);

      await request
        .delete(`/api/v1/orders/${id}`)
        .set('Authorization', `Bearer ${puestoToken}`)
        .expect(403);

      expect(await Order.findById(id)).not.toBeNull();
    });
  });
});