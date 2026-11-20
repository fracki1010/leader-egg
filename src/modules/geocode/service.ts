import { AppError } from '../../middleware/error-handler.js';
import { env } from '../../config/env.js';
import type { GeoPoint } from '../customers/model.js';

export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName?: string;
}

/** Structured address resolved from coordinates (missing parts are undefined). */
export interface ReverseGeocodeResult {
  displayName?: string;
  street?: string;
  number?: string;
  neighborhood?: string;
  city?: string;
  province?: string;
  postalCode?: string;
}

interface CacheEntry {
  lat: number;
  lng: number;
  displayName?: string;
  ts: number;
}

interface ReverseCacheEntry {
  result: ReverseGeocodeResult;
  ts: number;
}

// Nominatim usage policy: max 1 request/second; results are cacheable.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const CACHE_MAX_SIZE = 1000;
const MIN_REQUEST_INTERVAL_MS = 1000;
const REQUEST_TIMEOUT_MS = 10_000;

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<GeocodeResult>>();
const reverseCache = new Map<string, ReverseCacheEntry>();
const reverseInFlight = new Map<string, Promise<ReverseGeocodeResult>>();
let lastRequestTimestamp = 0;

/**
 * Normalizes an address for cache keys: trims, lowercases, and collapses
 * whitespace so case/whitespace variants hit the same cache entry.
 */
const normalizeAddress = (address: string): string =>
  address.trim().toLowerCase().replace(/\s+/g, ' ');

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Enforces Nominatim's 1 req/s policy: if less than 1000 ms have elapsed
 * since the last outgoing call, wait the remainder before proceeding.
 */
const waitForRateLimit = async (): Promise<void> => {
  const now = Date.now();
  const elapsed = now - lastRequestTimestamp;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await delay(MIN_REQUEST_INTERVAL_MS - elapsed);
  }
  lastRequestTimestamp = Date.now();
};

/**
 * Evicts the oldest entry of a cache when it exceeds its size cap.
 * Simple O(n) scan is fine for a 1000-entry cap. Shared by the forward and
 * reverse caches so both honor the same policy.
 */
const evictOldest = <T extends { ts: number }>(map: Map<string, T>): void => {
  if (map.size < CACHE_MAX_SIZE) return;

  let oldestKey: string | undefined;
  let oldestTs = Infinity;
  for (const [key, entry] of map) {
    if (entry.ts < oldestTs) {
      oldestTs = entry.ts;
      oldestKey = key;
    }
  }
  if (oldestKey !== undefined) {
    map.delete(oldestKey);
  }
};

interface NominatimResult {
  lat?: unknown;
  lon?: unknown;
  display_name?: unknown;
}

/**
 * Calls the Nominatim search API. Throws AppError:
 * - 404 when the address cannot be resolved (no results)
 * - 502 when the upstream request fails, times out, or returns garbage
 */
