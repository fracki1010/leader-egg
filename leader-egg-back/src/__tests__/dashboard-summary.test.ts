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
import { Payment } from '../modules/payments/model.js';
import { Expense } from '../modules/expenses/model.js';
import { Inventory } from '../modules/inventory/model.js';
import { Product } from '../modules/products/model.js';
import { Return } from '../modules/returns/model.js';
import { CashAdjustment } from '../modules/cash-adjustments/model.js';
import { DailyClose } from '../modules/daily-closes/model.js';
import { BusinessConfig } from '../modules/config/model.js';
import { Purchase } from '../modules/purchases/model.js';
import { CustomerCharge } from '../modules/customer-charges/model.js';

const request = supertest(app);

interface SummaryBody {
  caja: number;
  cajaHoy: number;
  ventasHoy: number;
  cobradoHoy: number;
  ventasPorCanal: Array<{ canal: string; monto: number; ordenes: number }>;
  porCobrar: number;
  clientesDeudores: number;
  vencidas: { count: number; total: number };
  stock: Array<Record<string, unknown>>;
  totalStockValue: number;
  entregasHoy: number;
  pendientesHoy: number;
  deudas: Array<Record<string, unknown>>;
  cierreHoy: { closed: boolean; date: string; difference?: number };
}

const daysAgo = (days: number): Date => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

