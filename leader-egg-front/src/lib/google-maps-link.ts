import type { LatLng } from '../types/index.ts';

const DIRECTIONS_BASE = 'https://www.google.com/maps/dir/?api=1';
const QUERY_BASE = 'https://www.google.com/maps?q=';
/** Google Maps directions URLs accept up to 10 waypoints. */
const MAX_WAYPOINTS = 10;

const fmt = (point: LatLng): string => `${point.lat},${point.lng}`;

/**
 * Build a Google Maps URL for a sequence of coordinates.
 *
 * - 0 points      → null (caller should disable the action)
 * - 1 point       → https://www.google.com/maps?q=lat,lng (single pin)
 * - 2 points      → dir URL with origin + destination
 * - 3+ points     → dir URL with origin + pipe-separated waypoints + destination
 *                   (waypoints capped at MAX_WAYPOINTS)
 *
 * Google computes the real road path server-side, so the map polyline can
 * stay straight-line (MVP) while navigation stays accurate.
 */
export function buildDirectionsUrl(
  origin?: LatLng | null,
  destination?: LatLng | null,
  waypoints: LatLng[] = [],
): string | null {
  const points: LatLng[] = [];
  if (origin) points.push(origin);
  for (const waypoint of waypoints) {
    if (waypoint) points.push(waypoint);
  }
  if (destination) points.push(destination);

  if (points.length === 0) return null;
  if (points.length === 1) return `${QUERY_BASE}${fmt(points[0]!)}`;

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const middles = points.slice(1, -1).slice(0, MAX_WAYPOINTS);

  const url = `${DIRECTIONS_BASE}&origin=${fmt(first)}&destination=${fmt(last)}`;
  if (middles.length > 0) {
    return `${url}&waypoints=${middles.map(fmt).join('|')}`;
  }
  return url;
}