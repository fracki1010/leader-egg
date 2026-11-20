import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  loginAs,
  createTestCustomer,
  createCreditCustomer
} from './helpers.js';
import { app } from '../app.js';
import { Promotion } from '../modules/promotions/model.js';
import { PriceEntry } from '../modules/products/price-list-model.js';
import { Order } from '../modules/orders/model.js';
import { incrementSold } from '../modules/promotions/service.js';

const request = supertest(app);

const yesterday = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString();
};

/** Creates a product via the API and seeds an active maple price. */
let promoProductCounter = 0;
const createPricedProduct = async (token: string, price: number): Promise<string> => {
  const varieties: Array<'blanco' | 'castaño'> = ['blanco', 'castaño'];
  const calibers: Array<'chico' | 'mediano' | 'grande' | 'extragrande' | 'surtido'> =
    ['chico', 'mediano', 'grande', 'extragrande', 'surtido'];
  const variety = varieties[promoProductCounter % varieties.length]!;
  const caliber = calibers[Math.floor(promoProductCounter / varieties.length) % calibers.length]!;
  promoProductCounter++;
  const res = await request
    .post('/api/v1/products')
    .set('Authorization', `Bearer ${token}`)
    .send({ variety, caliber })
    .expect(201);

  const productId = res.body._id as string;
  await PriceEntry.create({ productId, price, unit: 'maple', effectiveFrom: new Date(yesterday()) });
  return productId;
};

/** Creates a promo via the API and returns the created body. */
const createPromo = async (
  token: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const res = await request
    .post('/api/v1/promotions')
    .set('Authorization', `Bearer ${token}`)
    .send(body)
    .expect(201);
  return res.body as Record<string, unknown>;
};

interface CreatedOrderBody {
  _id: string;
  totalAmount: number;
  items: Array<Record<string, unknown>>;
}

const createOrder = async (
  token: string,
  customerId: string,
  productId: string,
  quantity: number,
  forceDuplicate = false
): Promise<CreatedOrderBody> => {
  const res = await request
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      customerId,
      channel: 'phone',
      items: [{ productId, quantity, unit: 'maple' }],
      ...(forceDuplicate ? { forceDuplicate: true } : {})
    })
    .expect(201);
  return res.body as CreatedOrderBody;
};

