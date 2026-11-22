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
import { Order } from '../modules/orders/model.js';
import { Inventory } from '../modules/inventory/model.js';
import { CashAdjustment } from '../modules/cash-adjustments/model.js';
import { CustomerCharge } from '../modules/customer-charges/model.js';

const request = supertest(app);

describe('Orders — delivered at creation + cancellation money handling', () => {
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
    const admin = await seedAdminUser();
    adminToken = await loginAs(request, admin.email, admin.password);
    products = await getProductIds();
  });

  const createOrderRequest = (payload: Record<string, unknown>) =>
    request
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload);

  /** Creates an order for one product; `paid` registers an upfront payment. */
  const createPendingOrder = async (
    options: { quantity?: number; productId?: string; paid?: number } = {}
  ): Promise<Record<string, any>> => {
    const quantity = options.quantity ?? 2;
    const productId = options.productId ?? products['blanco-chico']!;
    const customer = await createTestCustomer();

    const payload: Record<string, unknown> = {
      customerId: customer._id,
      channel: 'phone',
      items: [{ productId, quantity }]
    };
    if (options.paid) {
      payload.initialPayment = { amount: options.paid, method: 'cash' };
    }

    const response = await createOrderRequest(payload).expect(201);
    return response.body as Record<string, any>;
  };

  const transition = (orderId: string, body: Record<string, unknown>) =>
    request
      .patch(`/api/v1/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);

  const inventoryQty = async (productId: string): Promise<number> =>
    (await Inventory.findOne({ productId }))!.quantity;

  /**
   * Delivers an order through the normal path (so stock actually leaves the
   * warehouse) and then returns it to a cancellable status — the same
   * operational edge the existing stock-restore tests simulate.
   */
  const deliverThenReturnToInTransit = async (orderId: string): Promise<void> => {
    await transition(orderId, { status: 'assigned' }).expect(200);
    await transition(orderId, { status: 'in_transit' }).expect(200);
    await transition(orderId, { status: 'delivered' }).expect(200);
    await Order.updateOne({ _id: orderId }, { status: 'in_transit' });
  };

  // ─── Feature A: create an order already delivered ────────────────────────

  it('creates an order already delivered and deducts stock immediately', async () => {
    const productId = products['blanco-chico']!;
    const customer = await createTestCustomer();

    const response = await createOrderRequest({
      customerId: customer._id,
      channel: 'phone',
      status: 'delivered',
      items: [{ productId, quantity: 3 }]
    }).expect(201);

    expect(response.body.status).toBe('delivered');
    expect(response.body.stockDeducted).toBe(true);
    expect(await inventoryQty(productId)).toBe(97); // 100 - 3
  });

  it('leaves no orphan order when a delivered creation lacks stock', async () => {
    const productId = products['castaño-chico']!;
    await Inventory.updateOne({ productId }, { quantity: 1 });
    const customer = await createTestCustomer();

    await createOrderRequest({
      customerId: customer._id,
      channel: 'phone',
      status: 'delivered',
      items: [{ productId, quantity: 5 }]
    }).expect(409);

    expect(await Order.countDocuments()).toBe(0);
    expect(await inventoryQty(productId)).toBe(1);
  });

  // ─── Feature B: money decision when a paid order is cancelled ────────────

  it('rejects cancelling a paid order without a money action and leaves it untouched', async () => {
    const productId = products['blanco-chico']!;
    const order = await createPendingOrder({ quantity: 2, paid: 50 });
    await deliverThenReturnToInTransit(order._id);

    const response = await transition(order._id, { status: 'cancelled' }).expect(400);
    expect(response.body.error).toMatch(/cobrados/);

    const stored = await Order.findById(order._id);
    expect(stored!.status).toBe('in_transit');
    expect(await inventoryQty(productId)).toBe(98); // stock was NOT restored
    expect(await CashAdjustment.countDocuments()).toBe(0);
    expect(await CustomerCharge.countDocuments()).toBe(0);
  });

  it('refunds cash and restores stock when cancelling with refund_cash', async () => {
    const productId = products['blanco-chico']!;
    const order = await createPendingOrder({ quantity: 2, paid: 50 });
    await deliverThenReturnToInTransit(order._id);

    const response = await transition(order._id, {
      status: 'cancelled',
      moneyAction: 'refund_cash'
    }).expect(200);

    expect(response.body.status).toBe('cancelled');
    expect(response.body.stockDeducted).toBe(false);
    expect(await inventoryQty(productId)).toBe(100);

    const adjustments = await CashAdjustment.find();
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]!.account).toBe('cash');
    expect(adjustments[0]!.amount).toBe(-50);
    expect(adjustments[0]!.reason).toBe('other');
  });

  it('records a customer credit when cancelling with customer_credit', async () => {
    const order = await createPendingOrder({ quantity: 2, paid: 50 });
    await deliverThenReturnToInTransit(order._id);

    await transition(order._id, {
      status: 'cancelled',
      moneyAction: 'customer_credit'
    }).expect(200);

    const charges = await CustomerCharge.find();
    expect(charges).toHaveLength(1);
    expect(charges[0]!.type).toBe('credit');
    expect(charges[0]!.amount).toBe(50);
    expect(await CashAdjustment.countDocuments()).toBe(0);
  });

  it('cancels an unpaid order without asking about money', async () => {
    const order = await createPendingOrder({ quantity: 2 });

    const response = await transition(order._id, { status: 'cancelled' }).expect(200);
    expect(response.body.status).toBe('cancelled');

    expect(await CashAdjustment.countDocuments()).toBe(0);
    expect(await CustomerCharge.countDocuments()).toBe(0);
  });

  it('rejects moneyAction outside a cancellation', async () => {
    const order = await createPendingOrder({ quantity: 1 });

    const response = await transition(order._id, {
      status: 'assigned',
      moneyAction: 'refund_cash'
    }).expect(400);

    expect(response.body.error).toMatch(/solo aplica al cancelar/);

    const stored = await Order.findById(order._id);
    expect(stored!.status).toBe('pending');
  });
});