const orderPayload = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  orderNumber: `ORD-SUM-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  customerId: new Types.ObjectId(),
  customerName: 'Cliente Genérico',
  channel: 'phone',
  items: [{ productId: new Types.ObjectId(), productName: 'Blanco', quantity: 5, unitPrice: 25, subtotal: 125 }],
  totalAmount: 125,
  status: 'delivered',
  paymentStatus: 'unpaid',
  paidAmount: 0,
  balance: 125,
  dueDate: null,
  // Business date mirrors the fixture's capture date so the dashboard's
  // date-based metrics measure the same day as before `orderDate` existed.
  orderDate: overrides.createdAt ?? new Date(),
  ...overrides
});

describe('Dashboard Summary — GET /api/v1/dashboard/summary', () => {
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
      const res = await request.get('/api/v1/dashboard/summary');
      expect(res.status).toBe(401);
    });

    it('returns 200 for admin role', async () => {
      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`);
      // The body names the failure when the flaky 500 shows up in a full run.
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it('returns 200 for driver role (dashboard is the hero screen for both)', async () => {
      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${driverToken}`);
      expect(res.status).toBe(200);
    });
  });

  describe('Empty state', () => {
    it('returns all-zero summary when there is no data', async () => {
      await Inventory.deleteMany({});

      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const body = res.body as SummaryBody;
      expect(body.caja).toBe(0);
      expect(body.cajaHoy).toBe(0);
      expect(body.ventasHoy).toBe(0);
      expect(body.cobradoHoy).toBe(0);
      expect(body.ventasPorCanal).toEqual([]);
      expect(body.porCobrar).toBe(0);
      expect(body.clientesDeudores).toBe(0);
      expect(body.vencidas).toEqual({ count: 0, total: 0 });
      expect(body.stock).toEqual([]);
      expect(body.totalStockValue).toBe(0);
      expect(body.entregasHoy).toBe(0);
      expect(body.pendientesHoy).toBe(0);
      expect(body.deudas).toEqual([]);
      expect(body.cierreHoy.closed).toBe(false);
      expect(body.cierreHoy.difference).toBeUndefined();
    });
  });

  describe('Caja', () => {
    it('caja = total payments received − total expenses (all time)', async () => {
      const customer = await createTestCustomer({ name: 'Pagador' });
      const order = await Order.create(orderPayload({
        customerId: new Types.ObjectId(customer._id as string),
        customerName: 'Pagador',
        paymentStatus: 'paid',
        paidAmount: 500,
        balance: 0
      }));

      await Payment.create([
        { orderId: order._id, amount: 500, method: 'cash', date: new Date() },
        { orderId: order._id, amount: 200, method: 'transfer', date: daysAgo(5) }
      ]);
      await Expense.create([
        { amount: 100, category: 'fuel', date: new Date(), description: 'Combustible hoy', createdBy: 'admin' },
        { amount: 50, category: 'supplies', date: daysAgo(3), description: 'Insumos', createdBy: 'admin' }
      ]);

      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // 700 payments − 150 expenses = 550
      expect(res.body.caja).toBe(550);
    });

    it('cajaHoy only counts payments and expenses from the local calendar day', async () => {
      const customer = await createTestCustomer({ name: 'Pagador Hoy' });
      const order = await Order.create(orderPayload({
        customerId: new Types.ObjectId(customer._id as string),
        customerName: 'Pagador Hoy',
        paymentStatus: 'partial',
        paidAmount: 500,
        balance: 100
      }));

      await Payment.create([
        { orderId: order._id, amount: 500, method: 'cash', date: new Date() },
        { orderId: order._id, amount: 200, method: 'transfer', date: daysAgo(5) }
      ]);
      await Expense.create([
        { amount: 100, category: 'fuel', date: new Date(), description: 'Hoy', createdBy: 'admin' },
        { amount: 50, category: 'other', date: daysAgo(3), description: 'Antes', createdBy: 'admin' }
      ]);

      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Today: 500 payments − 100 expenses = 400 (the 200/50 are excluded)
      expect(res.body.cajaHoy).toBe(400);
      // All-time caja still includes everything: 700 − 150 = 550
      expect(res.body.caja).toBe(550);
    });

    it('subtracts returns refunds from caja and cajaHoy', async () => {
      const customer = await createTestCustomer({ name: 'Devolución' });
      const order = await Order.create(orderPayload({
        customerId: new Types.ObjectId(customer._id as string),
        customerName: 'Devolución',
        totalAmount: 125,
        paymentStatus: 'paid',
        paidAmount: 100,
        balance: 0,
        returnedAmount: 25
      }));

      await Payment.create({ orderId: order._id, amount: 100, method: 'cash', date: new Date() });
      await Expense.create({
        amount: 10,
        category: 'fuel',
        date: new Date(),
        description: 'Combustible',
        createdBy: 'admin'
      });
      await Return.create({
        orderId: order._id,
        customerId: new Types.ObjectId(customer._id as string),
        date: new Date(),
        items: [{
          productId: new Types.ObjectId(),
          productName: 'Blanco',
          quantity: 1,
          unit: 'maple',
          mapleQty: 1,
          unitPrice: 25,
          subtotal: 25
        }],
        returnedAmount: 25,
        refundAmount: 25,
        reason: 'difference',
        effect: 'refund_cash',
        createdBy: 'admin'
      });

      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // caja = 0 opening + 100 payments − 10 expenses − 25 refunds = 65
      expect(res.body.caja).toBe(65);
      expect(res.body.cajaHoy).toBe(65);
    });

    it('adds manual cash adjustments (signed) to saldos, caja and cajaHoy', async () => {
      await CashAdjustment.create([
        { account: 'cash', amount: 500, reason: 'found', date: new Date(), createdBy: new Types.ObjectId() },
        { account: 'mp', amount: -200, reason: 'missing', date: new Date(), createdBy: new Types.ObjectId() }
      ]);

      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.saldos).toEqual({
        efectivo: 500,
        mercadopago: -200,
        banco: 0,
        total: 300
      });
      expect(res.body.caja).toBe(300);
      expect(res.body.cajaHoy).toBe(300);
    });

    it('saldos per account with mixed movements incl. purchase payments; caja = total (R6)', async () => {
      // Opening balances {cash: 1000, mp: 500, bank: 2000}
      await BusinessConfig.create({
        openingCash: 1000,
        openingBalances: { cash: 1000, mp: 500, bank: 2000 }
      });

      const customer = await createTestCustomer({ name: 'Saldo Mixto' });
      const order = await Order.create(orderPayload({
        customerId: new Types.ObjectId(customer._id as string),
        customerName: 'Saldo Mixto',
        paymentStatus: 'paid',
        paidAmount: 100,
        balance: 0
      }));

      // cash payment 100 + mp expense 50 + bank purchase payment 300
      await Payment.create({ orderId: order._id, amount: 100, method: 'cash', account: 'cash', date: new Date() });
      await Expense.create({
        amount: 50,
        category: 'fuel',
        date: new Date(),
        description: 'Nafta desde MP',
        account: 'mp',
        createdBy: 'admin'
      });
      await Purchase.create({
        purchaseNumber: `PUR-SALDO-${Date.now()}`,
        supplierId: new Types.ObjectId(),
        date: new Date(),
        items: [{
          productId: new Types.ObjectId(),
          productName: 'Blanco',
          unit: 'maple',
          quantity: 3,
          quantityMaples: 3,
          unitCost: 100,
          unitCostPerMaple: 100,
          subtotal: 300
        }],
        totalCost: 300,
        status: 'pending',
        paymentMethod: 'check',
        account: 'bank',
        paymentStatus: 'paid',
        paidAmount: 300,
        createdBy: 'admin'
      });

      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.saldos).toEqual({
        efectivo: 1100, // 1000 + 100 cash payment
        mercadopago: 450, // 500 − 50 mp expense
        banco: 1700, // 2000 − 300 bank purchase payment
        total: 3250
      });
      // caja = total — now includes purchase payments (confirmed decision)
      expect(res.body.caja).toBe(3250);
    });

    it('attributes EACH payment line of a split purchase to its own account (not all in one bucket)', async () => {
      // Opening balances all zero → saldos mirror the purchase outflows only.
      await BusinessConfig.create({
        openingCash: 0,
        openingBalances: { cash: 0, mp: 0, bank: 0 }
      });

      const groupId = 'split-group-1';
      await Purchase.create({
        purchaseNumber: `PUR-SPLIT-${Date.now()}`,
        supplierId: new Types.ObjectId(),
        date: new Date(),
        items: [{
          productId: new Types.ObjectId(),
          productName: 'Blanco',
          unit: 'maple',
          quantity: 1,
          quantityMaples: 1,
          unitCost: 100,
          unitCostPerMaple: 100,
          subtotal: 100
        }],
        totalCost: 100,
        status: 'pending',
        // Scalar account mirrors the LAST line (back-compat).
        paymentMethod: 'transfer',
        account: 'mp',
        paymentStatus: 'paid',
        paidAmount: 100,
        payments: [
          { method: 'cash', account: 'cash', amount: 50, date: new Date(), groupId },
          { method: 'transfer', account: 'mp', amount: 50, date: new Date(), groupId }
        ],
        createdBy: 'admin'
      });

      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // cash line → efectivo, MP line → mercadopago. NOT both in one bucket.
      expect(res.body.saldos.efectivo).toBe(-50);
      expect(res.body.saldos.mercadopago).toBe(-50);
      expect(res.body.saldos.banco).toBe(0);
      expect(res.body.caja).toBe(-100);
    });

    it('still attributes a legacy purchase with NO payments array by its scalar account', async () => {
      // Raw insert bypasses schema defaults so `payments` is genuinely absent.
      await Purchase.collection.insertOne({
        purchaseNumber: `PUR-LEGACY-${Date.now()}`,
        supplierId: new Types.ObjectId(),
        date: new Date(),
        items: [{
          productId: new Types.ObjectId(),
          productName: 'Blanco',
          unit: 'maple',
          quantity: 3,
          quantityMaples: 3,
          unitCost: 100,
          unitCostPerMaple: 100,
          subtotal: 300
        }],
        totalCost: 300,
        status: 'pending',
        paymentMethod: 'check',
        account: 'bank',
        paymentStatus: 'paid',
        paidAmount: 300,
        createdBy: 'admin',
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.saldos.banco).toBe(-300);
      expect(res.body.saldos.efectivo).toBe(0);
      expect(res.body.saldos.mercadopago).toBe(0);
      expect(res.body.caja).toBe(-300);
    });

    it('attributes legacy documents by method at aggregation time (R6)', async () => {
      const customer = await createTestCustomer({ name: 'Legacy' });
      const order = await Order.create(orderPayload({
        customerId: new Types.ObjectId(customer._id as string),
        customerName: 'Legacy',
        paymentStatus: 'paid',
        paidAmount: 100,
        balance: 0
      }));

      // Genuinely legacy docs: raw inserts WITHOUT the account field (bypasses
      // schema defaults) — attribution must happen via $ifNull/$switch.
      await Payment.collection.insertOne({
        orderId: order._id,
        amount: 100,
        method: 'transfer',
        date: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      });
      await Expense.collection.insertOne({
        amount: 30,
        category: 'fuel',
        date: new Date(),
        description: 'Gasto legacy',
        createdBy: 'admin',
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // transfer payment → mercadopago; expense (no account) → efectivo
      expect(res.body.saldos.mercadopago).toBe(100);
      expect(res.body.saldos.efectivo).toBe(-30);
      expect(res.body.saldos.total).toBe(70);
      expect(res.body.caja).toBe(70);
    });

    it('cajaHoy includes purchase payments made today', async () => {
      const supplierId = new Types.ObjectId();
      await Purchase.create({
        purchaseNumber: `PUR-HOY-${Date.now()}`,
        supplierId,
        date: new Date(),
        items: [{
          productId: new Types.ObjectId(),
          productName: 'Blanco',
          unit: 'maple',
          quantity: 1,
          quantityMaples: 1,
          unitCost: 100,
          unitCostPerMaple: 100,
          subtotal: 100
        }],
        totalCost: 100,
        status: 'pending',
        paymentMethod: 'cash',
        account: 'cash',
        paymentStatus: 'paid',
        paidAmount: 100,
        createdBy: 'admin'
      });

      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.cajaHoy).toBe(-100);
      expect(res.body.saldos.efectivo).toBe(-100);
      expect(res.body.caja).toBe(-100);
    });
  });

  describe('ventasHoy', () => {
    it('sums totalAmount of today orders excluding cancelled', async () => {
      const customer = await createTestCustomer({ name: 'Comprador' });
      const customerId = new Types.ObjectId(customer._id as string);

      await Order.create([
        orderPayload({ customerId, customerName: 'Comprador', totalAmount: 100, balance: 100 }),
        orderPayload({ customerId, customerName: 'Comprador', totalAmount: 50, status: 'cancelled', balance: 50 }),
        orderPayload({
          customerId,
          customerName: 'Comprador',
          totalAmount: 200,
          balance: 200,
          createdAt: daysAgo(1)
        })
      ]);

      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.ventasHoy).toBe(100);
    });

    it('ventasPorCanal splits today sales by channel and sums to ventasHoy (S8)', async () => {
      const customer = await createTestCustomer({ name: 'Canales' });
      const customerId = new Types.ObjectId(customer._id as string);

      await Order.create([
        // 2 reparto today → 125 + 75 = 200
        orderPayload({ customerId, customerName: 'Canales', totalAmount: 125, balance: 125, salesChannel: 'reparto' }),
        orderPayload({ customerId, customerName: 'Canales', totalAmount: 75, balance: 75, salesChannel: 'reparto' }),
        // 1 puesto today → 50
        orderPayload({ customerId, customerName: 'Canales', totalAmount: 50, balance: 50, salesChannel: 'puesto' }),
        // Cancelled today → excluded
        orderPayload({ customerId, customerName: 'Canales', totalAmount: 300, status: 'cancelled', balance: 300, salesChannel: 'puesto' }),
        // Yesterday → excluded from today's split
        orderPayload({ customerId, customerName: 'Canales', totalAmount: 999, balance: 999, salesChannel: 'whatsapp', createdAt: daysAgo(1) })
      ]);

      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.ventasHoy).toBe(250); // 125 + 75 + 50

      const byChannel = res.body.ventasPorCanal as Array<{ canal: string; monto: number; ordenes: number }>;
      expect(byChannel).toHaveLength(2);

      const reparto = byChannel.find((b) => b.canal === 'reparto');
      const puesto = byChannel.find((b) => b.canal === 'puesto');
      expect(reparto).toEqual({ canal: 'reparto', monto: 200, ordenes: 2 });
      expect(puesto).toEqual({ canal: 'puesto', monto: 50, ordenes: 1 });

      // Σ ventasPorCanal.monto == ventasHoy exactly
      const sum = byChannel.reduce((acc, b) => acc + b.monto, 0);
      expect(sum).toBe(res.body.ventasHoy);
    });
  });

  describe('cobradoHoy', () => {
    it('sums today payments only (GROSS), leaving ventasHoy/cajaHoy semantics intact', async () => {
      const customer = await createTestCustomer({ name: 'Cobrador' });
      const order = await Order.create(orderPayload({
        customerId: new Types.ObjectId(customer._id as string),
        customerName: 'Cobrador',
        totalAmount: 500,
        paymentStatus: 'partial',
        paidAmount: 500,
        balance: 0
      }));

      await Payment.create([
        { orderId: order._id, amount: 300, method: 'cash', date: new Date() },
        { orderId: order._id, amount: 200, method: 'transfer', date: daysAgo(1) }
      ]);

      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Only today's 300 counts — yesterday's 200 is excluded.
      expect(res.body.cobradoHoy).toBe(300);
      // Untouched metrics: ventasHoy = order created today (500),
      // cajaHoy = NET today = 300 payments − 0 other movements.
      expect(res.body.ventasHoy).toBe(500);
      expect(res.body.cajaHoy).toBe(300);
    });

    it('reports GROSS collections even when expenses make cajaHoy net smaller', async () => {
      const customer = await createTestCustomer({ name: 'Cobrador Neto' });
      const order = await Order.create(orderPayload({
        customerId: new Types.ObjectId(customer._id as string),
        customerName: 'Cobrador Neto',
        totalAmount: 500,
        paymentStatus: 'partial',
        paidAmount: 200,
        balance: 300
      }));

      await Payment.create({ orderId: order._id, amount: 200, method: 'cash', date: new Date() });
      await Expense.create({
        amount: 50,
        category: 'fuel',
        date: new Date(),
        description: 'Combustible',
        createdBy: 'admin'
      });

      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // GROSS collections stay 200; cajaHoy is NET → 200 − 50 = 150.
      expect(res.body.cobradoHoy).toBe(200);
      expect(res.body.cajaHoy).toBe(150);
    });
  });

  describe('porCobrar / clientesDeudores', () => {
    it('sums balance across non-cancelled orders and counts distinct debtor customers', async () => {
      const customerA = await createTestCustomer({ name: 'Deudor A' });
      const customerB = await createTestCustomer({ name: 'Deudor B' });
      const customerC = await createTestCustomer({ name: 'Al Día' });
      const idA = new Types.ObjectId(customerA._id as string);
      const idB = new Types.ObjectId(customerB._id as string);
      const idC = new Types.ObjectId(customerC._id as string);

      await Order.create([
        // A: two orders with balance → 125 + 200 = 325
        orderPayload({ customerId: idA, customerName: 'Deudor A', totalAmount: 125, balance: 125 }),
        orderPayload({ customerId: idA, customerName: 'Deudor A', totalAmount: 250, paymentStatus: 'partial', paidAmount: 50, balance: 200 }),
        // B: one order with balance → 75
        orderPayload({ customerId: idB, customerName: 'Deudor B', totalAmount: 75, balance: 75 }),
        // C: paid → balance 0, must not count as debtor
        orderPayload({ customerId: idC, customerName: 'Al Día', totalAmount: 999, paymentStatus: 'paid', paidAmount: 999, balance: 0 }),
        // Cancelled with balance → excluded from both totals
        orderPayload({ customerId: idB, customerName: 'Deudor B', totalAmount: 500, status: 'cancelled', balance: 500 })
      ]);

      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.porCobrar).toBe(400); // 325 + 75
      expect(res.body.clientesDeudores).toBe(2); // A and B, not C
    });

    it('includes the net manual charge term (charges − credits)', async () => {
      const customer = await createTestCustomer({ name: 'Con Cargo Manual' });
      const customerId = new Types.ObjectId(customer._id as string);

      await Order.create(orderPayload({
        customerId,
        customerName: 'Con Cargo Manual',
        totalAmount: 3000,
        balance: 3000
      }));

      await CustomerCharge.create([
        { customerId, type: 'charge', amount: 2000, reason: 'manual_debt', source: 'manual', createdBy: new Types.ObjectId() },
        { customerId, type: 'credit', amount: 500, reason: 'forgiveness', source: 'manual', createdBy: new Types.ObjectId() }
      ]);

      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // 3000 order + 2000 charge − 500 credit = 4500
      expect(res.body.porCobrar).toBe(4500);
      expect(res.body.clientesDeudores).toBe(1);
    });

    it('counts a charge-only customer (no orders) as a debtor and lists it in deudas', async () => {
      const customer = await createTestCustomer({ name: 'Solo Manual Dashboard' });
      const customerId = new Types.ObjectId(customer._id as string);

      await CustomerCharge.create({
        customerId,
        type: 'charge',
        amount: 5000,
        reason: 'manual_debt',
        source: 'manual',
        createdBy: new Types.ObjectId()
      });

      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.porCobrar).toBe(5000);
      expect(res.body.clientesDeudores).toBe(1);

      const deudas = res.body.deudas as Array<Record<string, unknown>>;
      const deuda = deudas.find((d) => d.customerId === customerId.toString());
      expect(deuda).toMatchObject({ totalDebt: 5000, ordersCount: 0 });
    });
  });

  describe('vencidas', () => {
    it('counts overdue unpaid orders and totals their balance', async () => {
      const customer = await createTestCustomer({ name: 'Moroso' });
      const customerId = new Types.ObjectId(customer._id as string);

      await Order.create([
        // Overdue + unpaid → counts (125)
        orderPayload({ customerId, customerName: 'Moroso', totalAmount: 125, balance: 125, dueDate: daysAgo(10) }),
        // Overdue + paid → excluded
        orderPayload({ customerId, customerName: 'Moroso', totalAmount: 200, paymentStatus: 'paid', paidAmount: 200, balance: 0, dueDate: daysAgo(5) }),
        // Not due yet → excluded
        orderPayload({ customerId, customerName: 'Moroso', totalAmount: 300, balance: 300, dueDate: daysAgo(-5) }),
        // Overdue + cancelled → excluded
        orderPayload({ customerId, customerName: 'Moroso', totalAmount: 400, status: 'cancelled', balance: 400, dueDate: daysAgo(3) })
      ]);

      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.vencidas).toEqual({ count: 1, total: 125 });
    });
  });

  describe('deudas', () => {
    it('groups debts by customer, joins names, sorts by totalDebt desc', async () => {
      const customerA = await createTestCustomer({ name: 'Cliente Moroso A' });
      const customerB = await createTestCustomer({ name: 'Cliente Moroso B' });
      const idA = new Types.ObjectId(customerA._id as string);
      const idB = new Types.ObjectId(customerB._id as string);

      await Order.create([
        orderPayload({ customerId: idB, customerName: 'Cliente Moroso B', totalAmount: 75, balance: 75, dueDate: daysAgo(3) }),
        orderPayload({ customerId: idA, customerName: 'Cliente Moroso A', totalAmount: 125, balance: 125, dueDate: daysAgo(10) }),
        orderPayload({ customerId: idA, customerName: 'Cliente Moroso A', totalAmount: 250, paymentStatus: 'partial', paidAmount: 50, balance: 200, dueDate: daysAgo(5) }),
        // Paid order must not appear in the debt list
        orderPayload({ customerId: idA, customerName: 'Cliente Moroso A', totalAmount: 999, paymentStatus: 'paid', paidAmount: 999, balance: 0, dueDate: daysAgo(1) })
      ]);

      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const deudas = res.body.deudas as Array<Record<string, unknown>>;
      expect(deudas).toHaveLength(2);

      // A first: 325 total over 2 orders, max 10 days overdue
      expect(deudas[0]).toMatchObject({
        customerId: idA.toString(),
        customerName: 'Cliente Moroso A',
        totalDebt: 325,
        ordersCount: 2,
        maxDaysOverdue: 10
      });

      // B second: 75 over 1 order, max 3 days overdue
      expect(deudas[1]).toMatchObject({
        customerId: idB.toString(),
        customerName: 'Cliente Moroso B',
        totalDebt: 75,
        ordersCount: 1,
        maxDaysOverdue: 3
      });
    });

    it('caps the debt list at 20 customers', async () => {
      for (let i = 0; i < 21; i++) {
        const customer = await createTestCustomer({ name: `Deudor ${i}` });
        await Order.create(orderPayload({
          customerId: new Types.ObjectId(customer._id as string),
          customerName: `Deudor ${i}`,
          totalAmount: 10,
          balance: 10
        }));
      }

      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.deudas).toHaveLength(20);
      // Count of distinct debtors is still the real total (21)
      expect(res.body.clientesDeudores).toBe(21);
    });

    it('includes openingDebt-only customers and keeps porCobrar equal to the deudas sum', async () => {
      const openingCustomer = await createTestCustomer({ name: 'Deuda Inicial', openingDebt: 750 });
      const orderCustomer = await createTestCustomer({ name: 'Deuda Pedido' });
      await Order.create(orderPayload({
        customerId: new Types.ObjectId(orderCustomer._id as string),
        customerName: 'Deuda Pedido',
        totalAmount: 125,
        balance: 125
      }));

      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // 750 openingDebt + 125 order balance = 875, each counted once.
      expect(res.body.porCobrar).toBe(875);
      expect(res.body.clientesDeudores).toBe(2);

      const deudas = res.body.deudas as Array<Record<string, unknown>>;
      const openingDebtRow = deudas.find((d) => d.customerId === String(openingCustomer._id));
      expect(openingDebtRow).toMatchObject({
        customerName: 'Deuda Inicial',
        totalDebt: 750,
        ordersCount: 0
      });

      const deudasSum = deudas.reduce((sum, d) => sum + (d.totalDebt as number), 0);
      expect(deudasSum).toBe(res.body.porCobrar);
    });
  });

  describe('stock', () => {
    it('computes stockValue = quantity × costPrice and totalStockValue', async () => {
      await Product.findOneAndUpdate({ variety: 'blanco', caliber: 'chico' }, { costPrice: 18.50 });
      await Product.findOneAndUpdate({ variety: 'castaño', caliber: 'chico' }, { costPrice: 16.00 });
      await Product.findOneAndUpdate({ variety: 'blanco', caliber: 'grande' }, { costPrice: 20.00 });

      await Inventory.findOneAndUpdate(
        { productId: productIds['blanco-chico'] },
        { productId: new Types.ObjectId(productIds['blanco-chico']), quantity: 100, lastUpdated: new Date() },
        { upsert: true }
      );
      await Inventory.findOneAndUpdate(
        { productId: productIds['castaño-chico'] },
        { productId: new Types.ObjectId(productIds['castaño-chico']), quantity: 5, lastUpdated: new Date() },
        { upsert: true }
      );
      await Inventory.findOneAndUpdate(
        { productId: productIds['blanco-grande'] },
        { productId: new Types.ObjectId(productIds['blanco-grande']), quantity: 50, lastUpdated: new Date() },
        { upsert: true }
      );

      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const stock = res.body.stock as Array<Record<string, unknown>>;
      expect(stock).toHaveLength(6);

      const blanco = stock.find((s) => s.variety === 'blanco' && s.caliber === 'chico');
      expect(blanco).toMatchObject({
        productId: productIds['blanco-chico'],
        quantity: 100,
        threshold: 20,
        costPrice: 18.5,
        stockValue: 1850
      });

      const castano = stock.find((s) => s.variety === 'castaño' && s.caliber === 'chico');
      expect(castano).toMatchObject({ quantity: 5, threshold: 20, costPrice: 16, stockValue: 80 });

      // 1850 + 80 + 1000 = 2930
      expect(res.body.totalStockValue).toBe(2930);
    });

    it('treats products without costPrice as zero stock value', async () => {
      // seedProducts leaves costPrice null
      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.stock).toHaveLength(6);
      expect(res.body.totalStockValue).toBe(0);
      for (const item of res.body.stock as Array<Record<string, unknown>>) {
        expect(item.stockValue).toBe(0);
        expect(item.costPrice).toBeNull();
      }
    });
  });

  describe('entregasHoy / pendientesHoy', () => {
    it('counts delivered today and pending/assigned created today', async () => {
      const customer = await createTestCustomer({ name: 'Repartos' });
      const customerId = new Types.ObjectId(customer._id as string);

      await Order.create([
        orderPayload({ customerId, customerName: 'Repartos', status: 'delivered', totalAmount: 100, balance: 100 }),
        orderPayload({ customerId, customerName: 'Repartos', status: 'delivered', totalAmount: 100, balance: 100, createdAt: daysAgo(1) }),
        orderPayload({ customerId, customerName: 'Repartos', status: 'pending', totalAmount: 100, balance: 100 }),
        orderPayload({ customerId, customerName: 'Repartos', status: 'assigned', totalAmount: 100, balance: 100 }),
        orderPayload({ customerId, customerName: 'Repartos', status: 'cancelled', totalAmount: 100, balance: 100 }),
        orderPayload({ customerId, customerName: 'Repartos', status: 'in_transit', totalAmount: 100, balance: 100 })
      ]);

      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.entregasHoy).toBe(1);
      expect(res.body.pendientesHoy).toBe(2); // pending + assigned
    });
  });

  describe('cierreHoy', () => {
    it('reports closed with the difference when today has a close (S12)', async () => {
      const today = new Date();
      const localMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);

      await DailyClose.create({
        date: localMidnight,
        systemCash: 70,
        countedCash: 80,
        difference: 10,
        summary: {},
        closedBy: 'admin'
      });

      const res = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const body = res.body as SummaryBody;
      expect(body.cierreHoy.closed).toBe(true);
      expect(body.cierreHoy.difference).toBe(10);
      expect(body.cierreHoy.date).toBe(
        `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      );
    });
  });
});