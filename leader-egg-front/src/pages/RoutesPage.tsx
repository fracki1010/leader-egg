import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRoutes, useDrivers, useVehicles } from '../hooks/queries/index.ts';
import { useCreateRoute } from '../hooks/mutations/index.ts';
import { todayLocalDate } from '../lib/date.ts';
import { isOfflineQueuedError } from '../hooks/use-offline-mutation.ts';
import type { RouteStatus } from '../types/index.ts';
import {
  MuiButton,
  MuiChip,
  MuiTextField,
  MuiDialog,
  LoadingState,
  EmptyState,
} from '../components/ui/index.ts';
import {
  IconCalendar,
  IconCircleCheck,
  IconEvent,
  IconLocalShipping,
  IconPerson,
  IconPlus,
  IconRoute,
  IconUsers,
  IconCar,
} from '../components/ui/icons.tsx';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import Pagination from '@mui/material/Pagination';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import InputAdornment from '@mui/material/InputAdornment';

/* ═══════════════════════════════════════════════════════════════
   Rutas — rich M3 reference redesign
   ═══════════════════════════════════════════════════════════════
   Sections:
   1. Header (primary-fixed icon square + "Nueva Ruta")
   2. Summary strip (Rutas hoy / En curso / Completadas — real counts)
   3. Segmented filter pills with counts
   4. Rich route cards (route icon, status + progress chips, driver, date)
   5. Create dialog (driver select + planned date)
   ═══════════════════════════════════════════════════════════════ */

/* ── Config ─────────────────────────────────── */

type StatusFilter = 'all' | RouteStatus;

const routeStatusConfig: Record<RouteStatus, { label: string; color: 'primary' | 'warning' | 'success' | 'error' }> = {
  planned: { label: 'Planificada', color: 'primary' },
  in_progress: { label: 'En Progreso', color: 'warning' },
  completed: { label: 'Completada', color: 'success' },
  cancelled: { label: 'Cancelada', color: 'error' },
};

const filterPills: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'planned', label: 'Pendientes' },
  { value: 'in_progress', label: 'En curso' },
  { value: 'completed', label: 'Completadas' },
  { value: 'cancelled', label: 'Canceladas' },
];

const PAGE_SIZE = 20;

/* ── Segmented filter pill ─────────────────────
   Active = primary filled + white label; inactive = surface-container. */

function CountPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <MuiChip
      label={label}
      onClick={onClick}
      variant="filled"
      sx={{
        flexShrink: 0,
        whiteSpace: 'nowrap',
        fontWeight: active ? 700 : 600,
        ...(active
          ? {
              bgcolor: 'primary.main',
              color: 'white',
              borderColor: 'primary.main',
              boxShadow: 1,
              '&:hover': { bgcolor: 'primary.dark' },
            }
          : {
              bgcolor: 'surfaceContainer',
              color: 'onSurfaceVariant',
              '&:hover': { bgcolor: 'surfaceContainerHigh' },
            }),
      }}
    />
  );
}

/* ── Summary tile ────────────────────────────── */

function SummaryTile({
  label,
  value,
  sub,
  icon,
  iconSx,
}: {
  label: string;
  value: string | number;
  sub: string;
  icon: ReactNode;
  iconSx?: Record<string, unknown>;
}) {
  return (
    <Box
      sx={{
        bgcolor: 'surfaceContainerLowest',
        border: 1,
        borderColor: 'outlineVariant',
        borderRadius: '16px',
        boxShadow: 1,
        p: 2,
        minWidth: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30,
            height: 30,
            borderRadius: '9px',
            bgcolor: 'surfaceContainerHigh',
            color: 'onSurfaceVariant',
            flexShrink: 0,
            ...iconSx,
          }}
        >
          {icon}
        </Box>
        <Typography
          variant="caption"
          color="onSurfaceVariant"
          sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {label}
        </Typography>
      </Box>
      <Typography
        variant="h4"
        sx={{
          fontFamily: 'var(--font-mono)',
          fontWeight: 800,
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.1,
          color: 'onSurface',
        }}
      >
        {value}
      </Typography>
      <Typography variant="caption" sx={{ fontWeight: 600, color: 'onSurfaceVariant', display: 'block', mt: 0.25 }}>
        {sub}
      </Typography>
    </Box>
  );
}

