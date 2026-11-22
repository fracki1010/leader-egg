import { useCallback, useEffect, useState } from 'react';
import { routesApi } from '../api/routes.ts';
import type { Route, RouteStop, StopStatus, PaymentPreference } from '../types/index.ts';
import { saveRoute } from '../lib/offline-db.ts';
import { enqueue, getPendingCount, onStatusChange, type SyncStatus } from '../lib/sync-queue.ts';
import { isOnline, onOfflineStatusChange } from '../lib/offline-status.ts';
import { SwipeableStopCard, PullToRefresh, BottomSheet } from '../components/driver/index.ts';
import { PageHeader, LoadingState, MuiButton, MuiCard } from '../components/ui/index.ts';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';
import { IconCheck, IconInbox, IconSync, IconPlay, IconSkip, IconCircle, IconCircleCheck } from '../components/ui/icons.tsx';

/* ── Config ─────────────────────────────────── */

const stopStatusConfig: Record<StopStatus, { label: string; color: 'default' | 'warning' | 'success' | 'error' }> = {
  pending: { label: 'Pendiente', color: 'default' },
  in_transit: { label: 'En Camino', color: 'warning' },
  delivered: { label: 'Entregado', color: 'success' },
  skipped: { label: 'Salteado', color: 'error' },
};

const PAYMENT_PREFERENCE_LABELS: Record<PaymentPreference, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  credit: 'Cta. Cte.',
  cod: 'Contra reembolso',
  partial: 'Pago parcial',
};

