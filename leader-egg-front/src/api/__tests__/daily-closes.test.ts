import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dailyClosesApi } from '../daily-closes.ts';

/** Mock the network client — assert the endpoint/params/body the api layer builds. */
const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();

vi.mock('../client.ts', () => ({
  api: {
    get: (endpoint: string, params?: Record<string, string>) => apiGet(endpoint, params),
    post: (endpoint: string, body?: unknown) => apiPost(endpoint, body),
    patch: (endpoint: string, body?: unknown) => apiPatch(endpoint, body),
  },
}));

describe('dailyClosesApi channel params', () => {
  beforeEach(() => {
    apiGet.mockClear();
    apiPost.mockClear();
    apiPatch.mockClear();
  });

  it('preview passes channel=puesto alongside date', async () => {
    await dailyClosesApi.preview('2026-10-04', 'puesto');
    expect(apiGet).toHaveBeenCalledWith('/v1/daily-closes/preview', {
      date: '2026-10-04',
      channel: 'puesto',
    });
  });

  it('preview omits params when called bare', async () => {
    await dailyClosesApi.preview();
    expect(apiGet).toHaveBeenCalledWith('/v1/daily-closes/preview', {});
  });

  it('getByDate scopes the request to the channel', async () => {
    await dailyClosesApi.getByDate('2026-10-04', 'puesto');
    expect(apiGet).toHaveBeenCalledWith('/v1/daily-closes/2026-10-04', { channel: 'puesto' });
  });

  it('list filters by channel only when provided', async () => {
    await dailyClosesApi.list(undefined, undefined, 'puesto');
    expect(apiGet).toHaveBeenCalledWith('/v1/daily-closes', { channel: 'puesto' });

    await dailyClosesApi.list();
    expect(apiGet).toHaveBeenLastCalledWith('/v1/daily-closes', {});
  });

  it('create sends the channel in the body', async () => {
    await dailyClosesApi.create({ date: '2026-10-04', channel: 'puesto', countedCash: 5000 });
    expect(apiPost).toHaveBeenCalledWith('/v1/daily-closes', {
      date: '2026-10-04',
      channel: 'puesto',
      countedCash: 5000,
    });
  });

  it('create without channel keeps the payload channel-free (backend defaults reparto)', async () => {
    await dailyClosesApi.create({ countedCash: 5000 });
    expect(apiPost).toHaveBeenCalledWith('/v1/daily-closes', { countedCash: 5000 });
  });

  it('update stays channel-agnostic (PATCH by id)', async () => {
    await dailyClosesApi.update('close-1', { countedCash: 5100, notes: 'corrección' });
    expect(apiPatch).toHaveBeenCalledWith('/v1/daily-closes/close-1', {
      countedCash: 5100,
      notes: 'corrección',
    });
  });
});