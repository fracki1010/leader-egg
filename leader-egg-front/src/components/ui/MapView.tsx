import { useEffect, type ReactNode } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import { m3Shape } from '../../theme/index.ts';
import { IconMyLocation } from './icons.tsx';

/* ── Types ──────────────────────────────────── */

export type MapMarkerKind = 'pending' | 'current' | 'delivered';

export interface MapMarker {
  lat: number;
  lng: number;
  label?: string;
  /** Pin visual state — default 'pending' (peach, numbered pin). */
  kind?: MapMarkerKind;
}

export interface MapViewProps {
  markers: MapMarker[];
  /** Ordered trace — rendered as a straight-line polyline (MVP). */
  polyline?: MapMarker[];
  height?: number;
  center?: { lat: number; lng: number };
  zoom?: number;
  /** Enable click-to-set mode: every map click fires `onSelect`. */
  selectable?: boolean;
  /** Current manual selection — rendered as a distinct highlighted pin. */
  selectedMarker?: MapMarker | null;
  /** Fired on map click when `selectable` (receives the clicked point). */
  onSelect?: (marker: MapMarker) => void;
  /** Hint text shown as a chip when `selectable` and no selection yet. */
  selectHint?: string;
  /** Renders a translucent "GPS recenter" button (top-right) that flies
   *  back to the full set of markers. */
  recenterControl?: boolean;
  /** Arbitrary overlay content rendered above the map (floating bars…). */
  overlay?: ReactNode;
}

/* ── Helpers ────────────────────────────────── */

const DEFAULT_ZOOM = 15;
const PIN_SIZE = 36;
const SELECTED_PIN_SIZE = 44;
/** Fallback viewport for selectable maps before any point exists. */
const DEFAULT_CENTER: MapMarker = { lat: -31.4201, lng: -64.1888 }; // Córdoba, Argentina

const toLatLng = (point: { lat: number; lng: number }): [number, number] => [point.lat, point.lng];

/**
 * Custom divIcon (D5): colored dot + sequence number. Uses M3 tokens via
 * CSS variables so it follows light/dark themes, and avoids Leaflet's
 * default marker PNGs entirely (no bundler icon-path issues, offline-safe).
 *
 * `kind` drives the pin color:
 * - pending   → peach (primaryContainer) numbered pin
 * - current   → orange (primary.main) numbered pin + pulsing ring
 * - delivered → green (secondary.main) numbered pin
 */
function makePinIcon(label: string, kind: MapMarkerKind = 'pending'): L.DivIcon {
  const isCurrent = kind === 'current';
  const isDelivered = kind === 'delivered';
  const bg = isCurrent
    ? 'var(--mui-palette-primary-main)'
    : isDelivered
      ? 'var(--mui-palette-secondary-main)'
      : 'var(--mui-palette-primaryContainer)';
  const fg = isCurrent || isDelivered ? '#fff' : 'var(--mui-palette-onPrimaryContainer)';
  const pulse =
    isCurrent
      ? `<style>@keyframes mapview-pin-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--mui-palette-primary-main) 45%,transparent)}70%{box-shadow:0 0 0 12px transparent}100%{box-shadow:0 0 0 0 transparent}}.mapview-pin-current{animation:mapview-pin-pulse 1.8s ease-out infinite}</style>`
      : '';
  return L.divIcon({
    className: 'mapview-pin',
    html: `${pulse}<div class="${isCurrent ? 'mapview-pin-current' : ''}" style="display:flex;align-items:center;justify-content:center;width:${PIN_SIZE}px;height:${PIN_SIZE}px;border-radius:10px;background:${bg};color:${fg};font-family:var(--font-mono);font-weight:700;font-size:15px;line-height:1;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35)">${label}</div>`,
    iconSize: [PIN_SIZE, PIN_SIZE],
    iconAnchor: [PIN_SIZE / 2, PIN_SIZE / 2],
  });
}

/**
 * Distinct pin for the manual selection: a larger primary/main circle with
 * a check glyph — visually different from the numbered route pins.
 */
function makeSelectedPinIcon(): L.DivIcon {
  return L.divIcon({
    className: 'mapview-selected-pin',
    html: `<div class="mapview-selected-pin" style="display:flex;align-items:center;justify-content:center;width:${SELECTED_PIN_SIZE}px;height:${SELECTED_PIN_SIZE}px;border-radius:12px;background:var(--mui-palette-primary-main);color:var(--mui-palette-onPrimary);border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.4)"><svg viewBox="0 0 448 512" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z"/></svg></div>`,
    iconSize: [SELECTED_PIN_SIZE, SELECTED_PIN_SIZE],
    iconAnchor: [SELECTED_PIN_SIZE / 2, SELECTED_PIN_SIZE / 2],
  });
}

/** Fits the viewport to all markers (with padding) once bounds change. */
function FitBounds({ points }: { points: MapMarker[] }) {
  const map = useMap();
  const boundsKey = points.map((p) => `${p.lat},${p.lng}`).join('|');

  useEffect(() => {
    if (points.length === 1) {
      map.setView(toLatLng(points[0]!), Math.max(map.getZoom(), DEFAULT_ZOOM));
    } else if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points.map(toLatLng)), { padding: [24, 24] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boundsKey serializes points
  }, [map, boundsKey]);

  return null;
}

