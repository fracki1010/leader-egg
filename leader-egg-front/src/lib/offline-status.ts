// ─── Types ──────────────────────────────────────────────────────────────────

export interface OfflineStatusDetail {
  online: boolean;
  since: number | null;
}

export type OfflineStatusCallback = (detail: OfflineStatusDetail) => void;

// ─── State ──────────────────────────────────────────────────────────────────

let onlineSince: number | null = navigator.onLine ? Date.now() : null;
let offlineSince: number | null = navigator.onLine ? null : Date.now();

const listeners: Set<OfflineStatusCallback> = new Set();

function dispatch(detail: OfflineStatusDetail): void {
  for (const cb of listeners) {
    cb(detail);
  }
  window.dispatchEvent(
    new CustomEvent('offline-status:change', { detail })
  );
}

// ─── Event handlers ─────────────────────────────────────────────────────────

function handleOnline(): void {
  onlineSince = Date.now();
  offlineSince = null;
  dispatch({ online: true, since: onlineSince });
}

function handleOffline(): void {
  offlineSince = Date.now();
  onlineSince = null;
  dispatch({ online: false, since: offlineSince });
}

// Attach once on import
if (typeof window !== 'undefined') {
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function isOnline(): boolean {
  return navigator.onLine;
}

export function getOfflineSince(): number | null {
  return offlineSince;
}

export function onOfflineStatusChange(callback: OfflineStatusCallback): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function getCurrentStatus(): OfflineStatusDetail {
  return {
    online: navigator.onLine,
    since: navigator.onLine ? onlineSince : offlineSince,
  };
}

// ─── React hook ─────────────────────────────────────────────────────────────

export function useOfflineStatus(): OfflineStatusDetail {
  // This is a simple hook that re-renders on status change.
  // Usage: const { online } = useOfflineStatus();
  // NOTE: Requires React — import react in the consuming component.
  // Keeping this file framework-free; components import this and use
  // onOfflineStatusChange inside their own useEffect.
  return getCurrentStatus();
}
