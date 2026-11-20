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
  initialPayment?: { amount: number; method?: 'cash' | 'transfer' | 'check' };
}

describe('Order-level bonification', () => {
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

  it('applies a fixed amount: subtotal 30000, discount 5000, total 25000', async () => {
    const body = await orderBody({
      items: [],
      bonification: { type: 'amount', value: 5000 }
    });

    expect(body.subtotal).toBe(30000);
    expect(body.bonification).toEqual({ type: 'amount', value: 5000, amount: 5000 });
    expect(body.totalAmount).toBe(25000);
    expect(body.paidAmount).toBe(0);
    expect(body.balance).toBe(25000);
  });

  it('applies a percentage: 10% of 30000 → discount 3000, total 27000', async () => {
    const body = await orderBody({
      items: [],
      bonification: { type: 'percent', value: 10 }
    });

    expect(body.subtotal).toBe(30000);
    expect(body.bonification).toEqual({ type: 'percent', value: 10, amount: 3000 });
    expect(body.totalAmount).toBe(27000);
    expect(body.balance).toBe(27000);
  });

  it('rounds the percentage discount to 2 decimals', async () => {
    const body = await orderBody({
      items: [],
      bonification: { type: 'percent', value: 7.5 }
    });

    expect(body.bonification.amount).toBe(2250);
    expect(body.totalAmount).toBe(27750);
  });

  it('rejects an amount larger than the subtotal with 400', async () => {
    const customer = await createTestCustomer();
    await postOrder(customer._id as string, {
      items: baseItems(),
      bonification: { type: 'amount', value: 30001 }
    }).expect(400);
  });

  it('rejects a percentage above 100 with 400', async () => {
    const customer = await createTestCustomer();
    await postOrder(customer._id as string, {
      items: baseItems(),
      bonification: { type: 'percent', value: 101 }
    }).expect(400);
  });

  it('rejects zero and negative values with 400', async () => {
    const customer = await createTestCustomer();
    await postOrder(customer._id as string, {
      items: baseItems(),
      bonification: { type: 'percent', value: 0 }
    }).expect(400);
    await postOrder(customer._id as string, {
      items: baseItems(),
      bonification: { type: 'percent', value: -5 }
    }).expect(400);
    await postOrder(customer._id as string, {
      items: baseItems(),
      bonification: { type: 'amount', value: -100 }
    }).expect(400);
  });

  it('rejects an unknown bonification type with 400', async () => {
    const customer = await createTestCustomer();
    await postOrder(customer._id as string, {
      items: baseItems(),
      bonification: { type: 'free', value: 10 } as unknown as { type: 'amount'; value: number }
    }).expect(400);
  });

  it('keeps the previous behavior when no bonification is sent', async () => {
    const body = await orderBody();

    expect(body.subtotal).toBe(30000);
    expect(body.bonification).toBeNull();
    expect(body.totalAmount).toBe(30000);
    expect(body.balance).toBe(30000);
  });

  it('validates the initial payment against the DISCOUNTED total', async () => {
    const customer = await createTestCustomer();

    await postOrder(customer._id as string, {
      items: baseItems(),
      bonification: { type: 'amount', value: 5000 },
      initialPayment: { amount: 26000, method: 'cash' }
    }).expect(400);

    const ok = await postOrder(customer._id as string, {
      items: baseItems(),
      bonification: { type: 'amount', value: 5000 },
      initialPayment: { amount: 25000, method: 'cash' }
    }).expect(201);

    expect(ok.body.totalAmount).toBe(25000);
    expect(ok.body.paidAmount).toBe(25000);
    expect(ok.body.balance).toBe(0);
    expect(ok.body.paymentStatus).toBe('paid');
  });

  it('returns/refunds on a discounted order keep the totalAmount invariant', async () => {
    const customer = await createTestCustomer();
    const created = await postOrder(customer._id as string, {
      items: baseItems(),
      bonification: { type: 'amount', value: 5000 }
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
      .send({ amount: 25000, method: 'cash' })
      .expect(201);

    // Return 2 maples of blanco-chico ($25 each). The order is discounted by
    // 5000/30000, so the EFFECTIVE value is 50 × (25000/30000) = 41.67 — not
    // the raw pre-bonification 50. (This assertion used to encode the old,
    // wrong pre-discount math.)
    const returned = await request
      .post(`/api/v1/orders/${orderId}/returns`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        items: [{ productId: products['blanco-chico']!, quantity: 2 }],
        reason: 'difference',
        effect: 'refund_cash'
      })
      .expect(201);

    expect(returned.body.returnedValue).toBe(41.67);
    expect(returned.body.returnedAmount).toBe(41.67);
    expect(returned.body.refundAmount).toBe(41.67);

    const after = await request
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(after.body.totalAmount).toBe(25000);
    expect(after.body.subtotal).toBe(30000);
    expect(after.body.bonification.amount).toBe(5000);
    expect(after.body.totalAmount - after.body.returnedAmount).toBe(
      after.body.paidAmount + after.body.balance
    );
  });

  it('drops the bonification when the items are edited (documented behavior)', async () => {
    const body = await orderBody({
      items: [],
      bonification: { type: 'amount', value: 5000 }
    });

    const updated = await request
      .patch(`/api/v1/orders/${body._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ items: [{ productId: products['blanco-chico']!, quantity: 100 }] })
      .expect(200);

    expect(updated.body.subtotal).toBe(2500);
    expect(updated.body.bonification).toBeNull();
    expect(updated.body.totalAmount).toBe(2500);
    expect(updated.body.balance).toBe(2500);
  });
});
