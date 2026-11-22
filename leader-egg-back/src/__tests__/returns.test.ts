import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import bcrypt from 'bcrypt';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  seedDriverUser,
  seedProducts,
  loginAs,
  createTestCustomer,
  getProductIds,
  indexTestUser
} from './helpers.js';
import { app } from '../app.js';
import { Order } from '../modules/orders/model.js';
import { Inventory } from '../modules/inventory/model.js';
import { StockTransaction } from '../modules/inventory/transaction-model.js';
import { PriceEntry } from '../modules/products/price-list-model.js';
import { User } from '../modules/auth/model.js';
import { Customer } from '../modules/customers/model.js';
import { CustomerCharge } from '../modules/customer-charges/model.js';
import { Return } from '../modules/returns/model.js';

const request = supertest(app);

describe('Returns Integration', () => {
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

  /** Create an order with the given items (maple unit) and return its id + total. */
  const createOrder = async (
    items: Array<{ productId: string; quantity: number }>
  ): Promise<{ orderId: string; total: number }> => {
    const customer = await createTestCustomer();
    const response = await request
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId: customer._id, channel: 'phone', items })
      .expect(201);
    return { orderId: response.body._id as string, total: response.body.totalAmount as number };
  };

  /** Simulate a real delivery: stock leaves the warehouse and stockDeducted=true. */
  const deliverWithStock = async (
    orderId: string,
    items: Array<{ productId: string; quantity: number }>
  ): Promise<void> => {
    for (const item of items) {
      await Inventory.updateOne(
        { productId: item.productId },
        { $inc: { quantity: -item.quantity } }
      );
    }
    await Order.updateOne({ _id: orderId }, { status: 'delivered', stockDeducted: true });
  };

  const payOrder = async (orderId: string, amount: number): Promise<void> => {
    await request
      .post(`/api/v1/orders/${orderId}/payments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount, method: 'cash' })
      .expect(201);
  };

  const getOrder = async (orderId: string): Promise<Record<string, unknown>> => {
    const response = await request
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    return response.body as Record<string, unknown>;
  };

  const createReturn = (
    orderId: string,
    body: Record<string, unknown>,
    token: string = adminToken
  ) => {
    return request
      .post(`/api/v1/orders/${orderId}/returns`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  };

  describe('POST /api/v1/orders/:id/returns', () => {
    it('creates a cash refund on a paid delivered order: stock back, paidAmount down, invariant holds', async () => {
      const products = await getProductIds();
      const { orderId } = await createOrder([{ productId: products['blanco-chico']!!, quantity: 5 }]); // $125
      await deliverWithStock(orderId, [{ productId: products['blanco-chico']!!, quantity: 5 }]);
      await payOrder(orderId, 125);

      const response = await createReturn(orderId, {
        items: [{ productId: products['blanco-chico']!!, quantity: 2 }],
        reason: 'difference',
        effect: 'refund_cash'
      }).expect(201);

      expect(response.body.returnedAmount).toBe(50); // 2 × $25
      expect(response.body.refundAmount).toBe(50);
      expect(response.body.reason).toBe('difference');
      expect(response.body.effect).toBe('refund_cash');
      expect(response.body.items[0]).toMatchObject({
        productName: 'Blanco Chico',
        quantity: 2,
        unitPrice: 25,
        subtotal: 50
      });

      const order = await getOrder(orderId);
      expect(order.paidAmount).toBe(75);
      expect(order.balance).toBe(0);
      expect(order.returnedAmount).toBe(50);
      expect(order.paymentStatus).toBe('paid');
      // Invariant: totalAmount − returnedAmount = paidAmount + balance
      expect((order.totalAmount as number) - (order.returnedAmount as number)).toBe(
        (order.paidAmount as number) + (order.balance as number)
      );

      // Stock restored: 100 − 5 (delivery) + 2 (return) = 97
      const inventory = await Inventory.findOne({ productId: products['blanco-chico']!! });
      expect(inventory!.quantity).toBe(97);

      // A 'return' transaction was logged
      const txn = await StockTransaction.findOne({
        productId: products['blanco-chico']!!,
        type: 'return'
      });
      expect(txn).not.toBeNull();
      expect(txn!.quantity).toBe(2);
      expect(txn!.notes).toMatch(/Devolución/);
    });

    it('restocks the maple equivalent of a medio cajón return', async () => {
      const products = await getProductIds();
      const productId = products['castaño-chico']!;

      // seedProducts only seeds maple prices — add an active medio cajón price.
      await PriceEntry.create({
        productId,
        price: 150,
        unit: 'medio_cajon',
        effectiveFrom: new Date()
      });

      const customer = await createTestCustomer();
      const orderRes = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId, quantity: 2, unit: 'medio_cajon' }]
        })
        .expect(201);
      expect(orderRes.body.items[0].mapleQty).toBe(12); // 2 × (12 / 2)
      const orderId = orderRes.body._id as string;

      // Stock leaves the warehouse by the maple equivalent (12 maples).
      await deliverWithStock(orderId, [{ productId, quantity: 12 }]);
      let inventory = await Inventory.findOne({ productId });
      expect(inventory!.quantity).toBe(88); // 100 - 12

      // Return half of what was sold → 1 medio cajón = 6 maples back.
      const response = await createReturn(orderId, {
        items: [{ productId, quantity: 1 }],
        reason: 'difference',
        effect: 'no_refund'
      }).expect(201);

      expect(response.body.items[0].unit).toBe('medio_cajon');
      expect(response.body.items[0].mapleQty).toBe(6);

      inventory = await Inventory.findOne({ productId });
      expect(inventory!.quantity).toBe(94); // 88 + 6
    });

    it('derives refundAccount from effect when omitted (refund_cash → cash) (R3)', async () => {
      const products = await getProductIds();
      const { orderId } = await createOrder([{ productId: products['blanco-chico']!!, quantity: 5 }]); // $125
      await deliverWithStock(orderId, [{ productId: products['blanco-chico']!!, quantity: 5 }]);
      await payOrder(orderId, 125);

      const response = await createReturn(orderId, {
        items: [{ productId: products['blanco-chico']!!, quantity: 2 }],
        reason: 'difference',
        effect: 'refund_cash'
      }).expect(201);

      expect(response.body.refundAccount).toBe('cash');
    });

    it('derives refundAccount from effect when omitted (refund_transfer → mp) (R3)', async () => {
      const products = await getProductIds();
      const { orderId } = await createOrder([{ productId: products['blanco-chico']!!, quantity: 5 }]); // $125
      await deliverWithStock(orderId, [{ productId: products['blanco-chico']!!, quantity: 5 }]);
      await payOrder(orderId, 125);

      const response = await createReturn(orderId, {
        items: [{ productId: products['blanco-chico']!!, quantity: 2 }],
        reason: 'difference',
        effect: 'refund_transfer'
      }).expect(201);

      expect(response.body.refundAccount).toBe('mp');
    });

    it('accepts an explicit refundAccount override (refund_cash → bank)', async () => {
      const products = await getProductIds();
      const { orderId } = await createOrder([{ productId: products['blanco-chico']!!, quantity: 5 }]); // $125
      await deliverWithStock(orderId, [{ productId: products['blanco-chico']!!, quantity: 5 }]);
      await payOrder(orderId, 125);

      const response = await createReturn(orderId, {
        items: [{ productId: products['blanco-chico']!!, quantity: 2 }],
        reason: 'difference',
        effect: 'refund_cash',
        refundAccount: 'bank'
      }).expect(201);

      expect(response.body.refundAccount).toBe('bank');
    });

    it('leaves refundAccount null for non-refund effects (reduce_debt)', async () => {
      const products = await getProductIds();
      const { orderId } = await createOrder([{ productId: products['blanco-chico']!!, quantity: 5 }]); // $125
      await deliverWithStock(orderId, [{ productId: products['blanco-chico']!!, quantity: 5 }]);

      const response = await createReturn(orderId, {
        items: [{ productId: products['blanco-chico']!!, quantity: 2 }],
        reason: 'difference',
        effect: 'reduce_debt'
      }).expect(201);

      expect(response.body.refundAmount).toBe(0);
      expect(response.body.refundAccount).toBeNull();
    });

    it('reduce_debt on an unpaid credit order lowers the balance, paidAmount stays 0', async () => {
      const products = await getProductIds();
      const { orderId } = await createOrder([{ productId: products['blanco-chico']!!, quantity: 5 }]); // $125
      await deliverWithStock(orderId, [{ productId: products['blanco-chico']!!, quantity: 5 }]);

      const response = await createReturn(orderId, {
        items: [{ productId: products['blanco-chico']!!, quantity: 2 }],
        reason: 'difference',
        effect: 'reduce_debt'
      }).expect(201);

      expect(response.body.returnedAmount).toBe(50);
      expect(response.body.refundAmount).toBe(0);

      const order = await getOrder(orderId);
      expect(order.balance).toBe(75);
      expect(order.paidAmount).toBe(0);
      expect(order.returnedAmount).toBe(50);
      expect(order.paymentStatus).toBe('unpaid');
    });

    it('broken goods: no stock restored and the loss is only recorded', async () => {
      const products = await getProductIds();
      const { orderId } = await createOrder([{ productId: products['blanco-chico']!!, quantity: 5 }]);
      await deliverWithStock(orderId, [{ productId: products['blanco-chico']!!, quantity: 5 }]);
      await payOrder(orderId, 125);

      const response = await createReturn(orderId, {
        items: [{ productId: products['blanco-chico']!!, quantity: 2 }],
        reason: 'broken',
        effect: 'refund_cash',
        notes: 'Huevos rotos en transporte'
      }).expect(201);

      expect(response.body.reason).toBe('broken');

      // Stock NOT restored: 100 − 5 = 95
      const inventory = await Inventory.findOne({ productId: products['blanco-chico']!! });
      expect(inventory!.quantity).toBe(95);

      const txn = await StockTransaction.findOne({
        productId: products['blanco-chico']!!,
        type: 'return'
      });
      expect(txn).toBeNull();

      const order = await getOrder(orderId);
      expect(order.paidAmount).toBe(75); // refund still applied
      expect(order.returnedAmount).toBe(50);
    });

    it('partial return of one item on a two-item order reflects only that item', async () => {
      const products = await getProductIds();
      const { orderId } = await createOrder([
        { productId: products['blanco-chico']!!, quantity: 2 }, // $50
        { productId: products['blanco-grande']!!, quantity: 2 } // $54
      ]);
      await deliverWithStock(orderId, [
        { productId: products['blanco-chico']!!, quantity: 2 },
        { productId: products['blanco-grande']!!, quantity: 2 }
      ]);

      const response = await createReturn(orderId, {
        items: [{ productId: products['blanco-chico']!!, quantity: 1 }],
        reason: 'difference',
        effect: 'reduce_debt'
      }).expect(201);

      expect(response.body.returnedAmount).toBe(25);
      expect(response.body.items).toHaveLength(1);

      const order = await getOrder(orderId);
      expect(order.returnedAmount).toBe(25);
      expect(order.balance).toBe(104 - 25);

      const inventory = await Inventory.findOne({ productId: products['blanco-chico']!! });
      expect(inventory!.quantity).toBe(99); // 100 − 2 + 1
    });

    it('rejects a quantity exceeding the remaining amount with 400', async () => {
      const products = await getProductIds();
      const { orderId } = await createOrder([{ productId: products['blanco-chico']!!, quantity: 5 }]);
      await deliverWithStock(orderId, [{ productId: products['blanco-chico']!!, quantity: 5 }]);

      await createReturn(orderId, {
        items: [{ productId: products['blanco-chico']!!, quantity: 3 }],
        reason: 'difference',
        effect: 'reduce_debt'
      }).expect(201);

      // Only 2 remain — requesting 3 must fail
      const response = await createReturn(orderId, {
        items: [{ productId: products['blanco-chico']!!, quantity: 3 }],
        reason: 'difference',
        effect: 'reduce_debt'
      }).expect(400);

      expect(response.body.error).toMatch(/más de lo vendido/);
    });

    it('rejects a refund above the paid amount with 400', async () => {
      const products = await getProductIds();
      const { orderId } = await createOrder([{ productId: products['blanco-chico']!!, quantity: 5 }]); // $125
      await deliverWithStock(orderId, [{ productId: products['blanco-chico']!!, quantity: 5 }]);
      await payOrder(orderId, 50); // only partially paid

      const response = await createReturn(orderId, {
        items: [{ productId: products['blanco-chico']!!, quantity: 2 }], // $50 returned
        reason: 'difference',
        effect: 'refund_cash',
        refundAmount: 60 // more than the $50 paid
      }).expect(400);

      expect(response.body.error).toMatch(/exceeds paid amount/);
    });

    it('rejects a return on a pending order with 409', async () => {
      const products = await getProductIds();
      const { orderId } = await createOrder([{ productId: products['blanco-chico']!!, quantity: 5 }]); // still pending

      const response = await createReturn(orderId, {
        items: [{ productId: products['blanco-chico']!!, quantity: 1 }],
        reason: 'difference',
        effect: 'reduce_debt'
      }).expect(409);

      expect(response.body.error).toMatch(/Solo se puede devolver/);
    });

    it('blocks undoing a delivery after a return with 409', async () => {
      const products = await getProductIds();
      const { orderId } = await createOrder([{ productId: products['blanco-chico']!!, quantity: 5 }]);
      await deliverWithStock(orderId, [{ productId: products['blanco-chico']!!, quantity: 5 }]);
      await createReturn(orderId, {
        items: [{ productId: products['blanco-chico']!!, quantity: 1 }],
        reason: 'difference',
        effect: 'reduce_debt'
      }).expect(201);

      const response = await request
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'in_transit' })
        .expect(409);

      expect(response.body.error).toMatch(/No se puede deshacer una entrega con devoluciones/);
    });

    it('allows a driver to create a return (201)', async () => {
      const products = await getProductIds();
      const { orderId } = await createOrder([{ productId: products['blanco-chico']!!, quantity: 5 }]);
      await deliverWithStock(orderId, [{ productId: products['blanco-chico']!!, quantity: 5 }]);

      const response = await createReturn(
        orderId,
        {
          items: [{ productId: products['blanco-chico']!!, quantity: 2 }],
          reason: 'difference',
          effect: 'reduce_debt'
        },
        driverToken
      ).expect(201);

      expect(response.body.returnedAmount).toBe(50);
    });

    it('forbids a viewer from creating a return (403)', async () => {
      const viewerEmail = 'viewer@test.com';
      const viewerPassword = 'testpassword';
      const viewer = await User.create({
        name: 'Test Viewer',
        email: viewerEmail,
        passwordHash: await bcrypt.hash(viewerPassword, 10),
        role: 'viewer'
      });
      await indexTestUser(viewerEmail, viewer._id);
      const viewerToken = await loginAs(request, viewerEmail, viewerPassword);

      const products = await getProductIds();
      const { orderId } = await createOrder([{ productId: products['blanco-chico']!!, quantity: 5 }]);
      await deliverWithStock(orderId, [{ productId: products['blanco-chico']!!, quantity: 5 }]);

      await createReturn(
        orderId,
        {
          items: [{ productId: products['blanco-chico']!!, quantity: 1 }],
          reason: 'difference',
          effect: 'reduce_debt'
        },
        viewerToken
      ).expect(403);
    });

    it('rejects a product that is not on the order (400)', async () => {
      const products = await getProductIds();
      const { orderId } = await createOrder([{ productId: products['blanco-chico']!!, quantity: 5 }]);
      await deliverWithStock(orderId, [{ productId: products['blanco-chico']!!, quantity: 5 }]);

      const response = await createReturn(orderId, {
        items: [{ productId: products['blanco-grande']!!, quantity: 1 }],
        reason: 'difference',
        effect: 'reduce_debt'
      }).expect(400);

      expect(response.body.error).toMatch(/Product not in order/);
    });

    it('returns 404 for an unknown order', async () => {
      const products = await getProductIds();
      const fakeId = '507f1f77bcf86cd799439011';
      await createReturn(fakeId, {
        items: [{ productId: products['blanco-chico']!, quantity: 1 }],
        reason: 'difference',
        effect: 'reduce_debt'
      }).expect(404);
    });

    it('returns 401 without a token', async () => {
      const products = await getProductIds();
      const { orderId } = await createOrder([{ productId: products['blanco-chico']!!, quantity: 1 }]);

      await request
        .post(`/api/v1/orders/${orderId}/returns`)
        .send({
          items: [{ productId: products['blanco-chico']!!, quantity: 1 }],
          reason: 'difference',
          effect: 'reduce_debt'
        })
        .expect(401);
    });

    // ─── Effective-value math (discounted orders) ──────────────────────────

    /**
     * subtotal 30,000 (600 × $25 + 500 × $30), bonificación 5,000 → total 25,000.
     * Delivered and fully paid, so `balance` is 0.
     */
    const createBonifiedPaidOrder = async (): Promise<{
      orderId: string;
      orderNumber: string;
      customerId: string;
    }> => {
      const products = await getProductIds();
      const customer = await createTestCustomer();
      const response = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [
            { productId: products['blanco-chico']!!, quantity: 600 },
            { productId: products['castaño-grande']!!, quantity: 500 }
          ],
          bonification: { type: 'amount', value: 5000 }
        })
        .expect(201);

      expect(response.body.subtotal).toBe(30000);
      expect(response.body.totalAmount).toBe(25000);

      const orderId = response.body._id as string;
      await deliverWithStock(orderId, [
        { productId: products['blanco-chico']!!, quantity: 600 },
        { productId: products['castaño-grande']!!, quantity: 500 }
      ]);
      await payOrder(orderId, 25000);

      return {
        orderId,
        orderNumber: response.body.orderNumber as string,
        customerId: response.body.customerId as string
      };
    };

    it('values a discounted-order return at the effective price, not the subtotal price', async () => {
      const products = await getProductIds();
      const { orderId } = await createBonifiedPaidOrder();

      const response = await createReturn(orderId, {
        // Raw line subtotal is 15,000 but the order is only worth 25,000/30,000
        // of its subtotal, so the effective value is 12,500.
        items: [{ productId: products['blanco-chico']!!, quantity: 600 }],
        reason: 'difference',
        effect: 'refund_cash'
      }).expect(201);

      expect(response.body.returnedValue).toBe(12500);
      expect(response.body.returnedAmount).toBe(12500);
      expect(response.body.refundAmount).toBe(12500);
      expect(response.body.creditIssued).toBe(0);
      expect(response.body.debtCancelled).toBe(0);

      const order = await getOrder(orderId);
      expect(order.paidAmount).toBe(12500);
      expect(order.balance).toBe(0);
      expect(order.returnedAmount).toBe(12500);
    });

    it('caps a full return of a discounted order at the total, never the subtotal', async () => {
      const products = await getProductIds();
      const { orderId } = await createBonifiedPaidOrder();

      const response = await createReturn(orderId, {
        items: [
          { productId: products['blanco-chico']!!, quantity: 600 },
          { productId: products['castaño-grande']!!, quantity: 500 }
        ],
        reason: 'difference',
        effect: 'refund_cash'
      }).expect(201);

      expect(response.body.returnedValue).toBe(25000);

      const order = await getOrder(orderId);
      expect(order.returnedAmount).toBe(25000);
      expect(order.totalAmount).toBe(25000); // totalAmount is never mutated
      expect(order.paidAmount).toBe(0);
      expect(order.balance).toBe(0);
    });

    it('issues store credit for the unrefunded paid portion and keeps the books balanced', async () => {
      const products = await getProductIds();
      const customer = await createTestCustomer();
      const created = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: products['blanco-chico']!!, quantity: 200 }] // $5,000
        })
        .expect(201);
      const orderId = created.body._id as string;
      await deliverWithStock(orderId, [{ productId: products['blanco-chico']!!, quantity: 200 }]);
      await payOrder(orderId, 5000);

      // Return the $5,000 effective value but only refund $2,000: the remaining
      // $3,000 of already-paid goods becomes a saldo a favor.
      const response = await createReturn(orderId, {
        items: [{ productId: products['blanco-chico']!!, quantity: 200 }],
        reason: 'difference',
        effect: 'refund_cash',
        refundAmount: 2000
      }).expect(201);

      expect(response.body.returnedValue).toBe(5000);
      expect(response.body.refundAmount).toBe(2000);
      expect(response.body.creditIssued).toBe(3000);
      expect(response.body.debtCancelled).toBe(0);

      const charges = await CustomerCharge.find({ customerId: customer._id });
      expect(charges).toHaveLength(1);
      expect(charges[0]!.type).toBe('credit');
      expect(charges[0]!.amount).toBe(3000);
      expect(charges[0]!.reason).toBe('other');
      expect(charges[0]!.note).toContain(`Saldo a favor por devolución ${created.body.orderNumber}`);

      const order = await getOrder(orderId);
      expect(order.paidAmount).toBe(3000);
      expect(order.balance).toBe(0);
      expect(order.returnedAmount).toBe(5000);
      // total − returned = paid + balance − credit: the credit offsets the paid
      // amount that was converted into store credit (measured at the effective
      // value). NOTE: this is the algebraically consistent form of the
      // identity; see the apply report for why `+ credit` cannot hold.
      expect((order.totalAmount as number) - (order.returnedAmount as number)).toBe(
        (order.paidAmount as number) + (order.balance as number) - 3000
      );
    });

    it('reduce_debt on a fully paid order issues credit and moves no cash', async () => {
      const products = await getProductIds();
      const customer = await createTestCustomer();
      const created = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: products['blanco-chico']!!, quantity: 200 }] // $5,000
        })
        .expect(201);
      const orderId = created.body._id as string;
      await deliverWithStock(orderId, [{ productId: products['blanco-chico']!!, quantity: 200 }]);
      await payOrder(orderId, 5000);

      const response = await createReturn(orderId, {
        items: [{ productId: products['blanco-chico']!!, quantity: 200 }],
        reason: 'difference',
        effect: 'reduce_debt'
      }).expect(201);

      expect(response.body.refundAmount).toBe(0);
      expect(response.body.creditIssued).toBe(5000);
      expect(response.body.debtCancelled).toBe(0);
      expect(response.body.refundAccount).toBeNull();

      const charges = await CustomerCharge.find({ customerId: customer._id });
      expect(charges).toHaveLength(1);
      expect(charges[0]!.type).toBe('credit');
      expect(charges[0]!.amount).toBe(5000);

      const order = await getOrder(orderId);
      expect(order.paidAmount).toBe(5000); // no cash was refunded
      expect(order.balance).toBe(0);
      expect(order.returnedAmount).toBe(5000);
    });

    it('an unpaid credit sale return lowers the balance with no refund and no credit', async () => {
      const products = await getProductIds();
      const customer = await createTestCustomer();
      const created = await request
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer._id,
          channel: 'phone',
          items: [{ productId: products['blanco-chico']!!, quantity: 200 }] // $5,000
        })
        .expect(201);
      const orderId = created.body._id as string;
      await deliverWithStock(orderId, [{ productId: products['blanco-chico']!!, quantity: 200 }]);

      const response = await createReturn(orderId, {
        items: [{ productId: products['blanco-chico']!!, quantity: 200 }],
        reason: 'difference',
        effect: 'reduce_debt'
      }).expect(201);

      expect(response.body.returnedValue).toBe(5000);
      expect(response.body.refundAmount).toBe(0);
      expect(response.body.creditIssued).toBe(0);
      expect(response.body.debtCancelled).toBe(5000);

      const order = await getOrder(orderId);
      expect(order.paidAmount).toBe(0);
      expect(order.balance).toBe(0); // 5,000 − 5,000 debt cancelled
      expect(order.returnedAmount).toBe(5000);

      expect(await CustomerCharge.countDocuments({ customerId: customer._id })).toBe(0);
    });

    it('rejects a cumulative return above the effective total and writes nothing', async () => {
      const products = await getProductIds();
      const { orderId } = await createBonifiedPaidOrder();

      // Simulate a prior return that already consumed almost the whole
      // effective total (legal quantity remains, value does not).
      await Order.updateOne({ _id: orderId }, { returnedAmount: 24990 });
      const before = await Order.findById(orderId);

      const response = await createReturn(orderId, {
        // 1 × $25 raw → ~$20.83 effective, pushing the cumulative over 25,000.
        items: [{ productId: products['blanco-chico']!!, quantity: 1 }],
        reason: 'difference',
        effect: 'reduce_debt'
      }).expect(400);

      expect(response.body.error).toMatch(/exceeds order total/);
      expect(await Return.countDocuments({ orderId })).toBe(0);

      const after = await Order.findById(orderId);
      expect(after!.returnedAmount).toBe(24990);
      expect(after!.paidAmount).toBe(before!.paidAmount);
      expect(after!.balance).toBe(before!.balance);
    });
  });

  describe('GET /api/v1/orders/:id/returns', () => {
    it('lists an order returns newest first', async () => {
      const products = await getProductIds();
      const { orderId } = await createOrder([{ productId: products['blanco-chico']!!, quantity: 5 }]);
      await deliverWithStock(orderId, [{ productId: products['blanco-chico']!!, quantity: 5 }]);

      await createReturn(orderId, {
        items: [{ productId: products['blanco-chico']!!, quantity: 2 }],
        reason: 'difference',
        effect: 'reduce_debt'
      }).expect(201);
      await createReturn(orderId, {
        items: [{ productId: products['blanco-chico']!!, quantity: 1 }],
        reason: 'other',
        effect: 'no_refund'
      }).expect(201);

      const response = await request
        .get(`/api/v1/orders/${orderId}/returns`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveLength(2);
      // Newest first: the 1-unit return (created last)
      expect(response.body[0].items[0].quantity).toBe(1);
      expect(response.body[1].items[0].quantity).toBe(2);
    });

    it('returns 404 for an unknown order', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      await request
        .get(`/api/v1/orders/${fakeId}/returns`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('GET /api/v1/returns', () => {
    it('lists all returns with customerId and reason filters', async () => {
      const products = await getProductIds();
      const customerA = await createTestCustomer({ name: 'Cliente A' });
      const customerB = await createTestCustomer({ name: 'Cliente B' });

      const makeOrder = async (customer: Record<string, unknown>) => {
        const response = await request
          .post('/api/v1/orders')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            customerId: customer._id,
            channel: 'phone',
            items: [{ productId: products['blanco-chico']!!, quantity: 5 }]
          })
          .expect(201);
        return response.body._id as string;
      };

      const orderA = await makeOrder(customerA);
      const orderB = await makeOrder(customerB);
      await deliverWithStock(orderA, [{ productId: products['blanco-chico']!!, quantity: 5 }]);
      await deliverWithStock(orderB, [{ productId: products['blanco-chico']!!, quantity: 5 }]);

      await createReturn(orderA, {
        items: [{ productId: products['blanco-chico']!!, quantity: 2 }],
        reason: 'difference',
        effect: 'reduce_debt'
      }).expect(201);
      await createReturn(orderA, {
        items: [{ productId: products['blanco-chico']!!, quantity: 1 }],
        reason: 'broken',
        effect: 'no_refund'
      }).expect(201);
      await createReturn(orderB, {
        items: [{ productId: products['blanco-chico']!!, quantity: 1 }],
        reason: 'difference',
        effect: 'reduce_debt'
      }).expect(201);

      // Unfiltered
      const all = await request
        .get('/api/v1/returns')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(all.body.total).toBe(3);

      // Filtered by customer + reason
      const customerDoc = await Customer.findById(customerA._id);
      const filtered = await request
        .get(`/api/v1/returns?customerId=${customerA._id}&reason=difference`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(filtered.body.total).toBe(1);
      expect(filtered.body.items[0].reason).toBe('difference');
      expect(filtered.body.items[0].customerId).toBe(customerDoc!._id.toString());
    });

    it('forbids a driver (admin-only) with 403', async () => {
      await request
        .get('/api/v1/returns')
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(403);
    });

    it('returns 401 without a token', async () => {
      await request.get('/api/v1/returns').expect(401);
    });
  });
});