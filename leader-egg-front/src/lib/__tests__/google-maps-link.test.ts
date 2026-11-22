import { describe, it, expect } from 'vitest';
import { buildDirectionsUrl } from '../google-maps-link.ts';
import type { LatLng } from '../../types/index.ts';

const p1: LatLng = { lat: -31.4135, lng: -64.1811 }; // Córdoba
const p2: LatLng = { lat: -31.3985, lng: -64.1642 };
const p3: LatLng = { lat: -31.4312, lng: -64.1876 };
const p4: LatLng = { lat: -31.4203, lng: -64.2012 };
const p5: LatLng = { lat: -31.4048, lng: -64.1687 };

describe('buildDirectionsUrl', () => {
  it('returns null when there are no points', () => {
    expect(buildDirectionsUrl()).toBeNull();
    expect(buildDirectionsUrl(null, null, [])).toBeNull();
  });

  it('builds a plain ?q= URL for a single point', () => {
    expect(buildDirectionsUrl(p1)).toBe('https://www.google.com/maps?q=-31.4135,-64.1811');
    // destination-only also counts as a single point
    expect(buildDirectionsUrl(null, p2)).toBe('https://www.google.com/maps?q=-31.3985,-64.1642');
  });

  it('builds origin + destination for two points (no waypoints param)', () => {
    const url = buildDirectionsUrl(p1, p2);
    expect(url).toBe(
      'https://www.google.com/maps/dir/?api=1&origin=-31.4135,-64.1811&destination=-31.3985,-64.1642',
    );
    expect(url).not.toContain('waypoints');
  });

  it('builds origin + pipe-separated waypoints + destination for 3+ points', () => {
    const url = buildDirectionsUrl(p1, p3, [p2]);
    expect(url).toBe(
      'https://www.google.com/maps/dir/?api=1&origin=-31.4135,-64.1811&destination=-31.4312,-64.1876&waypoints=-31.3985,-64.1642',
    );
  });

  it('keeps stop order: middle points become waypoints in sequence', () => {
    const url = buildDirectionsUrl(p1, p5, [p2, p3, p4]);
    expect(url).toBe(
      'https://www.google.com/maps/dir/?api=1&origin=-31.4135,-64.1811&destination=-31.4048,-64.1687&waypoints=-31.3985,-64.1642|-31.4312,-64.1876|-31.4203,-64.2012',
    );
  });

  it('caps waypoints at 10 (extra middle stops are dropped, last stays destination)', () => {
    const middle: LatLng[] = Array.from({ length: 14 }, (_, i) => ({
      lat: -31.4 - i * 0.001,
      lng: -64.18 - i * 0.001,
    }));
    const url = buildDirectionsUrl(p1, p5, middle)!;
    const waypointsParam = url.split('waypoints=')[1]!;
    expect(waypointsParam.split('|')).toHaveLength(10);
    // destination precedes waypoints (spec V4 order), so it must appear right before them
    expect(url).toContain(`&destination=${fmt(p5)}&waypoints=`);
    expect(url.startsWith('https://www.google.com/maps/dir/?api=1&origin=-31.4135,-64.1811&')).toBe(true);
  });
});

function fmt(p: LatLng): string {
  return `${p.lat},${p.lng}`;
}