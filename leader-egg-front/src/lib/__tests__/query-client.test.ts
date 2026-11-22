import { describe, it, expect } from 'vitest';
import { createQueryClient, shouldRetry } from '../query-client.ts';
import { ApiError, OfflineWriteQueuedError } from '../../api/client.ts';
import { OfflineCacheMissError } from '../offline-cache.ts';

describe('query-client', () => {
  it('configures queries offline-first and mutations always', () => {
    const client = createQueryClient();
    const defaults = client.getDefaultOptions();

    expect(defaults.queries?.networkMode).toBe('offlineFirst');
    expect(defaults.queries?.staleTime).toBe(30_000);
    expect(defaults.queries?.gcTime).toBe(5 * 60_000);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(true);

    expect(defaults.mutations?.networkMode).toBe('always');
    expect(defaults.mutations?.retry).toBe(0);
  });

  it('never retries offline-queued or offline-cache-miss errors', () => {
    expect(shouldRetry(0, new OfflineWriteQueuedError())).toBe(false);
    expect(shouldRetry(0, new OfflineCacheMissError())).toBe(false);
    expect(shouldRetry(1, new OfflineWriteQueuedError())).toBe(false);
  });

  it('never retries 4xx ApiError', () => {
    expect(shouldRetry(0, new ApiError('not found', 404))).toBe(false);
    expect(shouldRetry(0, new ApiError('bad request', 400))).toBe(false);
    expect(shouldRetry(1, new ApiError('forbidden', 403))).toBe(false);
  });

  it('retries 5xx and unknown errors up to two attempts', () => {
    expect(shouldRetry(0, new ApiError('boom', 500))).toBe(true);
    expect(shouldRetry(1, new ApiError('boom', 500))).toBe(true);
    expect(shouldRetry(2, new ApiError('boom', 500))).toBe(false);

    expect(shouldRetry(0, new Error('network down'))).toBe(true);
    expect(shouldRetry(1, new Error('network down'))).toBe(true);
    expect(shouldRetry(2, new Error('network down'))).toBe(false);
  });
});
