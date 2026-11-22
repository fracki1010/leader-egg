import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { startTestDatabase, stopTestDatabase, clearDatabase, createCreditCustomer, createTestCustomer, seedProducts, getProductIds } from './helpers.js';
import { computeDueDate, checkCreditLimit, getCustomerOutstanding } from '../modules/orders/credit-service.js';
import { Order } from '../modules/orders/model.js';
import { CustomerCharge } from '../modules/customer-charges/model.js';

describe('Credit Service — Unit', () => {
  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  describe('computeDueDate', () => {
    it('returns null for termDays=0 (cash customer)', () => {
      const result = computeDueDate(0);
      expect(result).toBeNull();
    });

    it('returns null for undefined termDays', () => {
      const result = computeDueDate(undefined as unknown as number);
      expect(result).toBeNull();
    });

    it('computes dueDate = orderDate + termDays', () => {
      const orderDate = new Date('2026-09-01T00:00:00Z');
      const result = computeDueDate(15, orderDate);
      expect(result).toEqual(new Date('2026-09-16T00:00:00Z'));
    });

    it('computes dueDate with termDays=30', () => {
      const orderDate = new Date('2026-09-01T00:00:00Z');
      const result = computeDueDate(30, orderDate);
      expect(result).toEqual(new Date('2026-10-01T00:00:00Z'));
    });

    it('defaults orderDate to now when not provided', () => {
      const now = new Date();
      const result = computeDueDate(7);
      expect(result).not.toBeNull();
      const diffMs = (result as Date).getTime() - now.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      expect(diffDays).toBe(7);
    });
  });

  describe('getCustomerOutstanding', () => {
    it('returns zero for customer with no orders', async () => {
      const customer = await createTestCustomer();
      const result = await getCustomerOutstanding(customer._id as string);
      expect(result.outstandingBalance).toBe(0);
      expect(result.orderCount).toBe(0);
    });

    it('sums balances across unpaid orders', async () => {
      const customer = await createTestCustomer();
      await Order.create([
        {
          orderNumber: 'ORD-001',
          customerId: customer._id,
          customerName: 'Test',
          channel: 'phone',
          items: [{ productId: '000000000000000000000001', productName: 'X', quantity: 1, unitPrice: 100, subtotal: 100 }],
          totalAmount: 100,
          paidAmount: 0,
          balance: 100,
          paymentStatus: 'unpaid'
        },
        {
          orderNumber: 'ORD-002',
          customerId: customer._id,
          customerName: 'Test',
          channel: 'phone',
          items: [{ productId: '000000000000000000000001', productName: 'X', quantity: 1, unitPrice: 200, subtotal: 200 }],
          totalAmount: 200,
          paidAmount: 50,
          balance: 150,
          paymentStatus: 'partial'
        }
      ]);

      const result = await getCustomerOutstanding(customer._id as string);
      expect(result.outstandingBalance).toBe(250);
      expect(result.orderCount).toBe(2);
    });

    it('excludes paid orders', async () => {
      const customer = await createTestCustomer();
      await Order.create([
        {
          orderNumber: 'ORD-001',
          customerId: customer._id,
          customerName: 'Test',
          channel: 'phone',
          items: [{ productId: '000000000000000000000001', productName: 'X', quantity: 1, unitPrice: 100, subtotal: 100 }],
          totalAmount: 100,
          paidAmount: 100,
          balance: 0,
          paymentStatus: 'paid'
        }
      ]);

      const result = await getCustomerOutstanding(customer._id as string);
      expect(result.outstandingBalance).toBe(0);
      expect(result.orderCount).toBe(0);
    });

    it('excludes cancelled orders from outstanding and from the credit check', async () => {
      const customer = await createCreditCustomer(1000, 15);
      await Order.create({
        orderNumber: 'ORD-CANCELLED',
        customerId: customer._id,
        customerName: 'Test',
        channel: 'phone',
        items: [{ productId: '000000000000000000000001', productName: 'X', quantity: 1, unitPrice: 5000, subtotal: 5000 }],
        totalAmount: 5000,
        status: 'cancelled',
        paidAmount: 0,
        balance: 5000,
        paymentStatus: 'unpaid'
      });

      const result = await getCustomerOutstanding(customer._id as string);
      expect(result.outstandingBalance).toBe(0);
      expect(result.orderCount).toBe(0);

      // The cancellation frees the limit: a 1000 order still fits.
      const check = await checkCreditLimit(customer._id as string, 1000);
      expect(check.allowed).toBe(true);
    });

    it('counts openingDebt alone and blocks an order when the limit is below it', async () => {
      const customer = await createCreditCustomer(1000, 15, { openingDebt: 1500 });

      const result = await getCustomerOutstanding(customer._id as string);
      expect(result.outstandingBalance).toBe(1500);
      expect(result.orderCount).toBe(0);

      const check = await checkCreditLimit(customer._id as string, 100);
      expect(check.allowed).toBe(false);
      expect(check.overage).toBe(600); // 1500 + 100 − 1000
      expect(check.outstandingBalance).toBe(1500);
      expect(check.creditLimit).toBe(1000);
    });

    it('counts the net manual charge term exactly once', async () => {
      const customer = await createTestCustomer();
      await Order.create({
        orderNumber: 'ORD-MANUAL',
        customerId: customer._id,
        customerName: 'Test',
        channel: 'phone',
        items: [{ productId: '000000000000000000000001', productName: 'X', quantity: 1, unitPrice: 1000, subtotal: 1000 }],
        totalAmount: 1000,
        paidAmount: 0,
        balance: 1000,
        paymentStatus: 'unpaid'
      });
      await CustomerCharge.create([
        { customerId: customer._id, type: 'charge', amount: 300, reason: 'manual_debt', source: 'manual', createdBy: new Types.ObjectId() },
        { customerId: customer._id, type: 'credit', amount: 100, reason: 'forgiveness', source: 'manual', createdBy: new Types.ObjectId() }
      ]);

      const result = await getCustomerOutstanding(customer._id as string);
      expect(result.outstandingBalance).toBe(1200); // 1000 + 300 − 100
    });
  });

  describe('checkCreditLimit', () => {
    it('allows order when within credit limit', async () => {
      const customer = await createCreditCustomer(5000, 15);
      const result = await checkCreditLimit(customer._id as string, 1000);
      expect(result.allowed).toBe(true);
    });

    it('rejects order when exceeding credit limit', async () => {
      const customer = await createCreditCustomer(5000, 15);
      // Create an existing unpaid order of $4000
      await Order.create({
        orderNumber: 'ORD-EXIST',
        customerId: customer._id,
        customerName: 'Test',
        channel: 'phone',
        items: [{ productId: '000000000000000000000001', productName: 'X', quantity: 1, unitPrice: 4000, subtotal: 4000 }],
        totalAmount: 4000,
        paidAmount: 0,
        balance: 4000,
        paymentStatus: 'unpaid'
      });

      const result = await checkCreditLimit(customer._id as string, 1500);
      expect(result.allowed).toBe(false);
      expect(result.overage).toBe(500);
      expect(result.outstandingBalance).toBe(4000);
      expect(result.creditLimit).toBe(5000);
    });

    it('allows order when customer has no credit limit (limit=0)', async () => {
      const customer = await createTestCustomer(); // default: creditConfig.limit=0
      const result = await checkCreditLimit(customer._id as string, 99999);
      expect(result.allowed).toBe(true);
    });

    it('allows order at exact credit limit', async () => {
      const customer = await createCreditCustomer(5000, 15);
      const result = await checkCreditLimit(customer._id as string, 5000);
      expect(result.allowed).toBe(true);
    });
  });
});
