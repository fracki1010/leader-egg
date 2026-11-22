// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isOnline,
  onOfflineStatusChange,
  getCurrentStatus,
} from '../offline-status.ts';

describe('offline-status', () => {
  let originalOnline: boolean;

  beforeEach(() => {
    originalOnline = navigator.onLine;
  });

  afterEach(() => {
    // Restore original state
    Object.defineProperty(navigator, 'onLine', {
      value: originalOnline,
      writable: true,
      configurable: true,
    });
  });

  describe('isOnline', () => {
    it('returns navigator.onLine value', () => {
      expect(typeof isOnline()).toBe('boolean');
    });
  });

  describe('getCurrentStatus', () => {
    it('returns an object with online and since fields', () => {
      const status = getCurrentStatus();
      expect(status).toHaveProperty('online');
      expect(status).toHaveProperty('since');
      expect(typeof status.online).toBe('boolean');
    });
  });

  describe('onOfflineStatusChange', () => {
    it('returns an unsubscribe function', () => {
      const unsub = onOfflineStatusChange(() => {});
      expect(typeof unsub).toBe('function');
      unsub();
    });

    it('unsubscribes correctly', () => {
      const callback = vi.fn();
      const unsub = onOfflineStatusChange(callback);

      unsub();

      // Simulate offline event
      window.dispatchEvent(new Event('offline'));

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('event handling', () => {
    it('dispatches offline-status:change on online event', () => {
      const handler = vi.fn();
      window.addEventListener('offline-status:change', handler);

      window.dispatchEvent(new Event('online'));

      expect(handler).toHaveBeenCalledTimes(1);
      const event = handler.mock.calls[0]![0] as CustomEvent;
      expect(event.detail.online).toBe(true);

      window.removeEventListener('offline-status:change', handler);
    });

    it('dispatches offline-status:change on offline event', () => {
      const handler = vi.fn();
      window.addEventListener('offline-status:change', handler);

      window.dispatchEvent(new Event('offline'));

      expect(handler).toHaveBeenCalledTimes(1);
      const event = handler.mock.calls[0]![0] as CustomEvent;
      expect(event.detail.online).toBe(false);

      window.removeEventListener('offline-status:change', handler);
    });

    it('calls registered callback on offline event', () => {
      const callback = vi.fn();
      const unsub = onOfflineStatusChange(callback);

      window.dispatchEvent(new Event('offline'));

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ online: false })
      );

      unsub();
    });
  });
});
