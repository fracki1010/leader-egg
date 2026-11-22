import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Scroll offset per history entry, keyed by `location.key`.
 * Module scope so the map survives route changes (the component itself is
 * mounted once and never unmounts on navigation).
 */
const scrollPositions = new Map<string, number>();

/** ~1s max wait: 20 retries * 50ms. */
const MAX_RESTORE_ATTEMPTS = 20;
const RESTORE_RETRY_DELAY_MS = 50;

/**
 * Scroll to `targetY`, retrying briefly while asynchronously loaded content
 * makes the document tall enough to reach it. Returns a cleanup function that
 * cancels any pending timer.
 */
function restoreScrollPosition(targetY: number): () => void {
  let attempts = 0;
  let cancelled = false;
  let timeoutId: number | undefined;

  const tryRestore = () => {
    if (cancelled) return;

    window.scrollTo(0, targetY);

    const maxReachableY = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight,
    );
    if (maxReachableY >= targetY || attempts >= MAX_RESTORE_ATTEMPTS) return;

    attempts += 1;
    timeoutId = window.setTimeout(tryRestore, RESTORE_RETRY_DELAY_MS);
  };

  // Defer the first attempt until after the new route has painted.
  timeoutId = window.setTimeout(tryRestore, 0);

  return () => {
    cancelled = true;
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  };
}

/**
 * SPA equivalent of the browser's native scroll restoration.
 *
 * - POP navigations (back/forward) restore the scroll position saved for the
 *   destination history entry.
 * - PUSH/REPLACE navigations start at the top of the page.
 *
 * Render exactly once inside the router.
 */
export function ScrollRestoration() {
  const location = useLocation();
  const navigationType = useNavigationType();

  // Disable the browser's own scroll handling so it cannot fight ours.
  useEffect(() => {
    if (!('scrollRestoration' in window.history)) return undefined;

    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';

    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  // Remember the current entry's offset while the user scrolls.
  useEffect(() => {
    const key = location.key;
    const savePosition = () => {
      scrollPositions.set(key, window.scrollY);
    };

    window.addEventListener('scroll', savePosition, { passive: true });
    return () => {
      window.removeEventListener('scroll', savePosition);
      // Persist the final position when leaving this history entry.
      scrollPositions.set(key, window.scrollY);
    };
  }, [location.key]);

  // Restore on POP; reset to the top on PUSH/REPLACE.
  useEffect(() => {
    if (navigationType === 'POP') {
      const savedY = scrollPositions.get(location.key);
      if (savedY !== undefined) return restoreScrollPosition(savedY);
    }

    window.scrollTo(0, 0);
    return undefined;
  }, [location.key, navigationType]);

  return null;
}
