import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { enqueue, processAll, getPendingCount } from '../sync-queue.ts';
import { openDatabase } from '../offline-db.ts';

// ─── Mock API client ────────────────────────────────────────────────────────

function createMockClient(overrides?: {
  advanceStop?: () => Promise<unknown>;
  addStopNote?: () => Promise<unknown>;
}) {
  return {
    advanceStop: overrides?.advanceStop ?? vi.fn().mockResolvedValue({ ok: true }),
    addStopNote: overrides?.addStopNote ?? vi.fn().mockResolvedValue({ ok: true }),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('sync-queue replay on reconnect', () => {
  beforeEach(async () => {
    const db = await openDatabase();
    await db.clear('sync-queue');
    vi.clearAllMocks();
  });

  it('replays all pending items on processAll', async () => {
    const advanceStopMock = vi.fn().mockResolvedValue({ ok: true });
    const addStopNoteMock = vi.fn().mockResolvedValue({ ok: true });
    const client = createMockClient({
      advanceStop: advanceStopMock,
      addStopNote: addStopNoteMock,
    });

    // Enqueue items
    await enqueue({
      operation: 'advanceStop',
      payload: { routeId: 'r1', stopId: 's1', status: 'delivered' },
      timestamp: 1000,
    });
    await enqueue({
      operation: 'addNote',
      payload: { routeId: 'r1', stopId: 's2', notes: 'Left at door' },
      timestamp: 2000,
    });
    await enqueue({
      operation: 'advanceStop',
      payload: { routeId: 'r1', stopId: 's3', status: 'in_transit' },
      timestamp: 3000,
    });

    const countBefore = await getPendingCount();
    expect(countBefore).toBe(3);

    // Simulate reconnect — process all
    const result = await processAll(client);

    expect(result.synced).toBe(3);
    expect(result.conflicts).toBe(0);
    expect(result.errors).toBe(0);

    // Verify all operations were called
    expect(advanceStopMock).toHaveBeenCalledTimes(2);
    expect(addStopNoteMock).toHaveBeenCalledTimes(1);

    // Queue should be empty after replay
    const countAfter = await getPendingCount();
    expect(countAfter).toBe(0);
  });

  it('marks items as synced after successful replay', async () => {
    const client = createMockClient();

    await enqueue({
      operation: 'advanceStop',
      payload: { routeId: 'r1', stopId: 's1', status: 'delivered' },
      timestamp: Date.now(),
    });

    await processAll(client);

    // Verify all items are marked synced
    const db = await openDatabase();
    const all = await db.getAll('sync-queue');
    expect(all.every((item) => item.synced)).toBe(true);
  });

  it('handles 409 conflicts with server-wins strategy', async () => {
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

    // Conflict item should be marked
    const db = await openDatabase();
    const all = await db.getAll('sync-queue');
    expect(all[0]!.conflict).toBe(true);
    expect(all[0]!.error).toBe('Server state updated by dispatch');
  });

  it('handles non-409 errors gracefully', async () => {
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

  it('returns idle status when no pending items', async () => {
    const client = createMockClient();

    const result = await processAll(client);

    expect(result.synced).toBe(0);
    expect(result.conflicts).toBe(0);
    expect(result.errors).toBe(0);
  });

  it('processes mixed operations correctly', async () => {
    const client = createMockClient();

    // Enqueue a mix of operations
    await enqueue({
      operation: 'advanceStop',
      payload: { routeId: 'r1', stopId: 's1', status: 'delivered' },
      timestamp: 1000,
    });
    await enqueue({
      operation: 'addNote',
      payload: { routeId: 'r1', stopId: 's1', notes: 'Great delivery' },
      timestamp: 2000,
    });
    await enqueue({
      operation: 'advanceStop',
      payload: { routeId: 'r1', stopId: 's2', status: 'in_transit' },
      timestamp: 3000,
    });

    const result = await processAll(client);

    expect(result.synced).toBe(3);

    // Verify API calls
    expect(client.advanceStop).toHaveBeenCalledWith('r1', 's1', 'delivered', undefined);
    expect(client.addStopNote).toHaveBeenCalledWith('r1', 's1', 'Great delivery');
    expect(client.advanceStop).toHaveBeenCalledWith('r1', 's2', 'in_transit', undefined);
  });
});
