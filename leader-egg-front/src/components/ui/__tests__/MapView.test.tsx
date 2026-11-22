// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MapView } from '../MapView.tsx';

// ─── Mocks ──────────────────────────────────────────────────────────────────
// MapView only touches react-leaflet's render API and L.divIcon /
// L.latLngBounds from leaflet — mock both so no real DOM map initializes.

// Captures the event maps registered via useMapEvents so tests can simulate clicks.
const mapEvents = vi.hoisted(() => ({
  handlers: [] as Array<Record<string, (e: { latlng: { lat: number; lng: number } }) => void>>,
}));

vi.mock('react-leaflet', async () => {
  const React = await import('react');
  return {
    MapContainer: ({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) =>
      React.createElement('div', { 'data-testid': 'map-container', style }, children),
    TileLayer: () => React.createElement('div', { 'data-testid': 'tile-layer' }),
    Marker: ({ position, icon }: { position: [number, number]; icon: { options: { html: string } } }) =>
      React.createElement(
        'div',
        { 'data-testid': `marker-${position[0]},${position[1]}`, 'data-icon-html': icon.options.html },
      ),
    Polyline: ({ positions }: { positions: [number, number][] }) =>
      React.createElement('div', { 'data-testid': 'polyline', 'data-points': positions.length }),
    useMap: () => ({ setView: vi.fn(), fitBounds: vi.fn(), getZoom: () => 13 }),
    useMapEvents: (events: Record<string, (e: { latlng: { lat: number; lng: number } }) => void>) => {
      mapEvents.handlers.push(events);
    },
  };
});

vi.mock('leaflet', () => ({
  default: {
    divIcon: vi.fn((options: unknown) => ({ options })),
    latLngBounds: vi.fn((points: unknown) => ({ points })),
  },
}));

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('MapView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mapEvents.handlers.length = 0;
  });

  it('renders a "Sin coordenadas" placeholder for empty markers (no crash)', () => {
    render(<MapView markers={[]} />);
    expect(screen.getByText('Sin coordenadas')).toBeDefined();
    expect(screen.queryByTestId('map-container')).toBeNull();
  });

  it('renders a single marker with sequence number 1 when no label is given', () => {
    render(<MapView markers={[{ lat: -31.4135, lng: -64.1811 }]} />);
    expect(screen.getByTestId('map-container')).toBeDefined();
    const marker = screen.getByTestId('marker--31.4135,-64.1811');
    expect(marker).toBeDefined();
    expect(marker.getAttribute('data-icon-html')).toContain('>1</div>');
  });

  it('increases the provided map height by 30 percent', () => {
    render(<MapView markers={[{ lat: -31.4135, lng: -64.1811 }]} height={320} />);
    expect(screen.getByTestId('map-container').style.height).toBe('416px');
  });

  it('uses the provided label in the marker icon', () => {
    render(<MapView markers={[{ lat: -31.4, lng: -64.18, label: 'A' }]} />);
    expect(screen.getByTestId('marker--31.4,-64.18').getAttribute('data-icon-html')).toContain('>A</div>');
  });

  it('renders all markers in sequence for multiple markers', () => {
    render(
      <MapView
        markers={[
          { lat: -31.4135, lng: -64.1811 },
          { lat: -31.3985, lng: -64.1642 },
        ]}
      />,
    );
    expect(screen.getByTestId('marker--31.4135,-64.1811')).toBeDefined();
    expect(screen.getByTestId('marker--31.3985,-64.1642')).toBeDefined();
  });

  it('renders a polyline when given 2+ ordered points', () => {
    render(
      <MapView
        markers={[
          { lat: -31.4135, lng: -64.1811 },
          { lat: -31.3985, lng: -64.1642 },
          { lat: -31.4312, lng: -64.1876 },
        ]}
        polyline={[
          { lat: -31.4135, lng: -64.1811 },
          { lat: -31.3985, lng: -64.1642 },
        ]}
      />,
    );
    const polyline = screen.getByTestId('polyline');
    expect(polyline).toBeDefined();
    expect(polyline.getAttribute('data-points')).toBe('2');
  });

  it('does not render a polyline for fewer than 2 points', () => {
    render(<MapView markers={[{ lat: -31.4135, lng: -64.1811 }]} polyline={[{ lat: -31.4135, lng: -64.1811 }]} />);
    expect(screen.queryByTestId('polyline')).toBeNull();
  });

  // ── Selectable mode ────────────────────────────────────────────────────────

  it('renders the map + hint chip in selectable mode with no selection yet', () => {
    render(<MapView markers={[]} selectable onSelect={vi.fn()} />);
    expect(screen.getByTestId('map-container')).toBeDefined();
    expect(screen.getByText('Tocá el mapa para marcar la dirección')).toBeDefined();
  });

  it('uses the provided selectHint text', () => {
    render(<MapView markers={[]} selectable selectHint="Tocá el mapa para marcar la dirección del cliente" onSelect={vi.fn()} />);
    expect(screen.getByText('Tocá el mapa para marcar la dirección del cliente')).toBeDefined();
  });

  it('fires onSelect with the clicked coordinates when selectable', () => {
    const onSelect = vi.fn();
    render(<MapView markers={[]} selectable onSelect={onSelect} />);
    const handler = mapEvents.handlers[0];
    expect(handler).toBeDefined();
    handler?.click?.({ latlng: { lat: -31.42, lng: -64.19 } });
    expect(onSelect).toHaveBeenCalledWith({ lat: -31.42, lng: -64.19 });
  });

  it('does not register a click handler when not selectable', () => {
    render(<MapView markers={[{ lat: -31.4135, lng: -64.1811 }]} />);
    expect(mapEvents.handlers.length).toBe(0);
  });

  it('renders the selected marker as a distinct highlighted pin', () => {
    render(
      <MapView
        markers={[]}
        selectable
        selectedMarker={{ lat: -31.42, lng: -64.19 }}
        onSelect={vi.fn()}
      />,
    );
    const marker = screen.getByTestId('marker--31.42,-64.19');
    expect(marker.getAttribute('data-icon-html')).toContain('mapview-selected-pin');
  });

  it('hides the hint chip once a point is selected', () => {
    render(
      <MapView
        markers={[]}
        selectable
        selectedMarker={{ lat: -31.42, lng: -64.19 }}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByText('Tocá el mapa para marcar la dirección')).toBeNull();
  });
});