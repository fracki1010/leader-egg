import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  seedProducts,
  loginAs,
  createTestCustomer,
  getProductIds
} from './helpers.js';
import { app } from '../app.js';
import { Inventory } from '../modules/inventory/model.js';
import { Order } from '../modules/orders/model.js';

const request = supertest(app);

/**
 * Two items priced at 25 + 30 → an exact subtotal of 30000:
 *   blanco-chico:  600 × $25 = $15.000
 *   castaño-grande: 500 × $30 = $15.000
 */
interface OrderPayloadOptions {
  items: Array<{ productId: string; quantity: number }>;
  bonification?: { type: 'amount' | 'percent'; value: number };
  surcharge?: { type: 'amount' | 'percent'; value: number };
  initialPayment?: { amount: number; method?: 'cash' | 'transfer' | 'check' };
}

describe('Order-level surcharge', () => {
  let adminToken: string;
  let products: Record<string, string>;

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
    adminToken = await loginAs(request, adminCreds.email, adminCreds.password);
    products = await getProductIds();
  });

  const baseItems = () => [
    { productId: products['blanco-chico']!, quantity: 600 },
    { productId: products['castaño-grande']!, quantity: 500 }
  ];

  const postOrder = (customerId: string, options: OrderPayloadOptions) =>
    request
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId, channel: 'phone', ...options });

  const orderBody = async (options: OrderPayloadOptions = { items: [] }): Promise<Record<string, any>> => {
    const customer = await createTestCustomer();
    const response = await postOrder(customer._id as string, {
      ...options,
      items: options.items.length > 0 ? options.items : baseItems()
    }).expect(201);
    return response.body as Record<string, any>;
  };

  it('adds a fixed amount: subtotal 30000, surcharge 5000, total 35000', async () => {
    const body = await orderBody({
      items: [],
      surcharge: { type: 'amount', value: 5000 }
    });

    expect(body.subtotal).toBe(30000);
    expect(body.surcharge).toEqual({ type: 'amount', value: 5000, amount: 5000 });
    expect(body.totalAmount).toBe(35000);
    expect(body.paidAmount).toBe(0);
    expect(body.balance).toBe(35000);
  });

  it('adds a percentage: 10% of 30000 → surcharge 3000, total 33000', async () => {
    const body = await orderBody({
      items: [],
      surcharge: { type: 'percent', value: 10 }
    });

    expect(body.subtotal).toBe(30000);
    expect(body.surcharge).toEqual({ type: 'percent', value: 10, amount: 3000 });
    expect(body.totalAmount).toBe(33000);
    expect(body.balance).toBe(33000);
  });

  it('rounds the percentage surcharge to 2 decimals', async () => {
    const body = await orderBody({
      items: [],
      surcharge: { type: 'percent', value: 7.5 }
    });

    expect(body.surcharge.amount).toBe(2250);
    expect(body.totalAmount).toBe(32250);
  });

  it('combines a bonification and a surcharge: 30000 − 2000 + 3000 = 31000', async () => {
    const body = await orderBody({
      items: [],
      bonification: { type: 'amount', value: 2000 },
      surcharge: { type: 'percent', value: 10 }
    });

    expect(body.subtotal).toBe(30000);
    expect(body.bonification).toEqual({ type: 'amount', value: 2000, amount: 2000 });
    expect(body.surcharge).toEqual({ type: 'percent', value: 10, amount: 3000 });
    expect(body.totalAmount).toBe(31000);
    expect(body.balance).toBe(31000);
  });

  it('rejects zero and negative amounts with 400', async () => {
    const customer = await createTestCustomer();
    await postOrder(customer._id as string, {
      items: baseItems(),
      surcharge: { type: 'amount', value: 0 }
    }).expect(400);
    await postOrder(customer._id as string, {
      items: baseItems(),
      surcharge: { type: 'amount', value: -100 }
    }).expect(400);
  });

  it('rejects a percentage above 100 with 400', async () => {
    const customer = await createTestCustomer();
    await postOrder(customer._id as string, {
      items: baseItems(),
      surcharge: { type: 'percent', value: 101 }
    }).expect(400);
  });

  it('keeps the previous behavior when no surcharge is sent', async () => {
    const body = await orderBody();

    expect(body.subtotal).toBe(30000);
    expect(body.surcharge).toBeNull();
    expect(body.totalAmount).toBe(30000);
    expect(body.balance).toBe(30000);
  });

  it('validates the initial payment against the FINAL total (with surcharge)', async () => {
    const customer = await createTestCustomer();

    await postOrder(customer._id as string, {
      items: baseItems(),
      surcharge: { type: 'amount', value: 5000 },
      initialPayment: { amount: 35001, method: 'cash' }
    }).expect(400);

    const ok = await postOrder(customer._id as string, {
      items: baseItems(),
      surcharge: { type: 'amount', value: 5000 },
      initialPayment: { amount: 35000, method: 'cash' }
    }).expect(201);

    expect(ok.body.totalAmount).toBe(35000);
    expect(ok.body.paidAmount).toBe(35000);
    expect(ok.body.balance).toBe(0);
    expect(ok.body.paymentStatus).toBe('paid');
  });

  it('returns/refunds on a surcharged order keep the totalAmount invariant', async () => {
    const customer = await createTestCustomer();
    const created = await postOrder(customer._id as string, {
      items: baseItems(),
      surcharge: { type: 'amount', value: 5000 }
    }).expect(201);
    const orderId = created.body._id as string;

    // Simulate a real delivery (stock already left in this scenario).
    for (const item of baseItems()) {
      await Inventory.updateOne({ productId: item.productId }, { $inc: { quantity: -item.quantity } });
    }
    await Order.updateOne({ _id: orderId }, { status: 'delivered', stockDeducted: true });

    await request
      .post(`/api/v1/orders/${orderId}/payments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 35000, method: 'cash' })
      .expect(201);

    // Return 2 maples of blanco-chico ($25 each). The order carries a 5000/30000
    // surcharge, so the EFFECTIVE value is 50 × (35000/30000) = 58.33 — not the
    // raw 50. (This assertion used to encode the old, wrong pre-surcharge math.)
    const returned = await request
      .post(`/api/v1/orders/${orderId}/returns`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        items: [{ productId: products['blanco-chico']!, quantity: 2 }],
        reason: 'difference',
        effect: 'refund_cash'
      })
      .expect(201);

    expect(returned.body.returnedValue).toBe(58.33);
    expect(returned.body.returnedAmount).toBe(58.33);
    expect(returned.body.refundAmount).toBe(58.33);

    const after = await request
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(after.body.totalAmount).toBe(35000);
    expect(after.body.subtotal).toBe(30000);
    expect(after.body.surcharge.amount).toBe(5000);
    expect(after.body.totalAmount - after.body.returnedAmount).toBe(
      after.body.paidAmount + after.body.balance
    );
  });

  it('drops both the bonification and the surcharge when the items are edited (documented behavior)', async () => {
    const body = await orderBody({
      items: [],
      bonification: { type: 'amount', value: 2000 },
      surcharge: { type: 'amount', value: 5000 }
    });

    const updated = await request
      .patch(`/api/v1/orders/${body._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ items: [{ productId: products['blanco-chico']!, quantity: 100 }] })
      .expect(200);

    expect(updated.body.subtotal).toBe(2500);
    expect(updated.body.bonification).toBeNull();
    expect(updated.body.surcharge).toBeNull();
    expect(updated.body.totalAmount).toBe(2500);
    expect(updated.body.balance).toBe(2500);
  });
});