describe('Order promo integration (T11)', () => {
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

  it('applies a fixed_price promo and snapshots promo + originalUnitPrice on the item', async () => {
    const customer = await createTestCustomer();
    const productId = await createPricedProduct(adminToken, 1000);
    const promo = await createPromo(adminToken, {
      name: 'Verano',
      productId,
      type: 'fixed_price',
      value: 900,
      unit: 'maple'
    });

    const order = await createOrder(adminToken, customer._id as string, productId, 2);

    expect(order.totalAmount).toBe(1800);
    const item = order.items[0] as Record<string, unknown>;
    expect(item.unitPrice).toBe(900);
    expect(item.originalUnitPrice).toBe(1000);
    expect(item.subtotal).toBe(1800);
    expect(item.promo).toBeDefined();
    expect((item.promo as Record<string, unknown>).promotionId).toBe(promo._id);
    expect((item.promo as Record<string, unknown>).name).toBe('Verano');
    expect((item.promo as Record<string, unknown>).type).toBe('fixed_price');
    expect((item.promo as Record<string, unknown>).value).toBe(900);
  });

  it('applies a group fixed_price promo: qty 4 of "3 x $16.000" = 22000 (5500/unit)', async () => {
    const customer = await createTestCustomer();
    const productId = await createPricedProduct(adminToken, 6000);
    await createPromo(adminToken, {
      name: 'Tres16000',
      productId,
      type: 'fixed_price',
      value: 16000,
      minQuantity: 3,
      unit: 'maple'
    });

    const order = await createOrder(adminToken, customer._id as string, productId, 4);

    // 1 full group of 3 at $16.000 + 1 leftover unit at the $6.000 base price
    expect(order.totalAmount).toBe(22000);
    const item = order.items[0] as Record<string, unknown>;
    expect(item.subtotal).toBe(22000);
    expect(item.unitPrice).toBe(5500);
    expect(item.originalUnitPrice).toBe(6000);
    expect((item.promo as Record<string, unknown>).type).toBe('fixed_price');
  });

  it('applies a discount_percent promo', async () => {
    const customer = await createTestCustomer();
    const productId = await createPricedProduct(adminToken, 100);
    await createPromo(adminToken, {
      name: 'DiezOff',
      productId,
      type: 'discount_percent',
      value: 10,
      unit: 'maple'
    });

    const order = await createOrder(adminToken, customer._id as string, productId, 5);

    const item = order.items[0] as Record<string, unknown>;
    expect(item.unitPrice).toBe(90);
    expect(item.originalUnitPrice).toBe(100);
    expect(item.subtotal).toBe(450);
    expect(order.totalAmount).toBe(450);
    expect((item.promo as Record<string, unknown>).type).toBe('discount_percent');
  });

  it('applies buy_x_get_y legacy: totalPerGroup = value + 1, only paid units are charged', async () => {
    const customer = await createTestCustomer();
    const productId = await createPricedProduct(adminToken, 100);
    await createPromo(adminToken, {
      name: 'BogoLegacy',
      productId,
      type: 'buy_x_get_y',
      value: 2,
      unit: 'maple'
    });

    const order = await createOrder(adminToken, customer._id as string, productId, 5);

    const item = order.items[0] as Record<string, unknown>;
    // value 2 (get 1 free) → group of 3; 1 free of 5 → 4 paid × 100 = 400; effective unit price 80
    expect(item.subtotal).toBe(400);
    expect(item.unitPrice).toBe(80);
    expect(order.totalAmount).toBe(400);
    expect((item.promo as Record<string, unknown>).type).toBe('buy_x_get_y');
  });

  it('applies buy_x_get_y with getQuantity: pagás 4 llevás 5', async () => {
    const customer = await createTestCustomer();
    const productId = await createPricedProduct(adminToken, 100);
    await createPromo(adminToken, {
      name: 'Paga4Llevas5',
      productId,
      type: 'buy_x_get_y',
      value: 4,
      getQuantity: 5,
      unit: 'maple'
    });

    const order = await createOrder(adminToken, customer._id as string, productId, 5);

    const item = order.items[0] as Record<string, unknown>;
    // 1 free of 5 → 4 paid × 100 = 400; effective unit price 80
    expect(item.subtotal).toBe(400);
    expect(item.unitPrice).toBe(80);
    expect(order.totalAmount).toBe(400);
    expect((item.promo as Record<string, unknown>).type).toBe('buy_x_get_y');
  });

  it('applies buy_x_get_y 2x1 (value 1, getQuantity 2): pay 1 take 2', async () => {
    const customer = await createTestCustomer();
    const productId = await createPricedProduct(adminToken, 100);
    await createPromo(adminToken, {
      name: '2x1',
      productId,
      type: 'buy_x_get_y',
      value: 1,
      getQuantity: 2,
      unit: 'maple'
    });

    const order = await createOrder(adminToken, customer._id as string, productId, 2);

    const item = order.items[0] as Record<string, unknown>;
    // 1 free of 2 → 1 paid × 100 = 100; effective unit price 50
    expect(item.subtotal).toBe(100);
    expect(item.unitPrice).toBe(50);
    expect(order.totalAmount).toBe(100);
    expect((item.promo as Record<string, unknown>).type).toBe('buy_x_get_y');
  });

  it('most-favorable promo wins at order level (fixed 900 beats 5% discount → 950)', async () => {
    const customer = await createTestCustomer();
    const productId = await createPricedProduct(adminToken, 1000);
    await createPromo(adminToken, {
      name: 'FiveOff',
      productId,
      type: 'discount_percent',
      value: 5,
      unit: 'maple'
    });
    await createPromo(adminToken, {
      name: 'Fixed900',
      productId,
      type: 'fixed_price',
      value: 900,
      unit: 'maple'
    });

    const order = await createOrder(adminToken, customer._id as string, productId, 2);

    const item = order.items[0] as Record<string, unknown>;
    expect(item.unitPrice).toBe(900);
    expect((item.promo as Record<string, unknown>).name).toBe('Fixed900');
  });

  it('does not apply a promo when the quantity is outside min/max', async () => {
    const customer = await createTestCustomer();
    const productId = await createPricedProduct(adminToken, 1000);
    await createPromo(adminToken, {
      name: 'Min5',
      productId,
      type: 'fixed_price',
      value: 900,
      unit: 'maple',
      minQuantity: 5
    });

    const order = await createOrder(adminToken, customer._id as string, productId, 2);

    const item = order.items[0] as Record<string, unknown>;
    expect(item.unitPrice).toBe(1000); // base price
    expect(item.promo).toBeUndefined();
    expect(item.originalUnitPrice).toBeUndefined();
  });

  it('does not apply a promo whose stock limit is exhausted (base price used)', async () => {
    const customer = await createTestCustomer();
    const productId = await createPricedProduct(adminToken, 1000);
    const promo = await createPromo(adminToken, {
      name: 'OnlyOne',
      productId,
      type: 'fixed_price',
      value: 900,
      unit: 'maple',
      stockLimit: 1
    });

    // First order consumes the single promo slot
    const first = await createOrder(adminToken, customer._id as string, productId, 1);
    expect((first.items[0] as Record<string, unknown>).unitPrice).toBe(900);

    const promoDoc = await Promotion.findById(promo._id);
    expect(promoDoc!.soldQuantity).toBe(1);

    // Second order: exhausted → promo not applied
    const second = await createOrder(adminToken, customer._id as string, productId, 1, true);
    const secondItem = second.items[0] as Record<string, unknown>;
    expect(secondItem.unitPrice).toBe(1000);
    expect(secondItem.promo).toBeUndefined();
  });

  it('increments soldQuantity at creation for stock-limited promos', async () => {
    const customer = await createTestCustomer();
    const productId = await createPricedProduct(adminToken, 1000);
    const promo = await createPromo(adminToken, {
      name: 'Counted',
      productId,
      type: 'fixed_price',
      value: 900,
      unit: 'maple',
      stockLimit: 10
    });

    await createOrder(adminToken, customer._id as string, productId, 3);

    const promoDoc = await Promotion.findById(promo._id);
    expect(promoDoc!.soldQuantity).toBe(3);
  });

  it('restores soldQuantity when a pending order is cancelled', async () => {
    const customer = await createTestCustomer();
    const productId = await createPricedProduct(adminToken, 1000);
    const promo = await createPromo(adminToken, {
      name: 'CancelMe',
      productId,
      type: 'fixed_price',
      value: 900,
      unit: 'maple',
      stockLimit: 10
    });

    // Pre-existing promo consumption (scenario: soldQuantity 3)
    await Promotion.updateOne({ _id: promo._id }, { $set: { soldQuantity: 3 } });

    const order = await createOrder(adminToken, customer._id as string, productId, 1);
    let promoDoc = await Promotion.findById(promo._id);
    expect(promoDoc!.soldQuantity).toBe(4);

    await request
      .patch(`/api/v1/orders/${order._id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'cancelled' })
      .expect(200);

    promoDoc = await Promotion.findById(promo._id);
    expect(promoDoc!.soldQuantity).toBe(3);
  });

  it('restores soldQuantity when a pending order is deleted', async () => {
    const customer = await createTestCustomer();
    const productId = await createPricedProduct(adminToken, 1000);
    const promo = await createPromo(adminToken, {
      name: 'DeleteMe',
      productId,
      type: 'fixed_price',
      value: 900,
      unit: 'maple',
      stockLimit: 10
    });

    const order = await createOrder(adminToken, customer._id as string, productId, 2);
    let promoDoc = await Promotion.findById(promo._id);
    expect(promoDoc!.soldQuantity).toBe(2);

    await request
      .delete(`/api/v1/orders/${order._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    promoDoc = await Promotion.findById(promo._id);
    expect(promoDoc!.soldQuantity).toBe(0);
  });

  it('unlimited promos (no stockLimit) do not book soldQuantity', async () => {
    const customer = await createTestCustomer();
    const productId = await createPricedProduct(adminToken, 1000);
    const promo = await createPromo(adminToken, {
      name: 'Unlimited',
      productId,
      type: 'fixed_price',
      value: 900,
      unit: 'maple'
    });

    await createOrder(adminToken, customer._id as string, productId, 4);

    const promoDoc = await Promotion.findById(promo._id);
    expect(promoDoc!.soldQuantity).toBe(0);
  });

  // ─── Stock-limit accounting regressions ─────────────────────────────────

  it('rejects a line larger than the stock limit with 409 and books nothing', async () => {
    const customer = await createTestCustomer();
    const productId = await createPricedProduct(adminToken, 1000);
    const promo = await createPromo(adminToken, {
      name: 'TooBig',
      productId,
      type: 'fixed_price',
      value: 900,
      unit: 'maple',
      stockLimit: 10
    });

    const response = await request
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customer._id,
        channel: 'phone',
        items: [{ productId, quantity: 100, unit: 'maple' }]
      })
      .expect(409);

    expect(response.body.error).toMatch(/TooBig/);
    expect(response.body.error).toMatch(/quedan 10 unidades/);

    const promoDoc = await Promotion.findById(promo._id);
    expect(promoDoc!.soldQuantity).toBe(0);
    expect(await Order.countDocuments()).toBe(0);
  });

  it('books sequential orders up to the exact stock limit and never overbooks', async () => {
    const customer = await createTestCustomer();
    const productId = await createPricedProduct(adminToken, 1000);
    const promo = await createPromo(adminToken, {
      name: 'ExactTen',
      productId,
      type: 'fixed_price',
      value: 900,
      unit: 'maple',
      stockLimit: 10
    });

    const first = await createOrder(adminToken, customer._id as string, productId, 6);
    expect((first.items[0] as Record<string, unknown>).promo).toBeDefined();

    const second = await createOrder(adminToken, customer._id as string, productId, 4);
    expect((second.items[0] as Record<string, unknown>).promo).toBeDefined();

    let promoDoc = await Promotion.findById(promo._id);
    expect(promoDoc!.soldQuantity).toBe(10);

    // Exhausted promo: the next order line is NOT priced with the promo and
    // the counter stays capped (existing "fall back to base price" behaviour).
    const third = await createOrder(adminToken, customer._id as string, productId, 1);
    const thirdItem = third.items[0] as Record<string, unknown>;
    expect(thirdItem.unitPrice).toBe(1000);
    expect(thirdItem.promo).toBeUndefined();

    promoDoc = await Promotion.findById(promo._id);
    expect(promoDoc!.soldQuantity).toBe(10);

    // A direct booking beyond the limit is a hard 409 (never a partial booking).
    await expect(incrementSold(promo._id as string, 1)).rejects.toMatchObject({ status: 409 });
    promoDoc = await Promotion.findById(promo._id);
    expect(promoDoc!.soldQuantity).toBe(10);
  });

  it('releases the promo booking when the credit-limit check fails after pricing', async () => {
    const customer = await createCreditCustomer(100, 15);
    const productId = await createPricedProduct(adminToken, 1000);
    const promo = await createPromo(adminToken, {
      name: 'CreditBlocked',
      productId,
      type: 'fixed_price',
      value: 900,
      unit: 'maple',
      stockLimit: 10
    });

    const response = await request
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customer._id,
        channel: 'phone',
        items: [{ productId, quantity: 2, unit: 'maple' }]
      })
      .expect(409);

    expect(response.body.error).toMatch(/credit limit/i);

    const promoDoc = await Promotion.findById(promo._id);
    expect(promoDoc!.soldQuantity).toBe(0);
    expect(await Order.countDocuments()).toBe(0);
  });

  it('leaves soldQuantity untouched when an order edit is invalid (retries stay stable)', async () => {
    const customer = await createTestCustomer();
    const productId = await createPricedProduct(adminToken, 1000);
    const promo = await createPromo(adminToken, {
      name: 'EditGuard',
      productId,
      type: 'fixed_price',
      value: 900,
      unit: 'maple',
      stockLimit: 10
    });

    const order = await createOrder(adminToken, customer._id as string, productId, 5);
    expect((await Promotion.findById(promo._id))!.soldQuantity).toBe(5);

    // Retrying the same invalid PATCH must not restore the booking twice.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await request
        .patch(`/api/v1/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ productId: '000000000000000000000000', quantity: 1 }] })
        .expect(404);

      expect(response.body.error).toMatch(/product not found/i);
      expect((await Promotion.findById(promo._id))!.soldQuantity).toBe(5);
    }

    expect(await Order.countDocuments()).toBe(1);
  });

  it('releases the promo quota when returned units were booked under a stock-limited promo', async () => {
    const customer = await createTestCustomer();
    const productId = await createPricedProduct(adminToken, 1000);
    const promo = await createPromo(adminToken, {
      name: 'Returnable',
      productId,
      type: 'fixed_price',
      value: 900,
      unit: 'maple',
      stockLimit: 10
    });

    const order = await createOrder(adminToken, customer._id as string, productId, 5);
    expect((await Promotion.findById(promo._id))!.soldQuantity).toBe(5);

    // Simulate a completed delivery without touching inventory: the return flow
    // only releases promo quota here (stockDeducted=false skips restock).
    await Order.updateOne({ _id: order._id }, { status: 'delivered', stockDeducted: false });

    await request
      .post(`/api/v1/orders/${order._id}/returns`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        items: [{ productId, quantity: 2 }],
        reason: 'difference',
        effect: 'reduce_debt'
      })
      .expect(201);

    expect((await Promotion.findById(promo._id))!.soldQuantity).toBe(3);
  });

  it('does not release returned promo units twice when the order is cancelled later', async () => {
    const customer = await createTestCustomer();
    const productId = await createPricedProduct(adminToken, 1000);
    const promo = await createPromo(adminToken, {
      name: 'NoDoubleRelease',
      productId,
      type: 'fixed_price',
      value: 900,
      unit: 'maple',
      stockLimit: 10
    });

    const order = await createOrder(adminToken, customer._id as string, productId, 5);
    await Order.updateOne({ _id: order._id }, { status: 'in_transit', stockDeducted: false });

    await request
      .post(`/api/v1/orders/${order._id}/returns`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        items: [{ productId, quantity: 2 }],
        reason: 'difference',
        effect: 'reduce_debt'
      })
      .expect(201);
    expect((await Promotion.findById(promo._id))!.soldQuantity).toBe(3);

    // Cancelling releases only the 3 units still booked by the order.
    await request
      .patch(`/api/v1/orders/${order._id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'cancelled' })
      .expect(200);

    expect((await Promotion.findById(promo._id))!.soldQuantity).toBe(0);
  });
});