import { processAll, type SyncApiClient, type SyncResult } from './sync-queue.ts';
import { onOfflineStatusChange } from './offline-status.ts';
import { rawRequest } from '../api/client.ts';

/**
 * Replay client that replays every queued operation through the real network
 * (same auth + base URL as the API client).
 */
const replayClient: SyncApiClient = {
  advanceStop: (routeId, stopId, status, notes) =>
    rawRequest(`/v1/routes/${routeId}/stops/${stopId}/advance`, {
      method: 'PATCH',
      body: JSON.stringify({ status, notes }),
    }),
  addStopNote: (routeId, stopId, notes) =>
    rawRequest(`/v1/routes/${routeId}/stops/${stopId}/notes`, {
      method: 'PATCH',
      body: JSON.stringify({ notes }),
    }),
  apiWrite: (method, url, body) =>
    rawRequest(url, {
      method,
      body:
        body !== undefined
          ? typeof body === 'string'
            ? body
            : JSON.stringify(body)
          : undefined,
    }),
};

let started = false;

export interface OfflineSyncOptions {
  /**
   * Called after a reconnect flush replayed at least one queued write. Use it
   * to invalidate TanStack Query caches so newly synced server state is read
   * back (e.g. `() => queryClient.invalidateQueries()`).
   */
  onReplayed?: (result: SyncResult) => void;
}

/**
 * Start the reconnection flush: whenever the browser goes back online, replay
 * every queued write (driver route ops + owner/admin offline mutations)
 * against the API. Idempotent — call once from the app entry point.
 */
export function startOfflineSync(options: OfflineSyncOptions = {}): void {
  if (started) return;
  started = true;
  onOfflineStatusChange((detail) => {
    if (detail.online) {
      void processAll(replayClient).then((result) => {
        if (result.synced > 0) {
          options.onReplayed?.(result);
        }
      });
    }
  });
}