/* ── RoutesPage ─────────────────────────────── */

export function RoutesPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [createDriverId, setCreateDriverId] = useState('');
  const [createDate, setCreateDate] = useState(todayLocalDate());
  const [createVehicleId, setCreateVehicleId] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  // Reads — the status filter keys the routes query; drivers + vehicles feed
  // the create dialog. All three keep the api IndexedDB read-through offline.
  const params = statusFilter === 'all' ? undefined : { status: statusFilter };
  const routesQuery = useRoutes(params);
  const driversQuery = useDrivers();
  const vehiclesQuery = useVehicles();
  const routes = routesQuery.data ?? [];
  const drivers = driversQuery.data ?? [];
  const vehicles = vehiclesQuery.data ?? [];
  const loading = routesQuery.isLoading;
  const driversLoading = driversQuery.isLoading;
  const driversError = driversQuery.error
    ? driversQuery.error instanceof Error
      ? driversQuery.error.message
      : 'Error al cargar repartidores'
    : null;
  const vehiclesLoading = vehiclesQuery.isLoading;

  const readError = routesQuery.error
    ? routesQuery.error instanceof Error
      ? routesQuery.error.message
      : 'Error al cargar rutas'
    : null;

  // Write — offline-aware create invalidates routes + orders.
  const createRoute = useCreateRoute();
  const creating = createRoute.isPending;

  // Reset to the first page whenever the filter changes
  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  const openCreateDialog = () => {
    setShowCreate(true);
  };

  const handleCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!createDriverId.trim() || !createDate) return;
    setCreateError(null);
    createRoute.mutate(
      {
        driverId: createDriverId,
        plannedDate: createDate,
        vehicleId: createVehicleId || undefined,
      },
      {
        onSuccess: (route) => {
          setShowCreate(false);
          setCreateDriverId('');
          setCreateVehicleId('');
          navigate(`/routes/${route._id}`);
        },
        onError: (err) => {
          // Offline queued write: normal outcome, the OfflineBanner already confirmed it.
          if (isOfflineQueuedError(err)) {
            setShowCreate(false);
            setCreateDriverId('');
            setCreateVehicleId('');
            return;
          }
          setCreateError(err instanceof Error ? err.message : 'Error al crear ruta');
        },
      },
    );
  };

  const getCount = (status: RouteStatus) =>
    routes.filter((r) => r.status === status).length;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('es-AR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  };

  /* Real counts from the (unfiltered-by-tab) list: today's planned, in
     progress and completed routes for the summary strip. */
  const counts = useMemo(() => {
    const todayStr = todayLocalDate();
    return {
      today: routes.filter((r) => new Date(r.plannedDate).toISOString().slice(0, 10) === todayStr).length,
      inProgress: getCount('in_progress'),
      completed: getCount('completed'),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes]);

  /* Client-side pagination over the current filter's list */
  const totalPages = Math.max(1, Math.ceil(routes.length / PAGE_SIZE));
  const pageRoutes = useMemo(
    () => routes.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [routes, page]
  );

  if (loading) {
    return <LoadingState label="Cargando rutas…" />;
  }

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
      {/* 1 — Header: primary-fixed icon square + title + "Nueva Ruta" */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 2,
          mb: 4,
          flexDirection: { xs: 'column', md: 'row' },
        }}
      >
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
            <IconRoute size={24} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="h4"
              sx={{ fontWeight: 700, letterSpacing: '-0.02em', color: 'onSurface', lineHeight: 1.2 }}
            >
              Rutas
            </Typography>
            <Typography variant="body2" color="onSurfaceVariant" sx={{ mt: 0.5 }}>
              Organizá las entregas de tus repartidores
            </Typography>
          </Box>
        </Box>
        <MuiButton variant="primary" onClick={openCreateDialog} startIcon={<IconPlus size={18} />}>
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Nueva Ruta</Box>
          <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>Nueva</Box>
        </MuiButton>
      </Box>

      {/* 2 — Summary strip (real counts from the list) */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2, mb: 3 }}>
        <SummaryTile
          label="Rutas hoy"
          icon={<IconCalendar size={18} />}
          iconSx={{ bgcolor: 'primaryContainer', color: 'onPrimaryContainer' }}
          value={counts.today}
          sub="planificadas para hoy"
        />
        <SummaryTile
          label="En curso"
          icon={<IconLocalShipping size={18} />}
          iconSx={{ bgcolor: 'secondaryContainer', color: 'onSecondaryContainer' }}
          value={counts.inProgress}
          sub="repartidores activos"
        />
        <SummaryTile
          label="Completadas"
          icon={<IconCircleCheck size={18} />}
          iconSx={{ bgcolor: 'tertiaryContainer', color: 'onTertiaryContainer' }}
          value={counts.completed}
          sub="entregas cerradas"
        />
      </Box>

      {/* 3 — Segmented filter pills (with counts) */}
      <Box
        sx={{
          display: 'flex',
          gap: 1,
          flexWrap: 'wrap',
          py: 1.5,
          mb: 2.5,
        }}
      >
        {filterPills.map((pill) => {
          const active = statusFilter === pill.value;
          const count = pill.value !== 'all' ? getCount(pill.value as RouteStatus) : routes.length;
          return (
            <CountPill
              key={pill.value}
              label={`${pill.label} (${count})`}
              active={active}
              onClick={() => setStatusFilter(pill.value)}
            />
          );
        })}
      </Box>

      {readError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {readError}
        </Alert>
      )}

      {/* 4 — Route cards */}
      {routes.length === 0 ? (
        <EmptyState
          icon={<IconRoute size={30} />}
          title={statusFilter !== 'all' ? 'Sin rutas en este estado' : 'No hay rutas'}
          subtitle={statusFilter !== 'all'
            ? 'Cambiá el filtro para ver otras rutas.'
            : 'Creá la primera ruta para asignarle entregas a un repartidor.'}
          action={
            <MuiButton variant="primary" startIcon={<IconPlus />} onClick={openCreateDialog}>
              Nueva Ruta
            </MuiButton>
          }
        />
      ) : (
        <>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {pageRoutes.map((route) => {
              const config = routeStatusConfig[route.status];
              const deliveredCount = route.stops.filter((s) => s.status === 'delivered').length;
              const totalStops = route.stops.length;
              const percent = totalStops > 0 ? (deliveredCount / totalStops) * 100 : 0;
              return (
                <Box
                  key={route._id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/routes/${route._id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/routes/${route._id}`);
                    }
                  }}
                  sx={{
                    cursor: 'pointer',
                    p: 2.5,
                    bgcolor: 'surfaceContainerLowest',
                    border: 1,
                    borderColor: 'outlineVariant',
                    borderRadius: '16px',
                    boxShadow: 1,
                    transition: 'box-shadow 0.15s, transform 0.12s, border-color 0.15s',
                    '&:hover': {
                      boxShadow: 4,
                      transform: 'translateY(-1px)',
                      borderColor: 'color-mix(in srgb, var(--mui-palette-primary-main) 45%, transparent)',
                    },
                    '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
                  }}
                >
                  {/* Row 1 — route icon + number + status + progress chips */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 40,
                        height: 40,
                        borderRadius: '12px',
                        bgcolor: 'primaryContainer',
                        color: 'onPrimaryContainer',
                        flexShrink: 0,
                      }}
                    >
                      <IconRoute size={20} />
                    </Box>
                    <Typography
                      variant="body1"
                      sx={{ fontWeight: 700, color: 'onSurface', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      Ruta {route.routeNumber}
                    </Typography>
                    <Box sx={{ ml: 'auto', display: 'flex', gap: 1, alignItems: 'center', flexShrink: 0 }}>
                      {route.status === 'in_progress' && (
                        <MuiChip
                          label={`${deliveredCount}/${totalStops}`}
                          size="small"
                          color="warning"
                          variant="outlined"
                          sx={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
                        />
                      )}
                      <MuiChip label={config.label} color={config.color} size="small" />
                    </Box>
                  </Box>

                  {/* Row 2 — driver + planned date */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1.5, flexWrap: 'wrap' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                      <IconPerson size={15} color="var(--mui-palette-onSurfaceVariant)" />
                      <Typography variant="body2" sx={{ fontWeight: 500, color: 'onSurface', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {route.driverName}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                      <IconEvent size={15} color="var(--mui-palette-onSurfaceVariant)" />
                      <Typography variant="caption" sx={{ fontFamily: 'var(--font-mono)', color: 'onSurfaceVariant', fontVariantNumeric: 'tabular-nums' }}>
                        {formatDate(route.plannedDate)}
                      </Typography>
                    </Box>
                  </Box>

                  {/* Row 3 — progress bar when in progress */}
                  {route.status === 'in_progress' && totalStops > 0 && (
                    <Box sx={{ mt: 1.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.5, gap: 1 }}>
                        <Typography variant="caption" color="onSurfaceVariant" sx={{ fontWeight: 600 }}>
                          {deliveredCount} de {totalStops} entregadas
                        </Typography>
                        <Typography
                          variant="caption"
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
                          height: 8,
                          borderRadius: 9999,
                          bgcolor: 'surfaceContainerHighest',
                          '& .MuiLinearProgress-bar': { borderRadius: 9999 },
                        }}
                      />
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>

          {/* Pagination when the list is long */}
          {totalPages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
              <Pagination
                count={totalPages}
                page={page}
                onChange={(_, value) => setPage(value)}
                color="primary"
                shape="rounded"
              />
            </Box>
          )}
        </>
      )}

      {/* Create Dialog */}
      <MuiDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Nueva Ruta"
        maxWidth="xs"
        actions={
          <>
            <MuiButton variant="ghost" onClick={() => setShowCreate(false)}>
              Cancelar
            </MuiButton>
            <MuiButton
              variant="primary"
              isLoading={creating}
              disabled={creating || drivers.length === 0}
              onClick={() => {
                const form = document.querySelector('[data-create-route-form]') as HTMLFormElement;
                form?.requestSubmit();
              }}
            >
              {creating ? 'Creando...' : 'Crear Ruta'}
            </MuiButton>
          </>
        }
      >
        <Box component="form" data-create-route-form onSubmit={handleCreate} sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <MuiTextField
            label="Repartidor"
            value={createDriverId}
            onChange={(e) => setCreateDriverId(e.target.value)}
            select
            required
            error={!driversLoading && !driversError && drivers.length === 0}
            helperText={
              driversLoading
                ? 'Cargando repartidores…'
                : driversError
                  ? driversError
                  : drivers.length === 0
                    ? 'No hay repartidores registrados'
                    : undefined
            }
            slotProps={{
              input: {
                startAdornment: <InputAdornment position="start"><IconUsers size={18} /></InputAdornment>,
              },
            }}
          >
            {drivers.map((driver) => (
              <MenuItem key={driver._id} value={driver._id}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <IconUsers size={16} />
                  <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      {driver.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {driver.email}
                    </Typography>
                  </Box>
                </Box>
              </MenuItem>
            ))}
          </MuiTextField>
          <MuiTextField
            label="Fecha Planificada"
            type="date"
            value={createDate}
            onChange={(e) => setCreateDate(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            required
          />
          <MuiTextField
            label="Vehículo"
            value={createVehicleId}
            onChange={(e) => setCreateVehicleId(e.target.value)}
            select
            helperText={
              vehiclesLoading
                ? 'Cargando vehículos…'
                : vehicles.length === 0
                  ? 'No hay vehículos activos registrados'
                  : undefined
            }
            slotProps={{
              input: {
                startAdornment: <InputAdornment position="start"><IconCar size={18} /></InputAdornment>,
              },
              select: { displayEmpty: true },
            }}
          >
            <MenuItem value="">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <IconCar size={16} />
                <Typography variant="body2" color="text.secondary">
                  Sin vehículo
                </Typography>
              </Box>
            </MenuItem>
            {vehicles.map((vehicle) => (
              <MenuItem key={vehicle._id} value={vehicle._id}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <IconCar size={16} />
                  <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      {vehicle.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
                      {vehicle.plate}
                    </Typography>
                  </Box>
                </Box>
              </MenuItem>
            ))}
          </MuiTextField>
          {createError && <Alert severity="error">{createError}</Alert>}
        </Box>
      </MuiDialog>
    </Box>
  );
}