const fetchFromNominatim = async (address: string): Promise<GeocodeResult> => {
  await waitForRateLimit();

  const url = new URL('/search', env.NOMINATIM_BASE_URL);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('q', address);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': env.GEOCODE_USER_AGENT },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new AppError('Geocoding service unavailable', 502);
    }

    const data: unknown = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      throw new AppError('No se pudo geocodificar la dirección', 404);
    }

    const first = data[0] as NominatimResult;
    const lat = Number(first.lat);
    const lng = Number(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new AppError('Geocoding service unavailable', 502);
    }

    const displayName = typeof first.display_name === 'string' ? first.display_name : undefined;
    return { lat, lng, displayName };
  } catch (error) {
    // Preserve the intentional 404; anything else (network, timeout, parse) is upstream failure
    if (error instanceof AppError) throw error;
    throw new AppError('Geocoding service unavailable', 502);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Geocodes an address through the Nominatim proxy.
 * - Serves repeat requests from an in-memory cache (24h TTL, 1000 cap)
 * - Deduplicates identical concurrent requests (single-flight)
 * - Spaces outgoing calls >= 1000 ms apart (Nominatim 1 req/s policy)
 * - Throws AppError 404 (no results) / 502 (upstream failure)
 */
export const geocodeAddress = async (address: string): Promise<GeocodeResult> => {
  const key = normalizeAddress(address);

  const cached = cache.get(key);
  if (cached) {
    if (Date.now() - cached.ts < CACHE_TTL_MS) {
      return { lat: cached.lat, lng: cached.lng, displayName: cached.displayName };
    }
    cache.delete(key); // expired
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = fetchFromNominatim(address)
    .then(result => {
      cache.set(key, { ...result, ts: Date.now() });
      evictOldest(cache);
      return result;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
};

/**
 * Converts a GeoJSON Point (coordinates = [lng, lat]) to a plain { lat, lng }.
 * Used by the route service to snapshot customer locations (design D1/D6).
 */
export const toLatLng = (point: GeoPoint): { lat: number; lng: number } => ({
  lat: point.coordinates[1]!,
  lng: point.coordinates[0]!
});

interface NominatimReverseResponse {
  display_name?: unknown;
  address?: Record<string, unknown>;
  error?: unknown;
}

/** Returns a trimmed non-empty string, or undefined for anything else. */
const pickString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * Rounds a coordinate to ~5 decimals (~1 m precision) so taps near the same
 * spot share one cache entry without losing meaningful accuracy.
 */
const roundCoord = (value: number): number => Math.round(value * 100_000) / 100_000;

const reverseCacheKey = (lat: number, lng: number): string => `reverse:${lat},${lng}`;

/**
 * Calls the Nominatim reverse API. Throws AppError:
 * - 404 when the point cannot be resolved (no address / explicit error)
 * - 502 when the upstream request fails, times out, or returns garbage
 */
const fetchReverseFromNominatim = async (lat: number, lng: number): Promise<ReverseGeocodeResult> => {
  await waitForRateLimit();

  const url = new URL('/reverse', env.NOMINATIM_BASE_URL);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('addressdetails', '1');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': env.GEOCODE_USER_AGENT },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new AppError('Geocoding service unavailable', 502);
    }

    const data = (await response.json()) as NominatimReverseResponse;
    const address = data.address;
    if (data.error !== undefined || !address || typeof address !== 'object') {
      throw new AppError('No se pudo obtener la dirección', 404);
    }

    return {
      displayName: pickString(data.display_name),
      street: pickString(address.road),
      number: pickString(address.house_number),
      neighborhood: pickString(address.suburb) ?? pickString(address.neighbourhood),
      city:
        pickString(address.city) ??
        pickString(address.town) ??
        pickString(address.village) ??
        pickString(address.municipality),
      province: pickString(address.state),
      postalCode: pickString(address.postcode)
    };
  } catch (error) {
    // Preserve the intentional 404; anything else (network, timeout, parse) is upstream failure
    if (error instanceof AppError) throw error;
    throw new AppError('Geocoding service unavailable', 502);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Reverse-geocodes coordinates through the Nominatim proxy.
 * - Serves repeat requests from an in-memory cache (24h TTL, 1000 cap),
 *   keyed by coordinates rounded to ~5 decimals
 * - Deduplicates identical concurrent requests (single-flight)
 * - Spaces outgoing calls >= 1000 ms apart (Nominatim 1 req/s policy)
 * - Throws AppError 404 (no result) / 502 (upstream failure)
 */
export const reverseGeocode = async (lat: number, lng: number): Promise<ReverseGeocodeResult> => {
  const roundedLat = roundCoord(lat);
  const roundedLng = roundCoord(lng);
  const key = reverseCacheKey(roundedLat, roundedLng);

  const cached = reverseCache.get(key);
  if (cached) {
    if (Date.now() - cached.ts < CACHE_TTL_MS) {
      return cached.result;
    }
    reverseCache.delete(key); // expired
  }

  const pending = reverseInFlight.get(key);
  if (pending) return pending;

  const promise = fetchReverseFromNominatim(roundedLat, roundedLng)
    .then(result => {
      reverseCache.set(key, { result, ts: Date.now() });
      evictOldest(reverseCache);
      return result;
    })
    .finally(() => {
      reverseInFlight.delete(key);
    });

  reverseInFlight.set(key, promise);
  return promise;
};

/**
 * Resets the forward/reverse caches, in-flight maps, and rate-limit clock.
 * Intended for tests and hot-reload scenarios.
 */
export const resetGeocodeState = (): void => {
  cache.clear();
  inFlight.clear();
  reverseCache.clear();
  reverseInFlight.clear();
  lastRequestTimestamp = 0;
};