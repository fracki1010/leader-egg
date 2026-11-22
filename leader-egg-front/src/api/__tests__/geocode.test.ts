import { describe, it, expect, vi, beforeEach } from 'vitest';
import { geocode, reverseGeocode } from '../geocode.ts';

/** Mock the network client — assert the endpoint/body the api layer builds. */
const apiPost = vi.fn();

vi.mock('../client.ts', () => ({
  api: {
    post: (endpoint: string, body?: unknown) => apiPost(endpoint, body),
  },
}));

describe('geocode api', () => {
  beforeEach(() => {
    apiPost.mockClear();
  });

  it('posts the address to /v1/geocode', async () => {
    apiPost.mockResolvedValue({ lat: -31.42, lng: -64.18, displayName: 'Córdoba' });

    const result = await geocode('Córdoba, Argentina');

    expect(apiPost).toHaveBeenCalledWith('/v1/geocode', { address: 'Córdoba, Argentina' });
    expect(result.lat).toBe(-31.42);
  });

  it('posts the coordinates to /v1/geocode/reverse', async () => {
    apiPost.mockResolvedValue({ displayName: 'Calle Falsa 123', street: 'Calle Falsa', number: '123' });

    const result = await reverseGeocode(-31.4201, -64.1888);

    expect(apiPost).toHaveBeenCalledWith('/v1/geocode/reverse', { lat: -31.4201, lng: -64.1888 });
    expect(result.street).toBe('Calle Falsa');
    expect(result.number).toBe('123');
  });
});
