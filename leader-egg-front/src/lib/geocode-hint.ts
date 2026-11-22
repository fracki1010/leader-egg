import { geocode } from '../api/geocode.ts';
import type { LatLng } from '../types/index.ts';

/**
 * Best-effort: try geocoding "Ciudad, Provincia" to get an approximate
 * center for the manual map. Returns null if it fails (caller falls back
 * to default center).
 */
export async function geocodeCityProvince(city: string, province: string): Promise<LatLng | null> {
  const query = [city, province].filter(Boolean).join(', ');
  if (!query.trim()) return null;
  try {
    const result = await geocode(query);
    return { lat: result.lat, lng: result.lng };
  } catch {
    return null;
  }
}