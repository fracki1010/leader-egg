import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { keyframes } from '@emotion/react';
import { buildDirectionsUrl } from '../lib/google-maps-link.ts';
import type { PaymentStatus, RouteStatus, RouteStop } from '../types/index.ts';
import { useRoute, useOrders } from '../hooks/queries/index.ts';
import {
  useAddStop,
  useRemoveStop,
  useOptimizeRoute,
  useStartRoute,
  useCompleteRoute,
  useCancelRoute,
  useAdvanceStop,
} from '../hooks/mutations/index.ts';
import { isOfflineQueuedError } from '../hooks/use-offline-mutation.ts';
import { useSmartBack } from '../hooks/useSmartBack.ts';
import { m3Shape } from '../theme/index.ts';
import {
  MuiButton,
  MuiChip,
  MuiTextField,
  MuiCard,
  MuiDialog,
  LoadingState,
  MapView,
  type MapMarker,
} from '../components/ui/index.ts';
import {
  IconArrowBack,
  IconBox,
  IconCheck,
  IconCircleCheck,
  IconCustomer,
  IconDelete,
  IconEgg,
  IconLocation,
  IconMapPin,
  IconMyLocation,
  IconOrder,
  IconPhone,
  IconPlay,
  IconPlus,
  IconRoute,
  IconSkip,
  IconSwapVert,
  IconTruck,
  IconX,
  IconCar,
} from '../components/ui/icons.tsx';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import InputAdornment from '@mui/material/InputAdornment';

/* ── Config ─────────────────────────────────── */

const routeStatusConfig: Record<RouteStatus, { label: string; color: 'primary' | 'warning' | 'success' | 'error' }> = {
  planned: { label: 'Planificada', color: 'primary' },
  in_progress: { label: 'En Progreso', color: 'warning' },
  completed: { label: 'Completada', color: 'success' },
  cancelled: { label: 'Cancelada', color: 'error' },
};

const paymentStatusConfig: Record<PaymentStatus, { label: string; color: 'success' | 'warning' | 'error' }> = {
  paid: { label: 'Pagado', color: 'success' },
  partial: { label: 'Parcial', color: 'warning' },
  unpaid: { label: 'Impago', color: 'error' },
};

