import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { enqueue, processAll } from '../sync-queue.ts';
import { openDatabase } from '../offline-db.ts';

function createClient() {
  return {
    advanceStop: vi.fn().mockResolvedValue({ ok: true }),
    addStopNote: vi.fn().mockResolvedValue({ ok: true }),
    apiWrite: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe('sync-queue apiWrite replay', () => {
  beforeEach(async () => {
    const db = await openDatabase();
    await db.clear('sync-queue');
    vi.clearAllMocks();
  });

  it('replays queued apiWrite items through the client and marks them synced', async () => {
    const client = createClient();
    await enqueue({
      operation: 'apiWrite',
      payload: { method: 'POST', url: '/v1/orders', body: '{"customerId":"c1"}' },
      timestamp: 1,
    });
    await enqueue({
      operation: 'apiWrite',
      payload: { method: 'PATCH', url: '/v1/inventory/p1', body: '{"quantity":5}' },
      timestamp: 2,
    });

    const result = await processAll(client);

    expect(result.synced).toBe(2);
    expect(result.conflicts).toBe(0);
    expect(result.errors).toBe(0);
    expect(client.apiWrite).toHaveBeenCalledTimes(2);
    expect(client.apiWrite).toHaveBeenCalledWith('POST', '/v1/orders', '{"customerId":"c1"}');
    expect(client.apiWrite).toHaveBeenCalledWith('PATCH', '/v1/inventory/p1', '{"quantity":5}');

    const db = await openDatabase();
    const all = await db.getAll('sync-queue');
    expect(all.every((item) => item.synced)).toBe(true);
  });

  it('marks apiWrite 409 responses as conflicts', async () => {
    const client = createClient();
    client.apiWrite.mockRejectedValue({ status: 409, message: 'Conflict' });
    await enqueue({
      operation: 'apiWrite',
      payload: { method: 'POST', url: '/v1/orders', body: undefined },
      timestamp: 1,
    });

    const result = await processAll(client);

    expect(result.conflicts).toBe(1);
    expect(result.synced).toBe(0);
  });

  it('marks apiWrite non-409 errors as failed', async () => {
    const client = createClient();
    client.apiWrite.mockRejectedValue({ status: 500, message: 'Server error' });
    await enqueue({
      operation: 'apiWrite',
      payload: { method: 'POST', url: '/v1/customers', body: undefined },
      timestamp: 1,
    });

    const result = await processAll(client);

    expect(result.errors).toBe(1);
    expect(result.synced).toBe(0);
  });
});