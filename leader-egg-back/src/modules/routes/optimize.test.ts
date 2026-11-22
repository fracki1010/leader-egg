import { describe, it, expect } from 'vitest';
import {
  haversineDistance,
  nearestNeighborOrder,
  type NearestNeighborStop
} from './service.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const stop = (
  id: string,
  sequence: number,
  location?: { lat: number; lng: number }
): NearestNeighborStop => ({ _id: id, sequence, location });

// ─── haversineDistance ────────────────────────────────────────────────────────

describe('haversineDistance', () => {
  it('returns ~0 for the same point', () => {
    expect(haversineDistance({ lat: -34.6, lng: -58.4 }, { lat: -34.6, lng: -58.4 })).toBe(0);
  });

  it('returns ~111.2 km per degree of latitude', () => {
    const distance = haversineDistance({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(distance).toBeGreaterThan(110_000);
    expect(distance).toBeLessThan(112_000);
  });

  it('is symmetric', () => {
    const a = { lat: -31.4201, lng: -64.1888 };
    const b = { lat: -34.6037, lng: -58.3816 };
    expect(haversineDistance(a, b)).toBeCloseTo(haversineDistance(b, a), 6);
  });
});

// ─── nearestNeighborOrder ─────────────────────────────────────────────────────

describe('nearestNeighborOrder', () => {
  it('orders 3 located stops by proximity from the start point', () => {
    // start (0,0) → B (0,0.5 ≈ 55km) → A (0,1 ≈ 55km) → C (10,10 far)
    const stops = [
      stop('a', 1, { lat: 0, lng: 1 }),
      stop('b', 2, { lat: 0, lng: 0.5 }),
      stop('c', 3, { lat: 10, lng: 10 })
    ];
    expect(nearestNeighborOrder(stops, { lat: 0, lng: 0 })).toEqual(['b', 'a', 'c']);
  });

  it('walks nearest-first: start closer to a later stop still picks it first', () => {
    const stops = [
      stop('near', 1, { lat: 0, lng: 0.1 }), // ~11km from start
      stop('far', 2, { lat: 0, lng: 5 }), // ~555km from start
      stop('mid', 3, { lat: 0, lng: 2 }) // ~222km from start
    ];
    expect(nearestNeighborOrder(stops, { lat: 0, lng: 0 })).toEqual(['near', 'mid', 'far']);
  });

  it('appends stops without location at the end, keeping relative order', () => {
    const stops = [
      stop('located-a', 1, { lat: 0, lng: 1 }),
      stop('no-loc-1', 2),
      stop('located-b', 3, { lat: 0, lng: 0.5 }),
      stop('no-loc-2', 4)
    ];
    const result = nearestNeighborOrder(stops, { lat: 0, lng: 0 });
    expect(result).toEqual(['located-b', 'located-a', 'no-loc-1', 'no-loc-2']);
  });

  it('returns empty array for no stops', () => {
    expect(nearestNeighborOrder([], { lat: 0, lng: 0 })).toEqual([]);
  });

  it('keeps only-located stops ordered among themselves', () => {
    const stops = [
      stop('a', 1, { lat: 10, lng: 10 }),
      stop('b', 2, { lat: 0, lng: 0 })
    ];
    expect(nearestNeighborOrder(stops, { lat: 0, lng: 0 })).toEqual(['b', 'a']);
  });
});