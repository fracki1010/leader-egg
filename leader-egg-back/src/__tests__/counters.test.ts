import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDatabase, stopTestDatabase, clearDatabase } from './helpers.js';
import { getNextSequence, getNextOrderNumber } from '../modules/counters/model.js';

describe('Counter Model — Unit', () => {
  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  describe('getNextSequence', () => {
    it('returns 1 on first call for a new counter', async () => {
      const seq = await getNextSequence('test-counter');
      expect(seq).toBe(1);
    });

    it('increments sequentially', async () => {
      const seq1 = await getNextSequence('test-counter');
      const seq2 = await getNextSequence('test-counter');
      const seq3 = await getNextSequence('test-counter');
      expect(seq1).toBe(1);
      expect(seq2).toBe(2);
      expect(seq3).toBe(3);
    });

    it('maintains separate counters for different names', async () => {
      const a1 = await getNextSequence('counter-a');
      const b1 = await getNextSequence('counter-b');
      const a2 = await getNextSequence('counter-a');
      expect(a1).toBe(1);
      expect(b1).toBe(1);
      expect(a2).toBe(2);
    });
  });

  describe('getNextOrderNumber', () => {
    it('returns formatted order number ORD-YYYYMMDD-###', async () => {
      const orderNum = await getNextOrderNumber();
      expect(orderNum).toMatch(/^ORD-\d{8}-\d{3}$/);
    });

    it('increments sequence for same date', async () => {
      const num1 = await getNextOrderNumber();
      const num2 = await getNextOrderNumber();
      expect(num1).not.toBe(num2);

      // Extract sequence parts
      const seq1 = parseInt(num1.slice(-3), 10);
      const seq2 = parseInt(num2.slice(-3), 10);
      expect(seq2).toBe(seq1 + 1);
    });

    it('survives conceptual restart (counter persists in DB)', async () => {
      const num1 = await getNextOrderNumber();
      const num2 = await getNextOrderNumber();
      // Both should have same date prefix and sequential numbers
      const datePrefix = num1.slice(0, 12); // ORD-YYYYMMDD
      expect(num2.startsWith(datePrefix)).toBe(true);
    });
  });
});
