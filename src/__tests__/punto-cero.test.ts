import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { Types } from 'mongoose';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  seedDriverUser,
  seedSuperAdminUser,
  seedProducts,
  loginAs,
  createTestCustomer,
  getProductIds
} from './helpers.js';
import { app } from '../app.js';
import { Inventory } from '../modules/inventory/model.js';
import { StockTransaction } from '../modules/inventory/transaction-model.js';
import { BusinessConfig } from '../modules/config/model.js';
import { Customer } from '../modules/customers/model.js';
import { Supplier } from '../modules/suppliers/model.js';
import { Product } from '../modules/products/model.js';
import { Order } from '../modules/orders/model.js';
import { Payment } from '../modules/payments/model.js';
import { Expense } from '../modules/expenses/model.js';

const request = supertest(app);

const orderPayload = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  orderNumber: `ORD-PC-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
  ...overrides
});

describe('Punto Cero — /api/v1/setup/punto-cero', () => {
  let superToken: string;
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
    const superadmin = await seedSuperAdminUser();
    superToken = await loginAs(request, superadmin.email, superadmin.password);
    adminToken = await loginAs(request, admin.email, admin.password);
    driverToken = await loginAs(request, driver.email, driver.password);
  });

  const postSetup = (body: Record<string, unknown>, token: string = superToken) =>
    request.post('/api/v1/setup/punto-cero').set('Authorization', `Bearer ${token}`).send(body);

  describe('Auth guard', () => {
    it('returns 401 without token', async () => {
      await request.get('/api/v1/setup/punto-cero').expect(401);
      await request.post('/api/v1/setup/punto-cero').send({}).expect(401);
    });

    it('returns 403 for driver (admin-only setup)', async () => {
      await request
        .get('/api/v1/setup/punto-cero')
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(403);
    });

    it('allows admin on GET and POST (Punto Cero gate is admin)', async () => {
      await request
        .get('/api/v1/setup/punto-cero')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      await request
        .post('/api/v1/setup/punto-cero')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ openingCash: 1 })
        .expect(200);
    });

    it('allows superadmin on GET and POST', async () => {
      await request
        .get('/api/v1/setup/punto-cero')
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200);
      await postSetup({ openingCash: 1 }).expect(200);
    });
  });

  describe('GET default state', () => {
    it('returns unfinalized with zeroed opening cash and empty lists before any POST', async () => {
      // seedProducts pre-creates inventory records — clear them so the
      // default state truly has no stock (mirrors the dashboard empty test).
      await Inventory.deleteMany({});

      const res = await request
        .get('/api/v1/setup/punto-cero')
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200);

      expect(res.body).toEqual({
        finalized: false,
        openingCash: 0,
        openingBalances: { cash: 0, mp: 0, bank: 0 },
        openingBalancesSetAt: { cash: null, mp: null, bank: null },
        clientDebts: [],
        supplierDebts: [],
        stock: []
      });
    });
  });

  describe('POST initialize', () => {
    it('upserts stock, logs opening transactions, persists cash + debts and finalizes', async () => {
      const customer = await createTestCustomer({ name: 'Cliente Inicial' });
      const supplier = await Supplier.create({ name: 'Proveedor Inicial' });
      const customerId = String(customer._id);

      const res = await postSetup({
        stock: [
          { productId: productIds['blanco-chico'], quantity: 150 },
          { productId: productIds['castaño-chico'], quantity: 40 }
        ],
        openingCash: 50000,
        clientDebts: [{ customerId, amount: 25000 }],
        supplierDebts: [{ supplierId: supplier._id, amount: 10000 }]
      }).expect(200);

      expect(res.body.finalized).toBe(true);
      expect(res.body.openingCash).toBe(50000);
      expect(res.body.clientDebts).toEqual([
        { customerId, name: 'Cliente Inicial', amount: 25000 }
      ]);
      expect(res.body.supplierDebts).toEqual([
        { supplierId: supplier._id.toString(), name: 'Proveedor Inicial', amount: 10000 }
      ]);

      // Inventory quantities upserted (seed had 100 each)
      const blanco = await Inventory.findOne({ productId: productIds['blanco-chico'] });
      const castano = await Inventory.findOne({ productId: productIds['castaño-chico'] });
      const grande = await Inventory.findOne({ productId: productIds['blanco-grande'] });
      expect(blanco!.quantity).toBe(150);
      expect(castano!.quantity).toBe(40);
      // Products not listed in stock keep their previous quantity
      expect(grande!.quantity).toBe(100);

      // One 'opening' transaction per stock item, quantity = final quantity
      const openingTxns = await StockTransaction.find({ type: 'opening' }).sort({ productId: 1 });
      expect(openingTxns).toHaveLength(2);
      const blancoTxn = openingTxns.find((t) => t.productId.toString() === productIds['blanco-chico']);
      expect(blancoTxn!.quantity).toBe(150);
      expect(blancoTxn!.notes).toBe('Punto cero');
      expect(blancoTxn!.createdBy).toBeDefined();

      // Persisted debts + finalized timestamp
      const customerDoc = await Customer.findById(customerId);
      const supplierDoc = await Supplier.findById(supplier._id);
      expect(customerDoc!.openingDebt).toBe(25000);
      expect(supplierDoc!.openingDebt).toBe(10000);
      const config = await BusinessConfig.findOne();
      expect(config!.puntoCeroFinalized).toBe(true);
      expect(config!.puntoCeroFinalizedAt).toBeInstanceOf(Date);

      // GET reflects the persisted values
      const getRes = await request
        .get('/api/v1/setup/punto-cero')
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200);
      expect(getRes.body.finalized).toBe(true);
      expect(getRes.body.openingCash).toBe(50000);
      expect(getRes.body.stock).toEqual(
        expect.arrayContaining([
          { productId: productIds['blanco-chico'], name: 'Blanco Chico', quantity: 150 }
        ])
      );
    });

    it('partial body defaults openingCash and debts to zero and still finalizes', async () => {
      const res = await postSetup({
        stock: [{ productId: productIds['blanco-chico'], quantity: 10 }]
      }).expect(200);

      expect(res.body.finalized).toBe(true);
      expect(res.body.openingCash).toBe(0);
      expect(res.body.openingBalances).toEqual({ cash: 0, mp: 0, bank: 0 });
      expect(res.body.clientDebts).toEqual([]);
      expect(res.body.supplierDebts).toEqual([]);

      const openingTxns = await StockTransaction.find({ type: 'opening' });
      expect(openingTxns).toHaveLength(1);
    });

    it('persists openingBalances per account and syncs openingCash (R5)', async () => {
      const res = await postSetup({
        openingBalances: { cash: 1000, mp: 500, bank: 2000 }
      }).expect(200);

      expect(res.body.openingBalances).toEqual({ cash: 1000, mp: 500, bank: 2000 });
      expect(res.body.openingCash).toBe(1000); // cash alias kept in sync

      const config = await BusinessConfig.findOne();
      expect(config!.openingBalances).toMatchObject({ cash: 1000, mp: 500, bank: 2000 });
      expect(config!.openingCash).toBe(1000);

      // GET reflects the persisted balances
      const getRes = await request
        .get('/api/v1/setup/punto-cero')
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200);
      expect(getRes.body.openingBalances).toEqual({ cash: 1000, mp: 500, bank: 2000 });
    });

    it('legacy openingCash sets cash and zeros mp/bank (backward compat R5)', async () => {
      const res = await postSetup({ openingCash: 1000 }).expect(200);

      expect(res.body.openingBalances).toEqual({ cash: 1000, mp: 0, bank: 0 });
      expect(res.body.openingCash).toBe(1000);

      const config = await BusinessConfig.findOne();
      expect(config!.openingBalances).toMatchObject({ cash: 1000, mp: 0, bank: 0 });
    });

    it('rejects negative openingBalances values', async () => {
      await postSetup({ openingBalances: { cash: -1 } }).expect(400);
      await postSetup({ openingBalances: { mp: -5 } }).expect(400);
      await postSetup({ openingBalances: { bank: -5 } }).expect(400);
    });
  });

  describe('Re-POST after finalize', () => {
    it('returns 409 and leaves everything unchanged', async () => {
      await postSetup({ openingCash: 50000 }).expect(200);

      const res = await postSetup({ openingCash: 999 }).expect(409);
      expect(res.body.error).toBe('Punto cero ya fue finalizado');

      const config = await BusinessConfig.findOne();
      expect(config!.openingCash).toBe(50000);
      expect(config!.puntoCeroFinalized).toBe(true);
    });
  });

  describe('Validation', () => {
    it('returns 404 for an unknown product and persists nothing', async () => {
      const customer = await createTestCustomer({ name: 'No Persistir' });
      const fakeProductId = new Types.ObjectId().toString();

      const res = await postSetup({
        stock: [{ productId: fakeProductId, quantity: 10 }],
        openingCash: 50000,
        clientDebts: [{ customerId: customer._id, amount: 100 }]
      }).expect(404);
      expect(res.body.error).toBe('Product not found');

      // The singleton config doc is created lazily by getOrCreate — the
      // failed POST must leave it unfinalized with zeroed cash and no writes.
      const config = await BusinessConfig.findOne();
      expect(config).not.toBeNull();
      expect(config!.puntoCeroFinalized).toBe(false);
      expect(config!.openingCash).toBe(0);
      expect(await StockTransaction.countDocuments()).toBe(0);
      const customerDoc = await Customer.findById(customer._id);
      expect(customerDoc!.openingDebt).toBe(0);
    });

    it('returns 404 for an unknown customer', async () => {
      const res = await postSetup({
        clientDebts: [{ customerId: new Types.ObjectId().toString(), amount: 100 }]
      }).expect(404);
      expect(res.body.error).toBe('Customer not found');
    });

    it('returns 404 for an unknown supplier', async () => {
      const res = await postSetup({
        supplierDebts: [{ supplierId: new Types.ObjectId().toString(), amount: 100 }]
      }).expect(404);
      expect(res.body.error).toBe('Supplier not found');
    });

    it('returns 400 for negative openingCash', async () => {
      await postSetup({ openingCash: -1 }).expect(400);
    });

    it('returns 400 for zero/negative stock quantity', async () => {
      await postSetup({ stock: [{ productId: productIds['blanco-chico'], quantity: 0 }] }).expect(400);
      await postSetup({ stock: [{ productId: productIds['blanco-chico'], quantity: -5 }] }).expect(400);
    });

    it('returns 400 for zero/negative debt amounts', async () => {
      const customer = await createTestCustomer();
      const supplier = await Supplier.create({ name: 'Proveedor P' });
      await postSetup({ clientDebts: [{ customerId: customer._id as string, amount: 0 }] }).expect(400);
      await postSetup({ clientDebts: [{ customerId: customer._id as string, amount: -10 }] }).expect(400);
      await postSetup({ supplierDebts: [{ supplierId: supplier._id, amount: 0 }] }).expect(400);
    });
  });

  describe('PATCH /v1/setup/opening-balances', () => {
    const patchBalances = (body: Record<string, unknown>, token: string = superToken) =>
      request.patch('/api/v1/setup/opening-balances').set('Authorization', `Bearer ${token}`).send(body);

    it('updates only the provided accounts, leaving the rest untouched', async () => {
      // mp starts at 0 (unlocked) so the later mp edit is not a locked change.
      await postSetup({ openingBalances: { cash: 1000, mp: 0, bank: 2000 } }).expect(200);

      const res = await patchBalances({ mp: 5000 }).expect(200);

      expect(res.body.openingBalances).toEqual({ cash: 1000, mp: 5000, bank: 2000 });
      // cash alias untouched when cash is not provided
      expect(res.body.openingCash).toBe(1000);

      const config = await BusinessConfig.findOne();
      expect(config!.openingBalances).toMatchObject({ cash: 1000, mp: 5000, bank: 2000 });
      expect(config!.openingCash).toBe(1000);
    });

    it('keeps openingCash in sync when cash (the alias) is provided', async () => {
      // Cash starts at 0 (unlocked) so this test loads it for the first time.
      await postSetup({ openingBalances: { mp: 500, bank: 2000 } }).expect(200);

      const res = await patchBalances({ cash: 7777 }).expect(200);

      expect(res.body.openingBalances).toEqual({ cash: 7777, mp: 500, bank: 2000 });
      expect(res.body.openingCash).toBe(7777); // alias synced

      const config = await BusinessConfig.findOne();
      expect(config!.openingBalances).toMatchObject({ cash: 7777, mp: 500, bank: 2000 });
      expect(config!.openingCash).toBe(7777);
    });

    it('works after punto cero is finalized and does not clear the flag', async () => {
      await postSetup({ openingBalances: { cash: 1000 } }).expect(200);
      const before = await BusinessConfig.findOne();
      expect(before!.puntoCeroFinalized).toBe(true);
      const finalizedAt = before!.puntoCeroFinalizedAt;

      const res = await patchBalances({ bank: 300 }).expect(200);

      expect(res.body.finalized).toBe(true);
      expect(res.body.openingBalances).toEqual({ cash: 1000, mp: 0, bank: 300 });

      const config = await BusinessConfig.findOne();
      expect(config!.puntoCeroFinalized).toBe(true);
      expect(config!.puntoCeroFinalizedAt!.getTime()).toBe(finalizedAt!.getTime());
    });

    it('allows 0 but rejects negative values and an empty body', async () => {
      // No prior load → every account is still editable.
      // 0 is valid and does NOT lock the account.
      const zeroed = await patchBalances({ cash: 0 }).expect(200);
      expect(zeroed.body.openingBalances).toEqual({ cash: 0, mp: 0, bank: 0 });
      expect(zeroed.body.openingBalancesSetAt.cash).toBeNull();
      expect(zeroed.body.openingCash).toBe(0);

      // negatives rejected per account
      await patchBalances({ cash: -1 }).expect(400);
      await patchBalances({ mp: -5 }).expect(400);
      await patchBalances({ bank: -0.01 }).expect(400);

      // empty body is a no-op → 400
      const empty = await patchBalances({}).expect(400);
      expect(empty.body.error).toContain('At least one account');
    });

    it('returns 401 without token and 403 for non-admin, 200 for admin', async () => {
      await request.patch('/api/v1/setup/opening-balances').send({ cash: 1 }).expect(401);
      await patchBalances({ cash: 1 }, driverToken).expect(403);
      await patchBalances({ cash: 1 }, adminToken).expect(200);
    });

    it('dashboard saldos and cash summary reflect the corrected opening balances', async () => {
      // mp starts at 0 (unlocked); this test loads it with 1500 below.
      await postSetup({ openingBalances: { cash: 1000, mp: 0, bank: 2000 } }).expect(200);

      // Load mp 0 → 1500. No movements exist, so saldos mirror the opening
      // balances exactly.
      await patchBalances({ mp: 1500 }).expect(200);

      const dashboard = await request
        .get('/api/v1/dashboard/summary')
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200);
      expect(dashboard.body.saldos).toEqual({
        efectivo: 1000,
        mercadopago: 1500,
        banco: 2000,
        total: 4500
      });

      const cash = await request
        .get('/api/v1/cash/summary')
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200);
      expect(cash.body.accounts).toEqual({ cash: 1000, mp: 1500, bank: 2000, total: 4500 });
    });
  });

  describe('One-time opening-balance lock', () => {
    const patchBalances = (body: Record<string, unknown>) =>
      request
        .patch('/api/v1/setup/opening-balances')
        .set('Authorization', `Bearer ${superToken}`)
        .send(body);

    const ISO_PREFIX = /^\d{4}-\d{2}-\d{2}T/;
    const DMY_DATE = /cargado el \d{2}\/\d{2}\/\d{4}/;

    it('locks cash on the first positive save, allows the same value and rejects a different one', async () => {
      const first = await patchBalances({ cash: 1000 }).expect(200);
      expect(first.body.openingBalancesSetAt.cash).toMatch(ISO_PREFIX);
      expect(first.body.openingBalancesSetAt.mp).toBeNull();
      expect(first.body.openingBalancesSetAt.bank).toBeNull();

      // Idempotent re-save (double submit) keeps the original lock timestamp.
      const same = await patchBalances({ cash: 1000 }).expect(200);
      expect(same.body.openingBalances.cash).toBe(1000);
      expect(same.body.openingBalancesSetAt.cash).toBe(first.body.openingBalancesSetAt.cash);

      const conflict = await patchBalances({ cash: 2000 }).expect(409);
      expect(conflict.body.error).toContain('Efectivo');
      expect(conflict.body.error).toMatch(DMY_DATE);

      const config = await BusinessConfig.findOne();
      expect(config!.openingBalances!.cash).toBe(1000);
      expect(config!.openingBalancesSetAt.cash).toBeInstanceOf(Date);
    });

    it('keeps other accounts editable and does not lock a zero save', async () => {
      await patchBalances({ cash: 1000 }).expect(200);

      // cash is locked, mp is still editable.
      const mpZero = await patchBalances({ mp: 0 }).expect(200);
      expect(mpZero.body.openingBalancesSetAt.mp).toBeNull();

      const mpLoaded = await patchBalances({ mp: 500 }).expect(200);
      expect(mpLoaded.body.openingBalances.mp).toBe(500);
      expect(mpLoaded.body.openingBalancesSetAt.mp).toMatch(ISO_PREFIX);

      // Once mp is loaded it follows the same rule; cash is untouched.
      const mpConflict = await patchBalances({ mp: 900 }).expect(409);
      expect(mpConflict.body.error).toContain('Mercado Pago');
      expect(mpLoaded.body.openingBalances.cash).toBe(1000);
    });

    it('setPuntoCero locks the positive balances it writes and rejects a later change without force', async () => {
      // Load cash through the Caja endpoint first → it is already locked.
      await patchBalances({ cash: 1000 }).expect(200);

      // Setup cannot change the locked cash account (config is not finalized yet,
      // so this is the lock gate, not the one-time finalize gate).
      const conflict = await postSetup({
        openingBalances: { cash: 2000, mp: 500 }
      }).expect(409);
      expect(conflict.body.error).toContain('Efectivo');
      expect(conflict.body.error).toMatch(DMY_DATE);

      // Same cash + new mp → succeeds and locks every positive written account.
      const res = await postSetup({
        openingBalances: { cash: 1000, mp: 500, bank: 0 }
      }).expect(200);

      expect(res.body.finalized).toBe(true);
      expect(res.body.openingBalancesSetAt.cash).toMatch(ISO_PREFIX);
      expect(res.body.openingBalancesSetAt.mp).toMatch(ISO_PREFIX);
      expect(res.body.openingBalancesSetAt.bank).toBeNull();

      const config = await BusinessConfig.findOne();
      expect(config!.openingBalancesSetAt.cash).toBeInstanceOf(Date);
      expect(config!.openingBalancesSetAt.mp).toBeInstanceOf(Date);
      expect(config!.openingBalancesSetAt.bank).toBeNull();
    });

    it('GET /v1/setup/punto-cero exposes openingBalancesSetAt per account', async () => {
      await patchBalances({ cash: 1000 }).expect(200);

      const res = await request
        .get('/api/v1/setup/punto-cero')
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200);

      expect(res.body.openingBalancesSetAt.cash).toMatch(ISO_PREFIX);
      expect(res.body.openingBalancesSetAt.mp).toBeNull();
      expect(res.body.openingBalancesSetAt.bank).toBeNull();
    });
  });
});

describe('Punto Cero — dashboard + accounts integration', () => {
  let superToken: string;
  let productIds: Record<string, string>;

  beforeAll(async () => { await startTestDatabase(); });
  afterAll(async () => { await stopTestDatabase(); });

  beforeEach(async () => {
    await clearDatabase();
    await seedProducts();
    productIds = await getProductIds();
    const superadmin = await seedSuperAdminUser();
    superToken = await loginAs(request, superadmin.email, superadmin.password);
  });

  it('dashboard caja = openingCash + payments − expenses', async () => {
    await request
      .post('/api/v1/setup/punto-cero')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ openingCash: 50000 })
      .expect(200);

    const customer = await createTestCustomer({ name: 'Pagador' });
    const order = await Order.create(orderPayload({
      customerId: new Types.ObjectId(customer._id as string),
      customerName: 'Pagador',
      paymentStatus: 'paid',
      paidAmount: 10000,
      balance: 0
    }));
    await Payment.create({ orderId: order._id, amount: 10000, method: 'cash', date: new Date() });
    await Expense.create({ amount: 3000, category: 'fuel', date: new Date(), description: 'Combustible', createdBy: 'admin' });

    const res = await request
      .get('/api/v1/dashboard/summary')
      .set('Authorization', `Bearer ${superToken}`)
      .expect(200);

    expect(res.body.caja).toBe(57000); // 50000 + 10000 − 3000
    expect(res.body.puntoCeroFinalized).toBe(true);
  });

  it('dashboard porCobrar includes openingDebt and exposes puntoCeroFinalized=false before setup', async () => {
    // Before setup: not finalized
    const before = await request
      .get('/api/v1/dashboard/summary')
      .set('Authorization', `Bearer ${superToken}`)
      .expect(200);
    expect(before.body.puntoCeroFinalized).toBe(false);

    const customer = await createTestCustomer({ name: 'Deudor Inicial' });
    await request
      .post('/api/v1/setup/punto-cero')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ clientDebts: [{ customerId: customer._id, amount: 50000 }] })
      .expect(200);

    await Order.create(orderPayload({
      customerId: new Types.ObjectId(customer._id as string),
      customerName: 'Deudor Inicial',
      totalAmount: 30000,
      balance: 30000
    }));

    const res = await request
      .get('/api/v1/dashboard/summary')
      .set('Authorization', `Bearer ${superToken}`)
      .expect(200);

    expect(res.body.porCobrar).toBe(80000); // 50000 openingDebt + 30000 order balance
    expect(res.body.clientesDeudores).toBe(1);
  });

  it('accounts outstandingBalance includes openingDebt and ledger shows the opening movement', async () => {
    const customer = await createTestCustomer({ name: 'Cuenta Inicial' });
    const customerId = String(customer._id);

    await request
      .post('/api/v1/setup/punto-cero')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ clientDebts: [{ customerId, amount: 50000 }] })
      .expect(200);

    await Order.create(orderPayload({
      customerId: new Types.ObjectId(customerId),
      customerName: 'Cuenta Inicial',
      orderNumber: 'ORD-PC-LEDGER',
      totalAmount: 30000,
      balance: 30000
    }));

    // Account list row: 30000 order balance + 50000 openingDebt = 80000
    const listRes = await request
      .get('/api/v1/accounts')
      .set('Authorization', `Bearer ${superToken}`)
      .expect(200);
    const row = (listRes.body.items as Array<Record<string, unknown>>).find(
      (r) => r.customerId === customerId
    );
    expect(row).toBeDefined();
    expect(row!.outstandingBalance).toBe(80000);

    // Movement ledger: opening entry present with the right amount/sign
    const movementsRes = await request
      .get(`/api/v1/accounts/${customerId}/movements`)
      .set('Authorization', `Bearer ${superToken}`)
      .expect(200);

    expect(movementsRes.body.summary.outstandingBalance).toBe(80000);
    const movements = movementsRes.body.movements as Array<Record<string, unknown>>;
    const opening = movements.find((m) => m.type === 'opening');
    expect(opening).toMatchObject({
      type: 'opening',
      description: 'Deuda inicial',
      amount: 50000,
      sign: '+'
    });
  });
});