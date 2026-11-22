/**
 * Stale-chunk recovery.
 *
 * This is a PWA with hashed, lazily-loaded route chunks. After a new deploy the
 * old chunk files are gone from the server, but an already-open tab (or the
 * service worker's previous precache) may still reference them — producing
 * "Failed to fetch dynamically imported module: .../Page-<oldhash>.js".
 *
 * The fix is to detect that failure and do ONE hard reload so the tab pulls the
 * freshly precached shell + current chunk hashes. A short cooldown prevents a
 * reload loop when the failure is not caused by a stale deploy (e.g. truly
 * offline with an incomplete cache).
 */

const RELOAD_KEY = 'chunk-reload-at';
const RELOAD_COOLDOWN_MS = 10_000;

/** Reload the page at most once per cooldown window. Returns false if skipped. */
export function reloadOnceForChunkError(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Number.isFinite(last) && Date.now() - last < RELOAD_COOLDOWN_MS) {
      return false;
    }
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // sessionStorage unavailable (private mode edge cases) — reload anyway.
  }
  window.location.reload();
  return true;
}

const isChunkLoadFailure = (value: unknown): boolean => {
  const message =
    value instanceof Error
      ? value.message
      : typeof value === 'string'
        ? value
        : '';
  return (
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('error loading dynamically imported module') ||
    message.includes('Importing a module script failed')
  );
};

/**
 * Install global handlers that turn a stale-chunk failure into a single silent
 * reload instead of an uncaught error / blank screen. Safe to call once at boot.
 */
export function installChunkReloadHandler(): void {
  // Vite fires this when a module preload (used by React.lazy chunks) fails.
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    reloadOnceForChunkError();
  });

  // Belt-and-braces: some browsers surface the failure as an uncaught promise
  // rejection or a window error rather than the Vite event.
  window.addEventListener('unhandledrejection', (event) => {
    if (isChunkLoadFailure(event.reason)) {
      event.preventDefault();
      reloadOnceForChunkError();
    }
  });

  window.addEventListener('error', (event) => {
    if (isChunkLoadFailure(event.error ?? event.message)) {
      reloadOnceForChunkError();
    }
  });
}
