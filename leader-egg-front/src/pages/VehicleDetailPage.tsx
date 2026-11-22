import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { CreateVehiclePayload } from '../api/vehicles.ts';
import type { CostByCategory, FuelType, Route, RouteStatus } from '../types/index.ts';
import { useVehicle, useDrivers } from '../hooks/queries/index.ts';
import { useUpdateVehicle, useSetVehicleStatus } from '../hooks/mutations/index.ts';
import { isOfflineQueuedError } from '../hooks/use-offline-mutation.ts';
import { useSmartBack } from '../hooks/useSmartBack.ts';
import {
  MuiButton,
  MuiChip,
  MuiTextField,
  MuiDialog,
  MuiSnackbar,
  LoadingState,
  EmptyState,
} from '../components/ui/index.ts';
import {
  IconArrowBack,
  IconCar,
  IconDirectionsCar,
  IconEdit,
  IconPerson,
  IconPlus,
  IconRoute,
  IconTruck,
  IconWallet,
} from '../components/ui/icons.tsx';
import { m3Shape } from '../theme/index.ts';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';

/* ═══════════════════════════════════════════════════════════════
   Vehículo — detalle + costos + estadísticas de entregas
   ═══════════════════════════════════════════════════════════════
   Sections:
   1. Header (back + name + plate chip + status + edit)
   2. Info card (ficha técnica)
   3. Costs by category (Σ tagged expenses)
   4. Delivery stats (routes, delivered stops, cost per delivery)
   5. Recent routes (click → /routes/:id)
   ═══════════════════════════════════════════════════════════════ */

/* ── Config ─────────────────────────────────── */

const FUEL_TYPE_LABELS: Record<FuelType, string> = {
  nafta: 'Nafta',
  diesel: 'Diesel',
  gas: 'Gas',
};

const COST_CATEGORY_CONFIG: { key: keyof CostByCategory; label: string }[] = [
  { key: 'fuel', label: 'Combustible' },
  { key: 'repair', label: 'Reparaciones' },
  { key: 'insurance', label: 'Seguro' },
  { key: 'maintenance', label: 'Mantenimiento' },
];

const routeStatusConfig: Record<RouteStatus, { label: string; color: 'primary' | 'warning' | 'success' | 'error' }> = {
  planned: { label: 'Planificada', color: 'primary' },
  in_progress: { label: 'En Progreso', color: 'warning' },
  completed: { label: 'Completada', color: 'success' },
  cancelled: { label: 'Cancelada', color: 'error' },
};

const fmtMoney = (val: number) =>
  `$ ${Math.round(val).toLocaleString('es-AR')}`;

const fmtNum = (val?: number | null) =>
  val == null ? '—' : Math.round(val).toLocaleString('es-AR');

const fmtDate = (dateStr: string) => {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
};

/* ── Info row (label + mono value) ──────────── */

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="onSurfaceVariant" sx={{ display: 'block', fontWeight: 600 }}>
        {label}
      </Typography>
      <Typography
        variant="body1"
        sx={{ fontWeight: 700, color: 'onSurface', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', mt: 0.25 }}
      >
        {value}
      </Typography>
    </Box>
  );
}

/* ── Card header chip ───────────────────────── */

