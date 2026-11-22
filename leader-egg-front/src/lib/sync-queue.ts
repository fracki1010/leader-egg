import {
  addSyncItem,
  getPendingItems,
  markSynced,
  markConflict,
  type SyncQueueItem,
} from './offline-db.ts';
import { getActiveTenantId } from './offline-namespace.ts';

// ─── Types ──────────────────────────────────────────────────────────────────

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

type StatusCallback = (status: SyncStatus) => void;

export interface SyncResult {
  synced: number;
  conflicts: number;
  errors: number;
}

// ─── API contract for replay ────────────────────────────────────────────────

export interface SyncApiClient {
  advanceStop(routeId: string, stopId: string, status: string, notes?: string): Promise<unknown>;
  addStopNote(routeId: string, stopId: string, notes: string): Promise<unknown>;
  /** Replay a generic offline write (owner/admin queued mutations). */
  apiWrite?(method: string, url: string, body?: unknown): Promise<unknown>;
}

// ─── SyncQueue ──────────────────────────────────────────────────────────────

const statusListeners: Set<StatusCallback> = new Set();
let currentStatus: SyncStatus = 'idle';

function setStatus(status: SyncStatus): void {
  currentStatus = status;
  for (const cb of statusListeners) {
    cb(status);
  }
}

export function getSyncStatus(): SyncStatus {
  return currentStatus;
}

export function onStatusChange(callback: StatusCallback): () => void {
  statusListeners.add(callback);
  return () => {
    statusListeners.delete(callback);
  };
}

export async function enqueue(
  item: Omit<SyncQueueItem, 'id' | 'synced' | 'conflict'>
): Promise<string> {
  return addSyncItem(item);
}

export async function getPendingCount(): Promise<number> {
  const items = await getPendingItems();
  return items.length;
}

export async function processAll(client: SyncApiClient): Promise<SyncResult> {
  setStatus('syncing');

  // Defense in depth: the queue DB is already tenant-scoped, but never replay a
  // row queued under a different tenant than the one currently signed in — that
  // would send tenant A's write with tenant B's token.
  const activeTenantId = getActiveTenantId();
  const pending = (await getPendingItems()).filter(
    (item) => (item.tenantId ?? null) === (activeTenantId ?? null)
  );
  const result: SyncResult = { synced: 0, conflicts: 0, errors: 0 };

  for (const item of pending) {
    try {
      switch (item.operation) {
        case 'advanceStop':
          await client.advanceStop(
            item.payload.routeId,
            item.payload.stopId,
            item.payload.status!,
            item.payload.notes
          );
          break;
        case 'addNote':
          await client.addStopNote(
            item.payload.routeId,
            item.payload.stopId,
            item.payload.notes!
          );
          break;
        case 'apiWrite':
          await client.apiWrite!(
            item.payload.method,
            item.payload.url,
            item.payload.body
          );
          break;
      }
      await markSynced(item.id);
      result.synced++;
    } catch (err: unknown) {
      const httpError = err as { status?: number; message?: string };
      if (httpError.status === 409) {
        await markConflict(item.id, 'Server state updated by dispatch');
        result.conflicts++;
      } else {
        await markConflict(item.id, httpError.message || 'Sync failed');
        result.errors++;
      }
    }
  }

  const remaining = await getPendingCount();
  setStatus(remaining > 0 ? 'error' : result.synced > 0 ? 'synced' : 'idle');

  return result;
}