/** Bridges Leaflet `click` events to `onSelect` when the map is selectable. */
function ClickToSelect({ onSelect }: { onSelect: (marker: MapMarker) => void }) {
  useMapEvents({
    click(e) {
      onSelect({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

/** Floating "GPS recenter" button — flies back to fit all route points. */
function RecenterControl({ points }: { points: MapMarker[] }) {
  const map = useMap();
  return (
    <Box sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1000 }}>
      <IconButton
        size="small"
        aria-label="Centrar mapa en la ruta"
        onClick={() => {
          if (points.length === 1) {
            map.flyTo(toLatLng(points[0]!), Math.max(map.getZoom(), DEFAULT_ZOOM));
          } else if (points.length > 1) {
            map.flyToBounds(L.latLngBounds(points.map(toLatLng)), { padding: [24, 24] });
          }
        }}
        sx={{
          width: 36,
          height: 36,
          bgcolor: 'rgba(255, 255, 255, 0.92)',
          backdropFilter: 'blur(4px)',
          color: 'onSurfaceVariant',
          border: 1,
          borderColor: 'outlineVariant',
          boxShadow: 2,
          '&:hover': { bgcolor: '#fff', color: 'primary.main' },
        }}
      >
        <IconMyLocation size={18} />
      </IconButton>
    </Box>
  );
}

/* ── MapView ────────────────────────────────── */

/**
 * Reusable Leaflet map. Renders numbered M3-styled markers, an optional
 * straight-line polyline, and a subtle "Sin coordenadas" placeholder when
 * there are no markers (V1 — must not crash with zero markers).
 *
 * `selectable` enables click-to-set mode: the map always renders (even with
 * zero markers) so the user can click to place a point, fires `onSelect` on
 * every click, shows a hint chip until a point exists, and renders
 * `selectedMarker` as a distinct highlighted pin.
 */
export function MapView({
  markers,
  polyline,
  height = 240,
  center,
  zoom = DEFAULT_ZOOM,
  selectable = false,
  selectedMarker = null,
  onSelect,
  selectHint,
  recenterControl = false,
  overlay,
}: MapViewProps) {
  const mapHeight = Math.round(height * 1.3);

  // Read-only maps with no markers show the placeholder. Selectable maps must
  // always render the real map so the user can click to place a point.
  // NOTE: no Leaflet-context children (RecenterControl, etc.) may be rendered
  // here — there is no <MapContainer>, so useMap() would throw.
  if (!selectable && markers.length === 0) {
    return (
      <Box
        sx={{
          height: mapHeight,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: m3Shape.medium,
          border: 1,
          borderColor: 'outlineVariant',
          bgcolor: 'surfaceContainerLow',
          position: 'relative',
        }}
      >
        <Typography variant="body2" color="onSurfaceVariant">
          Sin coordenadas
        </Typography>
      </Box>
    );
  }

  const centerPoint: [number, number] = center
    ? toLatLng(center)
    : markers.length > 0
      ? toLatLng(markers[0]!)
      : selectedMarker
        ? toLatLng(selectedMarker)
        : toLatLng(DEFAULT_CENTER);

  const polylinePoints: [number, number][] = polyline?.map(toLatLng) ?? [];
  const effectiveMarkers = selectedMarker ? [...markers, selectedMarker] : markers;

  return (
    <Box
      sx={{
        position: 'relative',
        isolation: 'isolate', // contain Leaflet panes' z-index inside this card
        borderRadius: '16px',
        overflow: 'hidden',
        border: 1,
        borderColor: 'outlineVariant',
      }}
    >
      <MapContainer center={centerPoint} zoom={zoom} style={{ height: mapHeight, width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {selectable && onSelect && <ClickToSelect onSelect={onSelect} />}
        {(effectiveMarkers.length > 1 || (selectable && effectiveMarkers.length === 1)) && (
          <FitBounds points={effectiveMarkers} />
        )}
        {markers.map((marker, index) => (
          <Marker
            key={`${marker.lat},${marker.lng}-${index}`}
            position={toLatLng(marker)}
            icon={makePinIcon(marker.label ?? String(index + 1), marker.kind ?? 'pending')}
          />
        ))}
        {selectedMarker && (
          <Marker
            key={`selected-${selectedMarker.lat},${selectedMarker.lng}`}
            position={toLatLng(selectedMarker)}
            icon={makeSelectedPinIcon()}
          />
        )}
        {polylinePoints.length > 1 && (
          <Polyline
            positions={polylinePoints}
            pathOptions={{ color: 'var(--mui-palette-primary-main)', weight: 3, opacity: 0.85 }}
          />
        )}
        {/* GPS recenter button — MUST live inside <MapContainer> (useMap context) */}
        {recenterControl && <RecenterControl points={markers} />}
      </MapContainer>

      {/* Custom overlay slot (floating bars, chips…) — pure CSS, no Leaflet hooks */}
      {overlay}

      {/* Hint overlay — translucent M3 chip until the user places a point */}
      {selectable && !selectedMarker && (
        <Box
          sx={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            pointerEvents: 'none',
            maxWidth: 'calc(100% - 32px)',
          }}
        >
          <Chip
            label={selectHint ?? 'Tocá el mapa para marcar la dirección'}
            size="small"
            sx={{
              bgcolor: 'rgba(0, 0, 0, 0.7)',
              color: '#fff',
              backdropFilter: 'blur(4px)',
              fontWeight: 500,
              '& .MuiChip-label': { px: 1.5 },
            }}
          />
        </Box>
      )}
    </Box>
  );
}