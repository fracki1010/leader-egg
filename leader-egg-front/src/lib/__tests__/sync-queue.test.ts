import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  enqueue,
  processAll,
  getPendingCount,
  onStatusChange,
  getSyncStatus,
  type SyncApiClient,
} from '../sync-queue.ts';
import { openDatabase } from '../offline-db.ts';

// ─── Mock API client ────────────────────────────────────────────────────────

function createMockClient(overrides?: {
  advanceStop?: () => Promise<unknown>;
  addStopNote?: () => Promise<unknown>;
}): SyncApiClient {
  return {
    advanceStop: overrides?.advanceStop ?? vi.fn().mockResolvedValue({ ok: true }),
    addStopNote: overrides?.addStopNote ?? vi.fn().mockResolvedValue({ ok: true }),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('sync-queue', () => {
  beforeEach(async () => {
    const db = await openDatabase();
    await db.clear('sync-queue');
  });

  describe('enqueue', () => {
    it('adds item to queue and returns id', async () => {
      const id = await enqueue({
        operation: 'advanceStop',
        payload: { routeId: 'r1', stopId: 's1', status: 'delivered' },
        timestamp: Date.now(),
      });

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');

      const count = await getPendingCount();
      expect(count).toBe(1);
    });
  });

  describe('getPendingCount', () => {
    it('returns 0 when queue is empty', async () => {
      const count = await getPendingCount();
      expect(count).toBe(0);
    });

    it('returns correct count with multiple items', async () => {
      await enqueue({
        operation: 'advanceStop',
        payload: { routeId: 'r1', stopId: 's1', status: 'delivered' },
        timestamp: Date.now(),
      });
      await enqueue({
        operation: 'addNote',
        payload: { routeId: 'r1', stopId: 's2', notes: 'Note' },
        timestamp: Date.now(),
      });

      const count = await getPendingCount();
      expect(count).toBe(2);
    });
  });

  describe('processAll', () => {
    it('processes all pending items and returns result', async () => {
      const client = createMockClient();

      await enqueue({
        operation: 'advanceStop',
        payload: { routeId: 'r1', stopId: 's1', status: 'delivered' },
        timestamp: Date.now(),
      });
      await enqueue({
        operation: 'addNote',
        payload: { routeId: 'r1', stopId: 's2', notes: 'Note' },
        timestamp: Date.now(),
      });

      const result = await processAll(client);

      expect(result.synced).toBe(2);
      expect(result.conflicts).toBe(0);
      expect(result.errors).toBe(0);
      expect(client.advanceStop).toHaveBeenCalledWith('r1', 's1', 'delivered', undefined);
      expect(client.addStopNote).toHaveBeenCalledWith('r1', 's2', 'Note');
    });

    it('handles 409 conflicts with server-wins', async () => {
      const client = createMockClient({
        advanceStop: vi.fn().mockRejectedValue({ status: 409, message: 'Conflict' }),
      });

      await enqueue({
        operation: 'advanceStop',
        payload: { routeId: 'r1', stopId: 's1', status: 'delivered' },
        timestamp: Date.now(),
      });

      const result = await processAll(client);

      expect(result.conflicts).toBe(1);
      expect(result.synced).toBe(0);
    });

    it('handles non-409 errors', async () => {
      const client = createMockClient({
        advanceStop: vi.fn().mockRejectedValue({ status: 500, message: 'Server error' }),
      });

      await enqueue({
        operation: 'advanceStop',
        payload: { routeId: 'r1', stopId: 's1', status: 'delivered' },
        timestamp: Date.now(),
      });

      const result = await processAll(client);

      expect(result.errors).toBe(1);
      expect(result.synced).toBe(0);
    });

    it('processes items in FIFO order', async () => {
      const calls: string[] = [];
      const client = createMockClient({
        advanceStop: vi.fn().mockImplementation(async () => {
          calls.push('advanceStop');
        }),
        addStopNote: vi.fn().mockImplementation(async () => {
          calls.push('addStopNote');
        }),
      });

      await enqueue({
        operation: 'advanceStop',
        payload: { routeId: 'r1', stopId: 's1', status: 'delivered' },
        timestamp: 1000,
      });
      await enqueue({
        operation: 'addNote',
        payload: { routeId: 'r1', stopId: 's2', notes: 'Note' },
        timestamp: 2000,
      });

      await processAll(client);

      expect(calls).toEqual(['advanceStop', 'addStopNote']);
    });
  });

  describe('status change', () => {
    it('calls listener on status change', async () => {
      const callback = vi.fn();
      const unsub = onStatusChange(callback);

      const client = createMockClient();
      await enqueue({
        operation: 'advanceStop',
        payload: { routeId: 'r1', stopId: 's1', status: 'delivered' },
        timestamp: Date.now(),
      });
      await processAll(client);

      expect(callback).toHaveBeenCalled();
      expect(getSyncStatus()).toBe('synced');

      unsub();
    });

    it('unsubscribes correctly', async () => {
      const callback = vi.fn();
      const unsub = onStatusChange(callback);

      unsub();

      const client = createMockClient();
      await enqueue({
        operation: 'advanceStop',
        payload: { routeId: 'r1', stopId: 's1', status: 'delivered' },
        timestamp: Date.now(),
      });
      await processAll(client);

      // callback should not have been called after unsubscribe
      expect(callback).not.toHaveBeenCalled();
    });
  });
});
