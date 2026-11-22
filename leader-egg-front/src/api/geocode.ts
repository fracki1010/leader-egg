import { api } from './client.ts';
import type { GeocodeResult, ReverseGeocodeResult } from '../types/index.ts';

/**
 * Resolve an address to coordinates via POST /v1/geocode
 * (backend proxies Nominatim with cache + rate limit).
 *
 * Errors: ApiError 400 (malformed), 404 "No se pudo geocodificar la
 * dirección" (unknown address), 502 (upstream Nominatim failure).
 */
export async function geocode(address: string): Promise<GeocodeResult> {
  return api.post<GeocodeResult>('/v1/geocode', { address });
}

/**
 * Resolve coordinates to a structured address via POST /v1/geocode/reverse
 * (backend proxies Nominatim with cache + rate limit).
 *
 * Errors: ApiError 400 (invalid coordinates), 404 "No se pudo obtener la
 * dirección" (no result for the point), 502 (upstream Nominatim failure).
 */
export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult> {
  return api.post<ReverseGeocodeResult>('/v1/geocode/reverse', { lat, lng });
}