function CardHeader({ icon, title, action }: { icon: ReactNode; title: string; action?: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: m3Shape.medium,
          bgcolor: 'primaryContainer',
          color: 'onPrimaryContainer',
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>
      <Typography variant="titleMedium" sx={{ fontWeight: 700, color: 'onSurface' }}>
        {title}
      </Typography>
      {action && <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center' }}>{action}</Box>}
    </Box>
  );
}

/* ── Edit dialog form ───────────────────────── */

interface FormData {
  name: string;
  model: string;
  plate: string;
  fuelType: FuelType;
  km: string;
  consumption: string;
  insuranceCost: string;
  maintenanceCost: string;
  driverId: string;
  notes: string;
}

/* ── VehicleDetailPage ──────────────────────── */

export function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const goBack = useSmartBack('/vehiculos');

  // Reads — aggregated vehicle detail (ficha, costs, stats, recent routes) plus
  // the drivers for the edit select. Both keep the api offline read-through.
  const vehicleQuery = useVehicle(id);
  const driversQuery = useDrivers();

  const detail = vehicleQuery.data ?? null;
  const drivers = driversQuery.data ?? [];
  const loading = vehicleQuery.isLoading;

  const queryError = vehicleQuery.error;
  const loadError = queryError
    ? queryError instanceof Error
      ? queryError.message
      : 'Error al cargar vehículo'
    : null;

  // Writes — offline-aware; both invalidate vehicles (+ routes on assignment).
  const updateVehicle = useUpdateVehicle();
  const setVehicleStatus = useSetVehicleStatus();
  const submitting = updateVehicle.isPending;

  // Edit dialog
  const [showEdit, setShowEdit] = useState(false);
  const [form, setForm] = useState<FormData | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Action errors (status toggle) — surfaced next to load errors.
  const [actionError, setActionError] = useState<string | null>(null);

  // Snackbar
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  const openEditDialog = () => {
    if (!detail) return;
    setForm({
      name: detail.name,
      model: detail.model ?? '',
      plate: detail.plate,
      fuelType: detail.fuelType,
      km: detail.km != null ? String(detail.km) : '',
      consumption: detail.consumptionKmPerL != null ? String(detail.consumptionKmPerL) : '',
      insuranceCost: detail.insuranceCost != null ? String(detail.insuranceCost) : '',
      maintenanceCost: detail.maintenanceCost != null ? String(detail.maintenanceCost) : '',
      driverId: detail.driverId ?? '',
      notes: detail.notes ?? '',
    });
    setFormError(null);
    setShowEdit(true);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!id || !form) return;
    setFormError(null);

    if (form.name.trim().length < 2) {
      setFormError('El nombre debe tener al menos 2 caracteres');
      return;
    }
    if (!form.plate.trim()) {
      setFormError('La patente es obligatoria');
      return;
    }

    const num = (s: string): number | undefined => {
      const v = parseFloat(s);
      return Number.isNaN(v) || s.trim() === '' ? undefined : v;
    };

    const payload: CreateVehiclePayload = {
      name: form.name.trim(),
      model: form.model.trim() || undefined,
      plate: form.plate.trim(),
      fuelType: form.fuelType,
      km: num(form.km),
      consumptionKmPerL: num(form.consumption),
      insuranceCost: num(form.insuranceCost),
      maintenanceCost: num(form.maintenanceCost),
      driverId: form.driverId || null,
      notes: form.notes.trim() || undefined,
    };

    updateVehicle.mutate(
      { id, data: payload },
      {
        onSuccess: () => {
          setShowEdit(false);
          setSnackbar({ open: true, message: 'Vehículo actualizado', severity: 'success' });
        },
        onError: (err) => {
          // Offline queued write: normal outcome, the OfflineBanner confirmed it.
          if (isOfflineQueuedError(err)) {
            setShowEdit(false);
            setSnackbar({ open: true, message: 'Vehículo guardado (offline)', severity: 'success' });
            return;
          }
          setFormError(err instanceof Error ? err.message : 'Error al guardar vehículo');
        },
      },
    );
  };

  const handleToggleStatus = () => {
    if (!detail) return;
    const action = detail.active ? 'desactivar' : 'activar';
    if (!window.confirm(`¿Seguro querés ${action} "${detail.name}"?`)) return;

    setVehicleStatus.mutate(
      { id: detail._id, active: !detail.active },
      {
        onSuccess: () => {
          setSnackbar({
            open: true,
            message: `Vehículo ${detail.active ? 'desactivado' : 'activado'}`,
            severity: 'success',
          });
        },
        onError: (err) => {
          if (isOfflineQueuedError(err)) return;
          setActionError(err instanceof Error ? err.message : 'Error al actualizar estado');
        },
      },
    );
  };

  if (loading) {
    return <LoadingState label="Cargando vehículo…" />;
  }

  if (!detail) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">Vehículo no encontrado</Alert>
      </Box>
    );
  }

  const driverName = detail.driverId
    ? (drivers.find((d) => d._id === detail.driverId)?.name ?? null)
    : null;

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
      {/* 1 — Header / vehicle identity row */}
      <Box sx={{ mb: 2.5 }}>
        <MuiButton
          variant="ghost"
          size="sm"
          onClick={goBack}
          startIcon={<IconArrowBack size={16} />}
          sx={{ mb: 1, px: 0.5, minHeight: 36 }}
        >
          Vehículos
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
                bgcolor: detail.active ? 'primaryFixed' : 'surfaceContainerHigh',
                color: detail.active ? 'onPrimaryFixed' : 'onSurfaceVariant',
                flexShrink: 0,
              }}
            >
              <IconDirectionsCar size={24} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography
                variant="h5"
                sx={{ fontWeight: 800, letterSpacing: '-0.02em', color: 'onSurface', lineHeight: 1.2 }}
              >
                {detail.name}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                {/* Plate chip — surface-container pill */}
                <Box
                  sx={{
                    px: 1.25,
                    py: 0.25,
                    borderRadius: '9999px',
                    bgcolor: 'surfaceContainer',
                    color: 'onSurfaceVariant',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: '0.04em',
                  }}
                >
                  {detail.plate}
                </Box>
                <MuiChip
                  label={detail.active ? 'Activo' : 'Inactivo'}
                  color={detail.active ? 'success' : 'error'}
                  size="small"
                  variant="outlined"
                />
                <MuiChip label={FUEL_TYPE_LABELS[detail.fuelType]} color="default" size="small" variant="outlined" />
              </Box>
            </Box>
          </Box>
          <Box sx={{ ml: 'auto', display: 'flex', gap: 1, flexShrink: 0, flexWrap: 'wrap' }}>
            <MuiButton variant="secondary" size="sm" onClick={openEditDialog} startIcon={<IconEdit size={16} />}>
              Editar
            </MuiButton>
            <MuiButton
              variant="ghost"
              size="sm"
              onClick={handleToggleStatus}
              sx={{ color: detail.active ? 'error.main' : 'success.main' }}
            >
              {detail.active ? 'Desactivar' : 'Activar'}
            </MuiButton>
          </Box>
        </Box>
      </Box>

      {(loadError || actionError) && (
        <Alert severity="error" sx={{ mb: 3 }}>{loadError || actionError}</Alert>
      )}

      {/* 2 — Info card (ficha técnica) */}
      <Box
        sx={{
          bgcolor: 'surfaceContainerLowest',
          border: 1,
          borderColor: 'outlineVariant',
          borderRadius: '16px',
          boxShadow: 1,
          p: 2.5,
          mb: 3,
        }}
      >
        <CardHeader icon={<IconCar size={18} />} title="Ficha del vehículo" />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2 }}>
          <InfoRow label="Modelo" value={detail.model || '—'} />
          <InfoRow label="Kilometraje" value={detail.km != null ? `${fmtNum(detail.km)} km` : '—'} />
          <InfoRow label="Consumo" value={detail.consumptionKmPerL != null ? `${fmtNum(detail.consumptionKmPerL)} km/l` : '—'} />
          <InfoRow label="Chofer" value={driverName ?? '—'} />
          <InfoRow label="Seguro (ref.)" value={detail.insuranceCost != null ? fmtMoney(detail.insuranceCost) : '—'} />
          <InfoRow label="Mantenimiento (ref.)" value={detail.maintenanceCost != null ? fmtMoney(detail.maintenanceCost) : '—'} />
        </Box>
        {detail.notes && (
          <Typography variant="body2" color="onSurfaceVariant" sx={{ mt: 2 }}>
            {detail.notes}
          </Typography>
        )}
      </Box>

      {/* 3 — Costs by category (Σ tagged expenses) */}
      <Box sx={{ mb: 3 }}>
        <CardHeader
          icon={<IconWallet size={18} />}
          title="Costos por categoría"
          action={
            <MuiButton variant="secondary" size="sm" onClick={() => navigate('/cuentas/movimientos')} startIcon={<IconPlus size={15} />}>
              Registrar gasto
            </MuiButton>
          }
        />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2 }}>
          {COST_CATEGORY_CONFIG.map(({ key, label }) => {
            const amount = detail.costsByCategory[key];
            return (
              <Box
                key={key}
                sx={{
                  bgcolor: 'surfaceContainerLow',
                  borderRadius: m3Shape.medium,
                  p: 2,
                  minWidth: 0,
                }}
              >
                <Typography variant="overline" color="onSurfaceVariant" sx={{ display: 'block', mb: 0.5 }}>
                  {label}
                </Typography>
                <Typography
                  variant="h6"
                  sx={{
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 800,
                    letterSpacing: '-0.02em',
                    fontVariantNumeric: 'tabular-nums',
                    lineHeight: 1.2,
                    color: 'onSurface',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {fmtMoney(amount)}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* 4 — Delivery stats */}
      <Box sx={{ mb: 3 }}>
        <CardHeader icon={<IconTruck size={18} />} title="Entregas" />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
          <Box sx={{ bgcolor: 'surfaceContainerLow', borderRadius: m3Shape.medium, p: 2, minWidth: 0 }}>
            <Typography variant="overline" color="onSurfaceVariant" sx={{ display: 'block', mb: 0.5 }}>
              Rutas
            </Typography>
            <Typography
              variant="h6"
              sx={{ fontFamily: 'var(--font-mono)', fontWeight: 800, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}
            >
              {detail.deliveryStats.routesCount}
            </Typography>
          </Box>
          <Box sx={{ bgcolor: 'surfaceContainerLow', borderRadius: m3Shape.medium, p: 2, minWidth: 0 }}>
            <Typography variant="overline" color="onSurfaceVariant" sx={{ display: 'block', mb: 0.5 }}>
              Paradas entregadas
            </Typography>
            <Typography
              variant="h6"
              sx={{ fontFamily: 'var(--font-mono)', fontWeight: 800, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}
            >
              {detail.deliveryStats.deliveredStops}
            </Typography>
          </Box>
          <Box
            sx={{
              bgcolor: 'primaryContainer',
              color: 'onPrimaryContainer',
              borderRadius: m3Shape.medium,
              p: 2,
              minWidth: 0,
            }}
          >
            <Typography variant="overline" sx={{ display: 'block', mb: 0.5, color: 'onPrimaryContainer', fontWeight: 600 }}>
              Costo por entrega
            </Typography>
            <Typography
              variant="h6"
              sx={{ fontFamily: 'var(--font-mono)', fontWeight: 800, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}
            >
              {fmtMoney(detail.deliveryStats.costPerDelivery)}
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* 5 — Recent routes */}
      <Box>
        <CardHeader icon={<IconRoute size={18} />} title="Rutas recientes" />
        {detail.recentRoutes.length === 0 ? (
          <Box
            sx={{
              bgcolor: 'surfaceContainerLowest',
              border: 1,
              borderColor: 'outlineVariant',
              borderRadius: '16px',
              boxShadow: 1,
            }}
          >
            <EmptyState
              icon={<IconRoute size={30} />}
              title="Sin rutas asignadas"
              subtitle="Las rutas que usen este vehículo aparecerán acá."
            />
          </Box>
        ) : (
          <Box
            sx={{
              bgcolor: 'surfaceContainerLowest',
              border: 1,
              borderColor: 'outlineVariant',
              borderRadius: '16px',
              boxShadow: 1,
              overflow: 'hidden',
            }}
          >
            {detail.recentRoutes.map((route: Route, index: number) => {
              const config = routeStatusConfig[route.status];
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
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    px: 3,
                    py: 2,
                    borderBottom: 1,
                    borderColor: 'divider',
                    gap: 2,
                    flexDirection: { xs: 'column', sm: 'row' },
                    cursor: 'pointer',
                    transition: 'background-color 0.15s ease',
                    '&:hover': { bgcolor: 'action.hover' },
                    ...(index === detail.recentRoutes.length - 1 ? { borderBottom: 'none' } : {}),
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
                      <Typography variant="body1" sx={{ fontWeight: 600 }}>
                        Ruta {route.routeNumber}
                      </Typography>
                      <MuiChip label={config.label} color={config.color} size="small" />
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                      <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtDate(route.plannedDate)}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <IconPerson size={14} color="var(--mui-palette-text-secondary)" />
                        <Typography variant="body2" color="text.secondary">
                          {route.driverName}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>
                  <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                    {route.kmTravelled != null ? (
                      <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtNum(route.kmTravelled)} km
                      </Typography>
                    ) : (
                      <Typography variant="caption" color="text.secondary">Sin km</Typography>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      {/* Edit dialog */}
      {form && (
        <MuiDialog
          open={showEdit}
          onClose={() => setShowEdit(false)}
          title="Editar Vehículo"
          maxWidth="sm"
          actions={
            <>
              <MuiButton variant="ghost" onClick={() => setShowEdit(false)} disabled={submitting}>
                Cancelar
              </MuiButton>
              <MuiButton
                variant="primary"
                isLoading={submitting}
                disabled={submitting}
                onClick={() => {
                  const formEl = document.querySelector('[data-vehicle-edit-form]') as HTMLFormElement | null;
                  formEl?.requestSubmit();
                }}
              >
                {submitting ? 'Guardando...' : 'Guardar Cambios'}
              </MuiButton>
            </>
          }
        >
          <Box component="form" data-vehicle-edit-form onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>
            {formError && <Alert severity="error">{formError}</Alert>}

            <MuiTextField
              label="Nombre"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
              <MuiTextField
                label="Modelo"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
              />
              <MuiTextField
                label="Patente"
                value={form.plate}
                onChange={(e) => setForm({ ...form, plate: e.target.value })}
                required
              />
            </Box>

            <MuiTextField
              label="Combustible"
              value={form.fuelType}
              onChange={(e) => setForm({ ...form, fuelType: e.target.value as FuelType })}
              select
            >
              {Object.entries(FUEL_TYPE_LABELS).map(([value, label]) => (
                <MenuItem key={value} value={value}>{label}</MenuItem>
              ))}
            </MuiTextField>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
              <MuiTextField
                label="Kilometraje (km)"
                type="number"
                value={form.km}
                onChange={(e) => setForm({ ...form, km: e.target.value })}
              />
              <MuiTextField
                label="Consumo (km/l)"
                type="number"
                value={form.consumption}
                onChange={(e) => setForm({ ...form, consumption: e.target.value })}
              />
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
              <MuiTextField
                label="Seguro (referencia)"
                type="number"
                value={form.insuranceCost}
                onChange={(e) => setForm({ ...form, insuranceCost: e.target.value })}
              />
              <MuiTextField
                label="Mantenimiento (referencia)"
                type="number"
                value={form.maintenanceCost}
                onChange={(e) => setForm({ ...form, maintenanceCost: e.target.value })}
              />
            </Box>

            <MuiTextField
              label="Chofer"
              value={form.driverId}
              onChange={(e) => setForm({ ...form, driverId: e.target.value })}
              select
              slotProps={{ select: { displayEmpty: true } }}
            >
              <MenuItem value="">
                <Typography variant="body2" color="text.secondary">Sin chofer asignado</Typography>
              </MenuItem>
              {drivers.map((driver) => (
                <MenuItem key={driver._id} value={driver._id}>
                  <Typography variant="body2" noWrap>{driver.name}</Typography>
                </MenuItem>
              ))}
            </MuiTextField>

            <MuiTextField
              label="Notas (opcional)"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              multiline
              rows={2}
            />
          </Box>
        </MuiDialog>
      )}

      {/* Snackbar */}
      <MuiSnackbar
        open={snackbar.open}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
        severity={snackbar.severity}
      />
    </Box>
  );
}