const fmtMoney = (val: number) => `$ ${val.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });

const fmtDateLong = (dateStr: string) =>
  new Date(dateStr + 'T00:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const fmtDateShort = (dateStr: string) =>
  new Date(dateStr + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });

const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join('');

/* ── Pulsing dots (live states) ─────────────── */

const pulsePrimary = keyframes`
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--mui-palette-primary-main) 40%, transparent); }
  70% { box-shadow: 0 0 0 8px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
`;

const pulseSuccess = keyframes`
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--mui-palette-success-main) 45%, transparent); }
  70% { box-shadow: 0 0 0 8px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
`;

/* ── Link action button (tel: / maps URLs) ──── */

function LinkActionButton({ href, icon, children }: { href?: string | null; icon: ReactNode; children: ReactNode }) {
  if (!href) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
          minHeight: 44,
          px: 2,
          borderRadius: m3Shape.medium,
          bgcolor: 'surfaceContainer',
          color: 'onSurfaceVariant',
          opacity: 0.55,
          fontWeight: 600,
          fontSize: '0.875rem',
        }}
      >
        {icon}
        {children}
      </Box>
    );
  }
  return (
    <Box
      component="a"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        minHeight: 44,
        px: 2,
        borderRadius: m3Shape.medium,
        bgcolor: 'surfaceContainer',
        color: 'onSurface',
        fontWeight: 600,
        fontSize: '0.875rem',
        letterSpacing: '0.01em',
        textDecoration: 'none',
        cursor: 'pointer',
        transition: 'background-color 0.15s, transform 0.12s',
        '&:hover': { bgcolor: 'surfaceContainerHigh' },
        '&:active': { transform: 'scale(0.97)' },
      }}
    >
      {icon}
      {children}
    </Box>
  );
}

/* ── Timeline stop card ─────────────────────── */

interface TimelineStopCardProps {
  stop: RouteStop;
  isCurrent: boolean;
  /** Green flash ring right after this stop was confirmed delivered. */
  flash: boolean;
  /** Route is in_progress → show deliver/skip actions. */
  canMutate: boolean;
  /** Route is planned → show remove action. */
  canRemove: boolean;
  busy: boolean;
  onAdvance: (stop: RouteStop, to: 'in_transit' | 'delivered' | 'skipped') => void;
  onRemove: (stop: RouteStop) => void;
}

function TimelineStopCard({ stop, isCurrent, flash, canMutate, canRemove, busy, onAdvance, onRemove }: TimelineStopCardProps) {
  const isDelivered = stop.status === 'delivered';
  const isSkipped = stop.status === 'skipped';
  const isInTransit = stop.status === 'in_transit';
  const isPending = stop.status === 'pending';

  /* Leading circle */
  const circleContent = isDelivered ? (
    <IconCheck size={20} color="#fff" />
  ) : isSkipped ? (
    <IconX size={18} color="var(--mui-palette-onSurfaceVariant)" />
  ) : (
    <Typography
      variant="body2"
      sx={{
        fontFamily: 'var(--font-mono)',
        fontWeight: 800,
        fontVariantNumeric: 'tabular-nums',
        color: isCurrent ? '#fff' : 'onSurfaceVariant',
      }}
    >
      {stop.sequence}
    </Typography>
  );
  const circleSx = isDelivered
    ? { bgcolor: 'secondary.main', color: '#fff' }
    : isSkipped
      ? { bgcolor: 'surfaceContainerHighest', color: 'onSurfaceVariant', opacity: 0.75 }
      : isCurrent
        ? {
            bgcolor: 'primary.main',
            color: '#fff',
            boxShadow: '0 0 0 4px color-mix(in srgb, var(--mui-palette-primary-main) 22%, transparent)',
            animation: `${pulsePrimary} 2s ease-out infinite`,
          }
        : { bgcolor: 'surfaceContainer', color: 'onSurfaceVariant' };

  /* Status chip */
  const tone = isDelivered
    ? { bg: 'secondaryFixed', fg: 'onSecondaryFixed', label: stop.deliveredAt ? `Entregado ${fmtTime(stop.deliveredAt)}` : 'Entregado' }
    : isInTransit
      ? { bg: 'primaryFixed', fg: 'onPrimaryFixed', label: 'En Camino', live: true }
      : isSkipped
        ? { bg: 'surfaceContainerHighest', fg: 'onSurfaceVariant', label: 'Salteado' }
        : { bg: 'surfaceContainer', fg: 'onSurfaceVariant', label: 'Pendiente' };

  /* Footer: maples (no item data on stops → "—") + payment line */
  const paymentLine = isDelivered ? (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'success.main', fontWeight: 700, fontSize: '0.75rem' }}>
      <IconCircleCheck size={14} /> Recibido
    </Box>
  ) : isSkipped ? (
    <Box component="span" sx={{ color: 'onSurfaceVariant', fontWeight: 600, fontSize: '0.75rem' }}>—</Box>
  ) : (
    <Box
      component="span"
      sx={{
        fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        fontSize: '0.75rem',
        color: 'onSurface',
      }}
    >
      #{stop.orderNumber}
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', gap: 2, position: 'relative' }}>
      {/* Leading circle */}
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          flexShrink: 0,
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...circleSx,
        }}
      >
        {circleContent}
      </Box>

      {/* Card */}
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          bgcolor: isCurrent
            ? 'color-mix(in srgb, var(--mui-palette-primary-main) 5%, var(--mui-palette-surfaceContainerLowest))'
            : 'surfaceContainerLowest',
          border: 1,
          borderColor: isCurrent
            ? 'color-mix(in srgb, var(--mui-palette-primary-main) 40%, transparent)'
            : 'outlineVariant',
          borderRadius: '16px',
          boxShadow: flash
            ? '0 0 0 2px var(--mui-palette-secondary-main), 0 4px 14px rgba(0,0,0,0.08)'
            : 1,
          p: 2,
          transition: 'box-shadow 0.2s',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5 }}>
          <Typography
            variant="titleMedium"
            sx={{ fontWeight: 700, color: 'onSurface', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
          >
            {stop.customerName}
          </Typography>
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              px: 1.25,
              py: 0.4,
              borderRadius: 9999,
              bgcolor: tone.bg,
              color: tone.fg,
              fontSize: '0.75rem',
              fontWeight: 700,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {tone.live && (
              <Box
                component="span"
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: 'currentColor',
                  display: 'inline-block',
                  animation: `${pulsePrimary} 1.6s ease-out infinite`,
                }}
              />
            )}
            {tone.label}
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.5, minWidth: 0 }}>
          <IconLocation size={14} color="var(--mui-palette-onSurfaceVariant)" />
          <Typography variant="body2" color="onSurfaceVariant" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {stop.customerAddress}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'outlineVariant' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            <IconEgg size={14} color="var(--mui-palette-onSurfaceVariant)" />
            <Box component="span" sx={{ color: 'onSurfaceVariant', fontSize: '0.75rem', fontWeight: 600 }}>—</Box>
          </Box>
          <Box sx={{ ml: 'auto', flexShrink: 0 }}>{paymentLine}</Box>
        </Box>

        {/* Actions */}
        {(canMutate && (isPending || isInTransit)) || (canRemove && isPending) ? (
          <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
            {canMutate && isPending && (
              <MuiButton
                variant="secondary"
                size="sm"
                disabled={busy}
                startIcon={<IconPlay size={14} />}
                onClick={() => onAdvance(stop, 'in_transit')}
                sx={{ bgcolor: 'primary.main', color: '#fff', '&:hover': { bgcolor: 'primary.dark' } }}
              >
                En Camino
              </MuiButton>
            )}
            {canMutate && isInTransit && (
              <MuiButton
                variant="secondary"
                size="sm"
                disabled={busy}
                startIcon={<IconCheck size={14} />}
                onClick={() => onAdvance(stop, 'delivered')}
                sx={{ bgcolor: 'secondary.main', color: '#fff', '&:hover': { bgcolor: 'secondary.dark' } }}
              >
                Entregar
              </MuiButton>
            )}
            {canMutate && (isPending || isInTransit) && (
              <MuiButton
                variant="ghost"
                size="sm"
                disabled={busy}
                startIcon={<IconSkip size={14} />}
                onClick={() => onAdvance(stop, 'skipped')}
                sx={{ color: 'error.main' }}
              >
                Saltear
              </MuiButton>
            )}
            {canRemove && isPending && (
              <MuiButton
                variant="ghost"
                size="sm"
                onClick={() => onRemove(stop)}
                sx={{ color: 'error.main', ml: 'auto' }}
                startIcon={<IconDelete size={14} />}
              >
                Quitar
              </MuiButton>
            )}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

/* ── RouteDetailPage ────────────────────────── */

export function RouteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const goBack = useSmartBack('/routes');

  // Reads — the route detail + the pending-order pool for the add-stop
  // selector. Route mutations invalidate both, so the page refetches.
  const routeQuery = useRoute(id);
  const pendingOrdersQuery = useOrders({ status: 'pending', limit: 200 });
  const route = routeQuery.data ?? null;
  const loading = routeQuery.isLoading;

  const queryError = routeQuery.error;
  const loadError = queryError
    ? queryError instanceof Error
      ? queryError.message
      : 'Error al cargar ruta'
    : null;
  /** Action errors (remove stop / advance / start / cancel / complete). */
  const [actionError, setActionError] = useState<string | null>(null);
  const error = loadError ?? actionError;

  // Writes — offline-aware; all invalidate routes + orders.
  const addStop = useAddStop();
  const removeStop = useRemoveStop();
  const optimizeRoute = useOptimizeRoute();
  const startRoute = useStartRoute();
  const completeRoute = useCompleteRoute();
  const cancelRoute = useCancelRoute();
  const advanceStop = useAdvanceStop();
  const actionLoading =
    addStop.isPending ||
    removeStop.isPending ||
    optimizeRoute.isPending ||
    startRoute.isPending ||
    completeRoute.isPending ||
    cancelRoute.isPending ||
    advanceStop.isPending;
  const optimizing = optimizeRoute.isPending;

  /** Stop currently being confirmed from the NEXT STOP CARD. */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  /** Just-delivered stop id — brief green flash on its timeline card. */
  const [flashId, setFlashId] = useState<string | null>(null);

  // Add stop modal
  const [showAddStop, setShowAddStop] = useState(false);
  const [addStopOrderId, setAddStopOrderId] = useState('');
  const [addStopError, setAddStopError] = useState<string | null>(null);

  // Available orders for the "Agregar Parada" selector (pending, unassigned)
  const allPendingOrders = pendingOrdersQuery.data?.items ?? [];
  const availableOrders = allPendingOrders
    .filter((o) => !o.routeId && o.status !== 'cancelled' && o.status !== 'delivered')
    .sort((a, b) => a.orderNumber.localeCompare(b.orderNumber, undefined, { numeric: true }));
  const ordersLoading = pendingOrdersQuery.isLoading;
  const ordersQueryError = pendingOrdersQuery.error;
  const ordersError = ordersQueryError
    ? ordersQueryError instanceof Error
      ? ordersQueryError.message
      : 'Error al cargar órdenes'
    : null;

  // Optimize route modal — start point: geolocation or map pick
  const [showOptimize, setShowOptimize] = useState(false);
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [optimizeStart, setOptimizeStart] = useState<{ lat: number; lng: number } | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);

  const openAddStopDialog = () => {
    setAddStopOrderId('');
    setAddStopError(null);
    setShowAddStop(true);
    void pendingOrdersQuery.refetch();
  };

  const handleStartRoute = () => {
    if (!route) return;
    startRoute.mutate(route._id, {
      onError: (err) => {
        if (isOfflineQueuedError(err)) return;
        setActionError(err instanceof Error ? err.message : 'Error en la acción');
      },
    });
  };

  const handleCancelRoute = () => {
    if (!route) return;
    cancelRoute.mutate(route._id, {
      onError: (err) => {
        if (isOfflineQueuedError(err)) return;
        setActionError(err instanceof Error ? err.message : 'Error en la acción');
      },
    });
  };

  const handleCompleteRoute = () => {
    if (!route) return;
    completeRoute.mutate(
      { routeId: route._id },
      {
        onError: (err) => {
          if (isOfflineQueuedError(err)) return;
          setActionError(err instanceof Error ? err.message : 'Error en la acción');
        },
      },
    );
  };

  const handleAddStop = (e: FormEvent) => {
    e.preventDefault();
    if (!id || !addStopOrderId.trim()) return;
    setAddStopError(null);
    addStop.mutate(
      { routeId: id, orderId: addStopOrderId.trim() },
      {
        onSuccess: () => {
          setShowAddStop(false);
          setAddStopOrderId('');
        },
        onError: (err) => {
          // Offline queued write: normal outcome, the OfflineBanner confirmed it.
          if (isOfflineQueuedError(err)) {
            setShowAddStop(false);
            setAddStopOrderId('');
            return;
          }
          setAddStopError(err instanceof Error ? err.message : 'Error al agregar parada');
        },
      },
    );
  };

  const handleRemoveStop = (stopId: string) => {
    if (!id || !confirm('¿Eliminar esta parada?')) return;
    removeStop.mutate(
      { routeId: id, stopId },
      {
        onError: (err) => {
          if (isOfflineQueuedError(err)) return;
          setActionError(err instanceof Error ? err.message : 'Error al eliminar parada');
        },
      },
    );
  };

  const openOptimizeDialog = () => {
    setShowMapPicker(false);
    setOptimizeStart(null);
    setGeoError(null);
    setOptimizeError(null);
    setShowOptimize(true);
  };

  /** Uses the driver's/depot's real position as the route start point. */
  const useMyLocation = () => {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError('Tu dispositivo no soporta geolocalización. Elegí el punto en el mapa.');
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setOptimizeStart({ lat: position.coords.latitude, lng: position.coords.longitude });
        setGeoLoading(false);
      },
      (err) => {
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'Permiso denegado. Elegí el punto de inicio en el mapa.'
            : 'No se pudo obtener tu ubicación. Elegí el punto de inicio en el mapa.'
        );
        setGeoLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  };

  const handleOptimize = () => {
    if (!id) return;
    setOptimizeError(null);
    optimizeRoute.mutate(
      { routeId: id, start: optimizeStart ?? undefined },
      {
        onSuccess: () => {
          setShowOptimize(false);
          setOptimizeStart(null);
          setShowMapPicker(false);
          setActionError(null);
        },
        onError: (err) => {
          if (isOfflineQueuedError(err)) {
            setShowOptimize(false);
            setOptimizeStart(null);
            setShowMapPicker(false);
            return;
          }
          setOptimizeError(err instanceof Error ? err.message : 'Error al optimizar ruta');
        },
      },
    );
  };

  /** Timeline deliver/skip actions (route must be in_progress). */
  const handleAdvance = (stop: RouteStop, to: 'in_transit' | 'delivered' | 'skipped') => {
    if (!route) return;
    setActionError(null);
    advanceStop.mutate(
      { routeId: route._id, stopId: stop._id, status: to },
      {
        onSuccess: () => {
          if (to === 'delivered') {
            setFlashId(stop._id);
            window.setTimeout(() => setFlashId((cur) => (cur === stop._id ? null : cur)), 2500);
          }
        },
        onError: (err) => {
          if (isOfflineQueuedError(err)) return;
          setActionError(err instanceof Error ? err.message : 'Error al avanzar parada');
        },
      },
    );
  };

  /** NEXT STOP CARD primary CTA — advance pending → in_transit → delivered. */
  const handleConfirmDelivery = (stop: RouteStop) => {
    if (!route) return;
    setConfirmingId(stop._id);
    setActionError(null);

    const run = (to: 'in_transit' | 'delivered') => {
      advanceStop.mutate(
        { routeId: route._id, stopId: stop._id, status: to },
        {
          onSuccess: () => {
            if (to === 'delivered') {
              setFlashId(stop._id);
              window.setTimeout(() => setFlashId((cur) => (cur === stop._id ? null : cur)), 2500);
            }
            setConfirmingId(null);
          },
          onError: (err) => {
            if (isOfflineQueuedError(err)) {
              setConfirmingId(null);
              return;
            }
            setActionError(err instanceof Error ? err.message : 'Error al confirmar entrega');
            setConfirmingId(null);
          },
        },
      );
    };

    if (stop.status === 'pending') {
      // pending → in_transit first, then → delivered (two sequential writes).
      advanceStop.mutate(
        { routeId: route._id, stopId: stop._id, status: 'in_transit' },
        {
          onSuccess: () => run('delivered'),
          onError: (err) => {
            if (isOfflineQueuedError(err)) {
              setConfirmingId(null);
              return;
            }
            setActionError(err instanceof Error ? err.message : 'Error al confirmar entrega');
            setConfirmingId(null);
          },
        },
      );
    } else {
      run('delivered');
    }
  };

  if (loading) {
    return <LoadingState label="Cargando ruta…" />;
  }

  if (!route) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">Ruta no encontrada</Alert>
      </Box>
    );
  }

  /* ── Derived data ─────────────────────────── */

  const statusCfg = routeStatusConfig[route.status];
  const sortedStops = [...route.stops].sort((a, b) => a.sequence - b.sequence);
  const totalStops = sortedStops.length;
  const deliveredCount = sortedStops.filter((s) => s.status === 'delivered').length;
  const percent = totalStops > 0 ? (deliveredCount / totalStops) * 100 : 0;
  const activeStops = sortedStops.filter((s) => s.status === 'pending' || s.status === 'in_transit');
  const currentStop = activeStops[0] ?? null;
  const isCancelled = route.status === 'cancelled';

  // Map section — markers numbered by sequence, current stop highlighted
  const stopsWithCoords = sortedStops.filter((s) => s.location);
  const mapMarkers: MapMarker[] = stopsWithCoords.map((s) => ({
    lat: s.location!.lat,
    lng: s.location!.lng,
    label: String(s.sequence),
    kind: s.status === 'delivered' ? 'delivered' : currentStop && s._id === currentStop._id ? 'current' : 'pending',
  }));
  const mapPolyline = mapMarkers.map(({ lat, lng }) => ({ lat, lng }));
  const stopsWithoutCoords = totalStops - stopsWithCoords.length;
  const canOpenMaps = stopsWithCoords.length >= 2;
  const mapsUrl = canOpenMaps
    ? buildDirectionsUrl(
        stopsWithCoords[0]!.location!,
        stopsWithCoords[stopsWithCoords.length - 1]!.location!,
        stopsWithCoords.slice(1, -1).map((s) => s.location!),
      )
    : null;
  const nextStopUrl = currentStop?.location ? buildDirectionsUrl(null, currentStop.location) : mapsUrl;

  const jornadaLabel = route.startedAt
    ? route.completedAt
      ? `${fmtTime(route.startedAt)} – ${fmtTime(route.completedAt)} hs`
      : `Iniciada ${fmtTime(route.startedAt)} hs`
    : fmtDateShort(route.plannedDate);

  const selectedOrder = availableOrders.find((o) => o._id === addStopOrderId) ?? null;
  const canAddStop = !ordersLoading && !ordersError && availableOrders.length > 0 && addStopOrderId !== '';
  const canMutate = route.status === 'in_progress';
  const canRemove = route.status === 'planned';

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
      {/* 1 — Header / route identity row */}
      <Box sx={{ mb: 2.5 }}>
        <MuiButton
          variant="ghost"
          size="sm"
          onClick={goBack}
          startIcon={<IconArrowBack size={16} />}
          sx={{ mb: 1, px: 0.5, minHeight: 36 }}
        >
          Rutas
        </MuiButton>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 48,
                height: 48,
                borderRadius: '16px',
                bgcolor: 'primaryFixed',
                color: 'onPrimaryFixed',
                flexShrink: 0,
              }}
            >
              <IconTruck size={22} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography
                variant="overline"
                color="onSurfaceVariant"
                sx={{ display: 'block', letterSpacing: '0.12em', lineHeight: 1.4 }}
              >
                Hoja de ruta diaria
              </Typography>
              <Typography
                variant="h5"
                sx={{ fontWeight: 800, letterSpacing: '-0.02em', color: 'onSurface', lineHeight: 1.2 }}
              >
                Ruta {route.routeNumber}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                <MuiChip label={statusCfg.label} color={statusCfg.color} size="small" />
                {route.vehicleName && (
                  <MuiChip
                    label={route.vehicleName}
                    size="small"
                    icon={<IconCar size={13} />}
                    sx={{ bgcolor: 'surfaceContainer', color: 'onSurfaceVariant' }}
                  />
                )}
                <Typography variant="caption" color="onSurfaceVariant" sx={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtDateLong(route.plannedDate)}
                </Typography>
              </Box>
            </Box>
          </Box>
          <Box sx={{ ml: 'auto', flexShrink: 0 }}>
            <MuiButton variant="secondary" size="sm" onClick={() => navigate('/routes')}>
              Cambiar
            </MuiButton>
          </Box>
        </Box>
      </Box>

      {/* 1b — Admin actions (visible, M3-styled) */}
      {(route.status === 'planned' || route.status === 'in_progress') && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2.5 }}>
          {route.status === 'planned' && (
            <>
              <MuiButton
                variant="primary"
                size="sm"
                isLoading={actionLoading}
                onClick={handleStartRoute}
                startIcon={<IconPlay />}
              >
                Iniciar Ruta
              </MuiButton>
              <MuiButton
                variant="secondary"
                size="sm"
                disabled={route.stops.length === 0}
                onClick={openOptimizeDialog}
                startIcon={<IconSwapVert />}
              >
                Optimizar Ruta
              </MuiButton>
              <MuiButton
                variant="danger"
                size="sm"
                isLoading={actionLoading}
                onClick={handleCancelRoute}
                startIcon={<IconX />}
              >
                Cancelar
              </MuiButton>
            </>
          )}
          {route.status === 'in_progress' && (
            <MuiButton
              variant="primary"
              size="sm"
              isLoading={actionLoading}
              disabled={deliveredCount < totalStops}
              onClick={handleCompleteRoute}
              startIcon={<IconCheck />}
            >
              Completar Ruta
            </MuiButton>
          )}
          <MuiButton variant="secondary" size="sm" onClick={openAddStopDialog} startIcon={<IconPlus />}>
            Agregar Parada
          </MuiButton>
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* 2 — Driver & Route Info Pill */}
      <Box
        sx={{
          bgcolor: 'surfaceContainerLow',
          border: 1,
          borderColor: 'outlineVariant',
          borderRadius: '16px',
          boxShadow: 1,
          p: 2.5,
          mb: 3,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ position: 'relative', flexShrink: 0 }}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                bgcolor: 'surfaceContainerHigh',
                color: 'primary.main',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '0.875rem',
              }}
            >
              {initials(route.driverName)}
            </Box>
            <Box
              sx={{
                position: 'absolute',
                right: 0,
                bottom: 0,
                width: 12,
                height: 12,
                borderRadius: '50%',
                bgcolor: 'success.main',
                border: 2,
                borderColor: 'surfaceContainerLow',
              }}
            />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="titleMedium" sx={{ fontWeight: 700, color: 'onSurface' }}>
              {route.driverName}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
              <IconTruck size={14} color="var(--mui-palette-onSurfaceVariant)" />
              <Typography variant="body2" color="onSurfaceVariant" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {route.routeNumber}
              </Typography>
            </Box>
            {route.vehicleName && (
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
                <IconCar size={14} color="var(--mui-palette-onSurfaceVariant)" />
                <Typography variant="body2" sx={{ fontWeight: 600, color: 'onSurface', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {route.vehicleName}
                </Typography>
              </Box>
            )}
          </Box>
          <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
            <Typography variant="caption" color="onSurfaceVariant" sx={{ display: 'block' }}>
              Jornada Estimada
            </Typography>
            <Typography
              variant="titleMedium"
              sx={{ fontWeight: 800, color: 'primary.main', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}
            >
              {jornadaLabel}
            </Typography>
          </Box>
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Route progress */}
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 1, gap: 2 }}>
          <Typography variant="body2" color="onSurfaceVariant" sx={{ fontWeight: 500 }}>
            {deliveredCount} de {totalStops} paradas completadas
          </Typography>
          <Typography
            variant="body1"
            sx={{ fontWeight: 800, color: 'success.main', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
          >
            {Math.round(percent)}%
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={percent}
          color="secondary"
          sx={{
            height: 10,
            borderRadius: 9999,
            bgcolor: 'surfaceContainerHighest',
            '& .MuiLinearProgress-bar': {
              borderRadius: 9999,
              transition: 'width 0.8s cubic-bezier(0.2, 0, 0, 1)',
            },
          }}
        />

        {/* Carga restante — no item data on stops → "—" */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2 }}>
          <IconBox size={16} color="var(--mui-palette-onSurfaceVariant)" />
          <Typography variant="body2" color="onSurfaceVariant">
            Carga restante:
          </Typography>
          <Box
            component="span"
            sx={{
              ml: 'auto',
              px: 1.25,
              py: 0.4,
              borderRadius: 9999,
              bgcolor: 'surfaceContainer',
              color: 'onSurfaceVariant',
              fontSize: '0.75rem',
              fontWeight: 700,
            }}
          >
            —
          </Box>
        </Box>

        {route.startedAt && (
          <Typography variant="caption" color="onSurfaceVariant" sx={{ fontFamily: 'var(--font-mono)', display: 'block', mt: 1.5 }}>
            Iniciada: {new Date(route.startedAt).toLocaleString('es-AR')}
          </Typography>
        )}
        {route.completedAt && (
          <Typography variant="caption" color="onSurfaceVariant" sx={{ fontFamily: 'var(--font-mono)', display: 'block', mt: 0.5 }}>
            Completada: {new Date(route.completedAt).toLocaleString('es-AR')}
          </Typography>
        )}
        {route.kmTravelled != null && (
          <Typography variant="caption" color="onSurfaceVariant" sx={{ fontFamily: 'var(--font-mono)', display: 'block', mt: 0.5 }}>
            Kilómetros recorridos: {route.kmTravelled} km
          </Typography>
        )}
      </Box>

      {/* 3 — Interactive Route Map Card */}
      {totalStops > 0 && (
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5, gap: 2, flexWrap: 'wrap' }}>
            <Typography variant="overline" color="onSurfaceVariant">
              Mapa de la ruta
            </Typography>
            <MuiButton
              variant="secondary"
              size="sm"
              disabled={!canOpenMaps}
              startIcon={<IconMapPin size={16} />}
              onClick={() => {
                if (mapsUrl) window.open(mapsUrl, '_blank', 'noopener,noreferrer');
              }}
            >
              Abrir en Google Maps
            </MuiButton>
          </Box>

          {stopsWithCoords.length === 0 ? (
            <MuiCard variant="outlined" sx={{ p: 3 }}>
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                No hay coordenadas para mostrar. Geocodificá los clientes.
              </Typography>
            </MuiCard>
          ) : (
            <Box sx={{ position: 'relative', borderRadius: '16px', overflow: 'hidden', boxShadow: 2, border: 1, borderColor: 'outlineVariant' }}>
              <MapView
                markers={mapMarkers}
                polyline={mapPolyline}
                height={320}
                recenterControl
                overlay={
                  <Box
                    sx={{
                      position: 'absolute',
                      left: 10,
                      right: 10,
                      bottom: 10,
                      zIndex: 1000,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                      px: 1.5,
                      py: 1,
                      borderRadius: '12px',
                      bgcolor: 'color-mix(in srgb, var(--mui-palette-surface) 92%, transparent)',
                      backdropFilter: 'blur(8px)',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                      border: 1,
                      borderColor: 'outlineVariant',
                    }}
                  >
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="caption" color="onSurfaceVariant" sx={{ display: 'block', letterSpacing: '0.08em', fontWeight: 600 }}>
                        PRÓXIMA PARADA
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 700,
                          color: 'onSurface',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {currentStop ? currentStop.customerName : 'Ruta completada'}
                      </Typography>
                    </Box>
                    <MuiButton
                      variant="secondary"
                      size="sm"
                      disabled={!nextStopUrl}
                      startIcon={<IconMapPin size={15} />}
                      onClick={() => {
                        if (nextStopUrl) window.open(nextStopUrl, '_blank', 'noopener,noreferrer');
                      }}
                      sx={{ flexShrink: 0, minHeight: 36, px: 1.5 }}
                    >
                      Abrir en Google Maps
                    </MuiButton>
                  </Box>
                }
              />
              {stopsWithoutCoords > 0 && (
                <Typography variant="caption" color="onSurfaceVariant" sx={{ display: 'block', mt: 1, px: 0.5 }}>
                  {stopsWithoutCoords} {stopsWithoutCoords === 1 ? 'parada sin coordenadas' : 'paradas sin coordenadas'} — no se pueden mostrar en el mapa
                </Typography>
              )}
            </Box>
          )}
        </Box>
      )}

      {/* 4 — NEXT STOP CARD */}
      {!isCancelled &&
        (currentStop ? (
          <Box
            sx={{
              mb: 3,
              bgcolor: 'surfaceContainerLowest',
              border: 2,
              borderColor: 'color-mix(in srgb, var(--mui-palette-primary-main) 20%, transparent)',
              borderRadius: '8px',
              boxShadow: 4,
              p: 2.5,
            }}
          >
            {/* Ribbon */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <Box
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1.25,
                  py: 0.5,
                  borderRadius: 9999,
                  bgcolor: 'primaryFixed',
                  color: 'onPrimaryFixed',
                }}
              >
                <Box
                  component="span"
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    bgcolor: 'primary.main',
                    display: 'inline-block',
                    animation: `${pulsePrimary} 1.6s ease-out infinite`,
                  }}
                />
                <Typography variant="labelMedium" sx={{ fontWeight: 700, letterSpacing: '0.04em' }}>
                  PARADA #{currentStop.sequence} · EN CURSO
                </Typography>
              </Box>
              <Box
                component="span"
                sx={{
                  ml: 'auto',
                  px: 1.25,
                  py: 0.4,
                  borderRadius: 9999,
                  bgcolor: 'surfaceContainer',
                  color: 'onSurfaceVariant',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}
              >
                #{currentStop.orderNumber}
              </Box>
            </Box>

            {/* Client body */}
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: '-0.02em', color: 'onSurface' }}>
                  {currentStop.customerName}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.5, minWidth: 0 }}>
                  <IconCustomer size={14} color="var(--mui-palette-onSurfaceVariant)" />
                  <Typography variant="body2" color="onSurfaceVariant">
                    {currentStop.customerPhone || 'Sin teléfono'}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.25, minWidth: 0 }}>
                  <IconLocation size={14} color="var(--mui-palette-onSurfaceVariant)" />
                  <Typography variant="body2" color="onSurfaceVariant">
                    {currentStop.customerAddress}
                  </Typography>
                </Box>
              </Box>
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: '14px',
                  bgcolor: 'surfaceContainerHigh',
                  color: 'onSurfaceVariant',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <IconCustomer size={24} />
              </Box>
            </Box>

            {/* Cargo breakdown — no item data on stops → "—" + order number */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                bgcolor: 'surfaceContainerLow',
                borderRadius: '12px',
                px: 1.5,
                py: 1.25,
                mt: 2,
              }}
            >
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: '10px',
                  bgcolor: 'surfaceContainerHighest',
                  color: 'onSurfaceVariant',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <IconEgg size={18} />
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, color: 'onSurface' }}>
                  —
                </Typography>
                <Typography variant="caption" color="onSurfaceVariant">
                  Carga
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                <Typography variant="caption" color="onSurfaceVariant" sx={{ display: 'block' }}>
                  Total a Cobrar
                </Typography>
                <Typography
                  variant="body1"
                  sx={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'primary.main', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}
                >
                  #{currentStop.orderNumber}
                </Typography>
              </Box>
            </Box>

            {/* Quick actions */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mt: 2 }}>
              <LinkActionButton href={currentStop.customerPhone ? `tel:${currentStop.customerPhone}` : null} icon={<IconPhone size={18} />}>
                Llamar Cliente
              </LinkActionButton>
              <LinkActionButton
                href={currentStop.location ? buildDirectionsUrl(null, currentStop.location) : null}
                icon={<IconMapPin size={18} />}
              >
                Navegar GPS
              </LinkActionButton>
            </Box>

            {/* Primary CTA */}
            <MuiButton
              variant="primary"
              size="lg"
              fullWidth
              disabled={!canMutate}
              isLoading={confirmingId === currentStop._id}
              onClick={() => handleConfirmDelivery(currentStop)}
              sx={{
                mt: 2,
                height: 48,
                bgcolor: 'secondary.main',
                color: '#fff',
                '&:hover': { bgcolor: 'secondary.dark' },
                '&.Mui-disabled': { bgcolor: 'surfaceContainer', color: 'onSurfaceVariant' },
              }}
            >
              {!canMutate ? 'Iniciá la ruta para confirmar entregas' : 'Confirmar Entrega y Cobro'}
            </MuiButton>
          </Box>
        ) : route.status === 'completed' || (route.status === 'in_progress' && totalStops > 0) ? (
          <Box
            sx={{
              mb: 3,
              bgcolor: 'secondaryContainer',
              border: 1,
              borderColor: 'outlineVariant',
              borderRadius: '16px',
              p: 3,
              textAlign: 'center',
            }}
          >
            <Box
              component="span"
              sx={{
                display: 'inline-flex',
                width: 48,
                height: 48,
                borderRadius: '50%',
                bgcolor: 'secondary.main',
                color: '#fff',
                alignItems: 'center',
                justifyContent: 'center',
                animation: `${pulseSuccess} 2s ease-out infinite`,
              }}
            >
              <IconCircleCheck size={26} />
            </Box>
            <Typography variant="h6" sx={{ fontWeight: 800, mt: 1.5 }}>
              Ruta completada
            </Typography>
            <Typography variant="body2" color="onSurfaceVariant">
              {totalStops} paradas · {deliveredCount} entregadas
            </Typography>
          </Box>
        ) : null)}

      {/* 5 — Chronological Stops Timeline */}
      <Box sx={{ mb: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', mb: 2, gap: 1 }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
              Secuencia de Paradas
            </Typography>
            <Typography variant="body2" color="onSurfaceVariant">
              {totalStops} clientes asignados
            </Typography>
          </Box>
          <MuiChip
            label="Orden Optimizado"
            size="small"
            icon={<IconRoute size={13} />}
            sx={{ bgcolor: 'surfaceContainer', color: 'onSurfaceVariant', flexShrink: 0 }}
          />
        </Box>

        {totalStops === 0 ? (
          <MuiCard variant="elevated">
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
              Sin paradas asignadas.
            </Typography>
          </MuiCard>
        ) : (
          <Box sx={{ position: 'relative' }}>
            {/* Continuous background track */}
            <Box
              sx={{
                position: 'absolute',
                left: 19,
                top: 12,
                bottom: 12,
                width: 2,
                bgcolor: 'surfaceContainerHighest',
                borderRadius: 9999,
              }}
            />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {sortedStops.map((stop) => (
                <TimelineStopCard
                  key={stop._id}
                  stop={stop}
                  isCurrent={currentStop?._id === stop._id}
                  flash={flashId === stop._id}
                  canMutate={canMutate}
                  canRemove={canRemove}
                  busy={actionLoading || confirmingId === stop._id}
                  onAdvance={handleAdvance}
                  onRemove={(s) => handleRemoveStop(s._id)}
                />
              ))}
            </Box>
          </Box>
        )}
      </Box>

      {/* Add Stop Dialog */}
      <MuiDialog
        open={showAddStop}
        onClose={() => setShowAddStop(false)}
        title="Agregar Parada"
        maxWidth="xs"
        actions={
          <>
            <MuiButton variant="ghost" onClick={() => setShowAddStop(false)}>
              Cancelar
            </MuiButton>
            <MuiButton
              variant="primary"
              disabled={!canAddStop}
              onClick={() => {
                const form = document.querySelector('[data-add-stop-form]') as HTMLFormElement;
                form?.requestSubmit();
              }}
            >
              Agregar
            </MuiButton>
          </>
        }
      >
        <Box component="form" data-add-stop-form onSubmit={handleAddStop} sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <MuiTextField
            label="Orden"
            value={addStopOrderId}
            onChange={(e) => setAddStopOrderId(e.target.value)}
            select
            required
            error={!ordersLoading && !ordersError && availableOrders.length === 0}
            helperText={
              ordersLoading
                ? 'Cargando órdenes…'
                : ordersError
                  ? ordersError
                  : availableOrders.length === 0
                    ? 'No hay órdenes pendientes disponibles'
                    : undefined
            }
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <IconOrder size={18} />
                  </InputAdornment>
                ),
              },
              select: { displayEmpty: true },
            }}
          >
            <MenuItem value="" disabled>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <IconOrder size={16} />
                <Typography variant="body2" color="text.secondary">
                  Seleccionar orden...
                </Typography>
              </Box>
            </MenuItem>
            {availableOrders.map((order) => (
              <MenuItem key={order._id} value={order._id}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <IconOrder size={16} />
                  <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      #{order.orderNumber} — {order.customerName}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtMoney(order.totalAmount)}
                      </Typography>
                      <MuiChip
                        label={paymentStatusConfig[order.paymentStatus].label}
                        color={paymentStatusConfig[order.paymentStatus].color}
                        size="small"
                        variant="outlined"
                      />
                    </Box>
                  </Box>
                </Box>
              </MenuItem>
            ))}
          </MuiTextField>
          {selectedOrder && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 2,
                py: 1.25,
                borderRadius: m3Shape.small,
                bgcolor: 'secondaryContainer',
                color: 'onSecondaryContainer',
              }}
            >
              <IconOrder size={16} />
              <Typography variant="body2" noWrap sx={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                #{selectedOrder.orderNumber}
              </Typography>
              <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                {selectedOrder.customerName}
              </Typography>
              <Typography variant="body2" noWrap sx={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', ml: 'auto' }}>
                {fmtMoney(selectedOrder.totalAmount)}
              </Typography>
            </Box>
          )}
          {addStopError && <Alert severity="error">{addStopError}</Alert>}
        </Box>
      </MuiDialog>

      {/* Optimize Route Dialog */}
      <MuiDialog
        open={showOptimize}
        onClose={() => setShowOptimize(false)}
        title="Optimizar Ruta"
        maxWidth="sm"
        actions={
          <>
            <MuiButton variant="ghost" onClick={() => setShowOptimize(false)}>
              Cancelar
            </MuiButton>
            <MuiButton
              variant="primary"
              isLoading={optimizing}
              disabled={optimizing}
              startIcon={<IconSwapVert size={16} />}
              onClick={handleOptimize}
            >
              Optimizar
            </MuiButton>
          </>
        }
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 1 }}>
          <Typography variant="body2" color="onSurfaceVariant">
            Ordena las paradas desde la más cercana al inicio, para recorrer la mejor ruta.
          </Typography>

          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            <MuiButton
              variant="secondary"
              size="sm"
              isLoading={geoLoading}
              startIcon={<IconMyLocation size={16} />}
              onClick={useMyLocation}
            >
              Usar mi ubicación
            </MuiButton>
            <MuiButton
              variant="secondary"
              size="sm"
              startIcon={<IconMapPin size={16} />}
              onClick={() => setShowMapPicker((v) => !v)}
            >
              Elegir en el mapa
            </MuiButton>
          </Box>

          {geoError && <Alert severity="error">{geoError}</Alert>}
          {optimizeError && <Alert severity="error">{optimizeError}</Alert>}

          {showMapPicker && (
            <Box>
              <MapView
                markers={stopsWithCoords.map((s) => ({
                  lat: s.location!.lat,
                  lng: s.location!.lng,
                  label: String(s.sequence),
                  kind: 'pending',
                }))}
                selectable
                selectedMarker={optimizeStart ?? null}
                onSelect={(marker) => setOptimizeStart({ lat: marker.lat, lng: marker.lng })}
                selectHint="Tocá el mapa para marcar el punto de inicio"
                height={280}
              />
            </Box>
          )}

          {optimizeStart && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 2,
                py: 1.25,
                borderRadius: m3Shape.medium,
                bgcolor: 'primaryContainer',
                color: 'onPrimaryContainer',
              }}
            >
              <IconLocation size={16} />
              <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                Inicio: {optimizeStart.lat.toFixed(5)}, {optimizeStart.lng.toFixed(5)}
              </Typography>
              <Box sx={{ ml: 'auto' }}>
                <MuiButton variant="ghost" size="sm" sx={{ minHeight: 32, px: 1 }} onClick={() => setOptimizeStart(null)}>
                  Quitar
                </MuiButton>
              </Box>
            </Box>
          )}

          <Typography variant="caption" color="onSurfaceVariant">
            {optimizeStart
              ? 'Las paradas se ordenarán desde este punto, de la más cercana a la más lejana.'
              : 'Sin punto de inicio se usa la primera parada como referencia.'}
          </Typography>
        </Box>
      </MuiDialog>
    </Box>
  );
}