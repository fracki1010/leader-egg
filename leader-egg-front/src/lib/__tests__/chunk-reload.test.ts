import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reloadOnceForChunkError, installChunkReloadHandler } from '../chunk-reload';

const reload = vi.fn();

describe('chunk-reload', () => {
  beforeEach(() => {
    sessionStorage.clear();
    reload.mockClear();
    // jsdom does not allow spying on location.reload — replace it wholesale.
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { reload },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reloads on the first stale-chunk failure, then respects the cooldown', () => {
    expect(reloadOnceForChunkError()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);

    // A second failure within the cooldown window must NOT loop.
    expect(reloadOnceForChunkError()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads when Vite reports a preload error', () => {
    installChunkReloadHandler();

    const event = new Event('vite:preloadError', { cancelable: true });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);

    expect(preventDefault).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads on an uncaught dynamic-import rejection', () => {
    installChunkReloadHandler();

    const event = new Event('unhandledrejection', { cancelable: true }) as Event & {
      reason?: unknown;
    };
    (event as { reason: unknown }).reason = new TypeError(
      'Failed to fetch dynamically imported module: /assets/ProductDetailPage-BBWkfLwt.js',
    );
    window.dispatchEvent(event);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('ignores unrelated errors', () => {
    installChunkReloadHandler();

    const event = new Event('unhandledrejection', { cancelable: true }) as Event & {
      reason?: unknown;
    };
    (event as { reason: unknown }).reason = new Error('Algo sin relación');
    window.dispatchEvent(event);

    expect(reload).not.toHaveBeenCalled();
  });
});