const fmtMoney = (val: number) =>
  `$ ${val.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

/* ── DriverRoutePage ────────────────────────── */

export function DriverRoutePage() {
  const [route, setRoute] = useState<Route | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});

  // PWA state
  const [online, setOnline] = useState(isOnline());
  const [pendingSync, setPendingSync] = useState(0);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [sheetStop, setSheetStop] = useState<RouteStop | null>(null);

  // ── Offline status listener ────────────────────
  useEffect(() => {
    return onOfflineStatusChange((detail) => setOnline(detail.online));
  }, []);

  // ── Sync status listener ───────────────────────
  useEffect(() => {
    return onStatusChange((status) => {
      setSyncStatus(status);
      if (status !== 'syncing') {
        getPendingCount().then(setPendingSync);
      }
    });
  }, []);

  // ── Load route: network-first, cache fallback ──
  const loadActiveRoute = useCallback(async () => {
    try {
      const data = await routesApi.getDriverActive();
      setRoute(data);
      setError(null);
      // Cache in IndexedDB
      await saveRoute(data);
    } catch {
      if (!navigator.onLine) {
        // Offline: try IndexedDB
        try {
          const allCached = await getAllCachedRoutes();
          const first = allCached[0];
          if (first) {
            setRoute(first.data);
            setError(null);
          } else {
            setError('Sin datos offline. Conectate para cargar la ruta.');
          }
        } catch {
          setError('Sin datos offline. Conectate para cargar la ruta.');
        }
      } else {
        // Online but failed — still try cache
        try {
          const allCached = await getAllCachedRoutes();
          const first = allCached[0];
          if (first) {
            setRoute(first.data);
            setError(null);
          } else {
            setError('Error al cargar ruta');
          }
        } catch {
          setError('Error al cargar ruta');
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadActiveRoute(); }, [loadActiveRoute]);

  // Refresh handler for PullToRefresh
  const handleRefresh = useCallback(async () => {
    await loadActiveRoute();
    setPendingSync(await getPendingCount());
  }, [loadActiveRoute]);

  // ── Mutation handler: online → API, offline → queue ──
  const handleAdvance = useCallback(async (stop: RouteStop, newStatus: StopStatus) => {
    if (!route) return;
    setActionLoading(stop._id);
    const notes = noteInputs[stop._id] || undefined;

    // Optimistic local update
    const optimisticRoute = {
      ...route,
      stops: route.stops.map((s) =>
        s._id === stop._id ? { ...s, status: newStatus } : s
      ),
    };
    setRoute(optimisticRoute);

    try {
      if (navigator.onLine) {
        const updated = await routesApi.advanceStop(route._id, stop._id, newStatus, notes);
        setRoute(updated);
        await saveRoute(updated);
      } else {
        // Queue for sync
        await enqueue({
          operation: 'advanceStop',
          payload: { routeId: route._id, stopId: stop._id, status: newStatus, notes },
          timestamp: Date.now(),
        });
        // Persist optimistic state to cache
        await saveRoute(optimisticRoute);
        setPendingSync((c) => c + 1);
      }
      if (notes) {
        setNoteInputs((prev) => ({ ...prev, [stop._id]: '' }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al avanzar parada');
      // Revert optimistic update on failure
      await loadActiveRoute();
    } finally {
      setActionLoading(null);
    }
  }, [route, noteInputs, loadActiveRoute]);

  const handleSaveNote = useCallback(async (stopId: string) => {
    if (!route) return;
    const notes = noteInputs[stopId];
    if (!notes?.trim()) return;
    setActionLoading(stopId);

    try {
      if (navigator.onLine) {
        const updated = await routesApi.addStopNote(route._id, stopId, notes.trim());
        setRoute(updated);
        await saveRoute(updated);
      } else {
        await enqueue({
          operation: 'addNote',
          payload: { routeId: route._id, stopId, notes: notes.trim() },
          timestamp: Date.now(),
        });
        // Optimistic: update local copy
        const optimisticRoute = {
          ...route,
          stops: route.stops.map((s) =>
            s._id === stopId ? { ...s, notes: notes.trim() } : s
          ),
        };
        setRoute(optimisticRoute);
        await saveRoute(optimisticRoute);
        setPendingSync((c) => c + 1);
      }
      setNoteInputs((prev) => ({ ...prev, [stopId]: '' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar nota');
    } finally {
      setActionLoading(null);
    }
  }, [route, noteInputs]);

  // ── SwipeableStopCard handlers ─────────────────
  const handleCardAdvance = useCallback((stop: RouteStop, newStatus: StopStatus) => {
    handleAdvance(stop, newStatus);
  }, [handleAdvance]);

  const handleCardSkip = useCallback((stop: RouteStop) => {
    handleAdvance(stop, 'skipped');
  }, [handleAdvance]);

  const handleCardTap = useCallback((stop: RouteStop) => {
    setSheetStop(stop);
  }, []);

  // ── Render ─────────────────────────────────────

  if (loading) {
    return <LoadingState label="Cargando tu ruta…" />;
  }

  if (!route) {
    return (
      <Box sx={{ maxWidth: 800, mx: 'auto' }}>
        <PageHeader title="Mi Ruta" icon={<IconPlay size={22} />} />
        <MuiCard variant="elevated" sx={{ height: '100%' }}>
          <Box sx={{ mb: 2, color: 'onSurfaceVariant', textAlign: 'center' }}>
            <IconInbox size={48} />
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 1, textAlign: 'center' }}>
            No tenés una ruta activa hoy.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
            Contactá al administrador para que te asigne una ruta.
          </Typography>
        </MuiCard>
      </Box>
    );
  }

  const deliveredCount = route.stops.filter((s) => s.status === 'delivered').length;
  const sortedStops = [...route.stops].sort((a, b) => a.sequence - b.sequence);
  const progressPct = route.stops.length > 0 ? (deliveredCount / route.stops.length) * 100 : 0;

  return (
    <PullToRefresh onRefresh={handleRefresh} disabled={!online}>
      <Box sx={{ maxWidth: 800, mx: 'auto' }}>
        {/* ── Offline indicator ──────────────────── */}
        {!online && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.5, bgcolor: 'warningContainer', border: '1px solid', borderColor: 'warningContainer', borderRadius: 2, fontSize: 'body2', color: 'onWarningContainer', mb: 2 }}>
            <IconCircle size={8} color="var(--mui-palette-warning-main)" />
            Sin conexión — usando datos locales
          </Box>
        )}

        {/* ── Sync status indicator ─────────────── */}
        {pendingSync > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.5, bgcolor: 'secondaryContainer', border: '1px solid', borderColor: 'secondaryContainer', borderRadius: 2, fontSize: 'body2', color: 'onSecondaryContainer', mb: 2 }}>
            {syncStatus === 'syncing' ? (
              <CircularProgress size={16} />
            ) : (
              <IconSync size={16} />
            )}
            {syncStatus === 'syncing' ? ' Sincronizando...' : ` ${pendingSync} pendiente${pendingSync > 1 ? 's' : ''}`}
          </Box>
        )}
        {syncStatus === 'synced' && pendingSync === 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.5, bgcolor: 'successContainer', border: '1px solid', borderColor: 'successContainer', borderRadius: 2, fontSize: 'body2', color: 'onSuccessContainer', mb: 2 }}>
            <IconCircleCheck size={16} />
            Sincronizado
          </Box>
        )}

        {/* Header */}
        <PageHeader
          title="Mi Ruta"
          subtitle={route.routeNumber}
          icon={<IconPlay size={22} />}
          actions={
            <Chip
              label={route.status === 'in_progress' ? 'En Progreso' : 'Planificada'}
              color={route.status === 'in_progress' ? 'success' : 'info'}
            />
          }
        />

        {/* Progress */}
        <MuiCard variant="elevated" sx={{ mb: 4, p: 3, '& .MuiCardContent-root': { p: 3, '&:last-child': { pb: 3 } } }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
              Entregas completadas
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {deliveredCount}/{route.stops.length}
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={progressPct}
            sx={{ height: 10, borderRadius: 5, mb: 1.5 }}
          />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}
          >
            {deliveredCount === route.stops.length && route.stops.length > 0 ? (
              <>
                <IconCheck size={14} color="var(--mui-palette-success-main)" />
                ¡Todas las entregas completadas!
              </>
            ) : (
              `${route.stops.length - deliveredCount} paradas restantes`
            )}
          </Typography>
        </MuiCard>

        {error && (
          <Box sx={{ p: 2, bgcolor: 'errorContainer', borderRadius: 2, border: '1px solid', borderColor: 'errorContainer', fontSize: 'body2', color: 'onErrorContainer', mb: 3 }}>
            {error}
          </Box>
        )}

        {/* Stop list — SwipeableStopCard (custom gesture component) */}
        <Box sx={{ mb: 4 }}>
          <Typography variant="overline" color="onSurfaceVariant" sx={{ display: 'block', mb: 2 }}>
            Paradas
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {sortedStops.map((stop) => (
              <SwipeableStopCard
                key={stop._id}
                stop={stop}
                onAdvance={handleCardAdvance}
                onSkip={handleCardSkip}
                onTap={handleCardTap}
                isLoading={actionLoading === stop._id}
              />
            ))}
          </Box>
        </Box>

        {/* ── BottomSheet for stop details (custom gesture component) ──── */}
        <BottomSheet
          open={sheetStop !== null}
          onClose={() => setSheetStop(null)}
          title={sheetStop ? `Parada #${sheetStop.sequence}` : undefined}
        >
          {sheetStop && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1, borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                  Cliente
                </Typography>
                <Typography variant="body2" sx={{ textAlign: 'right', ml: 4 }}>
                  {sheetStop.customerName}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1, borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                  Dirección
                </Typography>
                <Typography variant="body2" sx={{ textAlign: 'right', ml: 4 }}>
                  {sheetStop.customerAddress}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1, borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                  Teléfono
                </Typography>
                <Typography variant="body2" sx={{ textAlign: 'right', ml: 4 }}>
                  {sheetStop.customerPhone}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1, borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                  Pedido
                </Typography>
                <Typography variant="body2" sx={{ textAlign: 'right', ml: 4 }}>
                  #{sheetStop.orderNumber}
                </Typography>
              </Box>
              {sheetStop.paymentPreference && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1, borderBottom: 1, borderColor: 'divider' }}>
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                    Forma de pago
                  </Typography>
                  <Typography variant="body2" sx={{ textAlign: 'right', ml: 4, fontWeight: 600 }}>
                    {PAYMENT_PREFERENCE_LABELS[sheetStop.paymentPreference] ?? sheetStop.paymentPreference}
                  </Typography>
                </Box>
              )}
              {(sheetStop.balanceToCollect ?? 0) > 0 && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1, borderBottom: 1, borderColor: 'divider' }}>
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                    A cobrar
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ textAlign: 'right', ml: 4, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'error.main' }}
                  >
                    {fmtMoney(sheetStop.balanceToCollect ?? 0)}
                  </Typography>
                </Box>
              )}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1, borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                  Estado
                </Typography>
                <Chip
                  label={stopStatusConfig[sheetStop.status].label}
                  color={stopStatusConfig[sheetStop.status].color}
                  size="small"
                />
              </Box>
              {sheetStop.notes && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1, borderBottom: 1, borderColor: 'divider' }}>
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                    Notas
                  </Typography>
                  <Typography variant="body2" sx={{ textAlign: 'right', ml: 4 }}>
                    {sheetStop.notes}
                  </Typography>
                </Box>
              )}

              {/* Note input in sheet */}
              {sheetStop.status !== 'delivered' && sheetStop.status !== 'skipped' && (
                <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                  <TextField
                    placeholder="Agregar nota..."
                    value={noteInputs[sheetStop._id] ?? ''}
                    onChange={(e) => setNoteInputs((prev) => ({ ...prev, [sheetStop._id]: e.target.value }))}
                    size="small"
                    fullWidth
                    sx={{ '& .MuiInputBase-root': { minHeight: 44 } }}
                  />
                  <MuiButton
                    variant="secondary"
                    size="sm"
                    onClick={() => handleSaveNote(sheetStop._id)}
                    disabled={actionLoading === sheetStop._id || !noteInputs[sheetStop._id]?.trim()}
                    sx={{ minHeight: 44 }}
                  >
                    Guardar
                  </MuiButton>
                </Box>
              )}

              {/* Action buttons in sheet */}
              <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                {sheetStop.status === 'pending' && (
                  <MuiButton
                    variant="primary"
                    fullWidth
                    isLoading={actionLoading === sheetStop._id}
                    onClick={() => { handleAdvance(sheetStop, 'in_transit'); setSheetStop(null); }}
                    sx={{ minHeight: 44 }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <IconPlay size={18} />
                      Iniciar Entrega
                    </Box>
                  </MuiButton>
                )}
                {sheetStop.status === 'in_transit' && (
                  <>
                    <MuiButton
                      variant="primary"
                      fullWidth
                      isLoading={actionLoading === sheetStop._id}
                      onClick={() => { handleAdvance(sheetStop, 'delivered'); setSheetStop(null); }}
                      sx={{ minHeight: 44 }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <IconCheck size={18} />
                      Entregado
                    </Box>
                    </MuiButton>
                    <MuiButton
                      variant="danger"
                      isLoading={actionLoading === sheetStop._id}
                      onClick={() => { handleAdvance(sheetStop, 'skipped'); setSheetStop(null); }}
                      sx={{ minHeight: 44 }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <IconSkip size={18} />
                      Saltear
                    </Box>
                    </MuiButton>
                  </>
                )}
              </Box>
            </Box>
          )}
        </BottomSheet>
      </Box>
    </PullToRefresh>
  );
}

/* ── Helper: get all cached routes ──────────── */

async function getAllCachedRoutes(): Promise<import('../lib/offline-db.ts').CachedRoute[]> {
  const { openDatabase } = await import('../lib/offline-db.ts');
  const db = await openDatabase();
  return db.getAll('routes');
}
