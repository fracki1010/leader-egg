import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVehicles, useDrivers } from '../hooks/queries/index.ts';
import {
  useCreateVehicle,
  useUpdateVehicle,
  useSetVehicleStatus,
} from '../hooks/mutations/index.ts';
import { isOfflineQueuedError } from '../hooks/use-offline-mutation.ts';
import type { CreateVehiclePayload } from '../api/vehicles.ts';
import type { FuelType, Vehicle } from '../types/index.ts';
import {
  MuiButton,
  MuiChip,
  MuiTextField,
  MuiDialog,
  MuiSnackbar,
  PageHeader,
  LoadingState,
  EmptyState,
} from '../components/ui/index.ts';
import {
  IconCar,
  IconDirectionsCar,
  IconEdit,
  IconPerson,
  IconPlus,
  IconLocalShipping,
} from '../components/ui/icons.tsx';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import MenuItem from '@mui/material/MenuItem';
import InputAdornment from '@mui/material/InputAdornment';

/* ═══════════════════════════════════════════════════════════════
   Vehículos — flota de la empresa
   ═══════════════════════════════════════════════════════════════
   Sections:
   1. Header (yolk icon chip + "Nuevo Vehículo")
   2. White card list (name, plate chip, driver, fuel type, active dot)
   3. Create/edit dialog (ficha técnica + driver select)
   4. Deactivate/activate toggle
   Clicking a card opens /vehiculos/:id (costs + delivery stats).
   ═══════════════════════════════════════════════════════════════ */

/* ── Config ─────────────────────────────────── */

const FUEL_TYPE_LABELS: Record<FuelType, string> = {
  nafta: 'Nafta',
  diesel: 'Diesel',
  gas: 'Gas',
};

interface DialogState {
  mode: 'create' | 'edit';
  vehicle: Vehicle | null;
}

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

const emptyForm: FormData = {
  name: '',
  model: '',
  plate: '',
  fuelType: 'nafta',
  km: '',
  consumption: '',
  insuranceCost: '',
  maintenanceCost: '',
  driverId: '',
  notes: '',
};

const fmtNum = (val?: number | null) =>
  val == null ? '—' : Math.round(val).toLocaleString('es-AR');

/* ── VehiclesPage ───────────────────────────── */

export function VehiclesPage() {
  const navigate = useNavigate();
  const [includeInactive, setIncludeInactive] = useState(false);

  // Reads — the include-inactive toggle keys the vehicles query.
  const vehiclesQuery = useVehicles(includeInactive);
  const driversQuery = useDrivers();
  const vehicles = vehiclesQuery.data ?? [];
  const drivers = driversQuery.data ?? [];
  const loading = vehiclesQuery.isLoading;

  const readError = vehiclesQuery.error
    ? vehiclesQuery.error instanceof Error
      ? vehiclesQuery.error.message
      : 'Error al cargar vehículos'
    : null;

  // Writes — offline-aware mutations invalidate the vehicles domain.
  const createVehicle = useCreateVehicle();
  const updateVehicle = useUpdateVehicle();
  const setVehicleStatus = useSetVehicleStatus();
  const submitting = createVehicle.isPending || updateVehicle.isPending;

  // Create/edit dialog
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  // Mutation (write) error — kept separate from the read error alert.
  const [actionError, setActionError] = useState<string | null>(null);

  // Snackbar
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  const openCreateDialog = () => {
    setForm(emptyForm);
    setFormError(null);
    setDialog({ mode: 'create', vehicle: null });
  };

  const openEditDialog = (vehicle: Vehicle) => {
    setForm({
      name: vehicle.name,
      model: vehicle.model ?? '',
      plate: vehicle.plate,
      fuelType: vehicle.fuelType,
      km: vehicle.km != null ? String(vehicle.km) : '',
      consumption: vehicle.consumptionKmPerL != null ? String(vehicle.consumptionKmPerL) : '',
      insuranceCost: vehicle.insuranceCost != null ? String(vehicle.insuranceCost) : '',
      maintenanceCost: vehicle.maintenanceCost != null ? String(vehicle.maintenanceCost) : '',
      driverId: vehicle.driverId ?? '',
      notes: vehicle.notes ?? '',
    });
    setFormError(null);
    setDialog({ mode: 'edit', vehicle });
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!dialog) return;
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

    const handleSaved = () => {
      setDialog(null);
      setSnackbar({
        open: true,
        message: dialog.mode === 'create' ? 'Vehículo creado' : 'Vehículo actualizado',
        severity: 'success',
      });
    };

    const handleError = (err: unknown) => {
      // Offline queued write: normal outcome, the OfflineBanner already confirmed it.
      if (isOfflineQueuedError(err)) {
        setDialog(null);
        setSnackbar({ open: true, message: 'Vehículo guardado sin conexión', severity: 'success' });
        return;
      }
      setFormError(err instanceof Error ? err.message : 'Error al guardar vehículo');
    };

    if (dialog.mode === 'create') {
      createVehicle.mutate(payload, { onSuccess: handleSaved, onError: handleError });
    } else if (dialog.vehicle) {
      updateVehicle.mutate({ id: dialog.vehicle._id, data: payload }, { onSuccess: handleSaved, onError: handleError });
    }
  };

  const handleToggleStatus = (vehicle: Vehicle) => {
    const action = vehicle.active ? 'desactivar' : 'activar';
    if (!window.confirm(`¿Seguro querés ${action} "${vehicle.name}"?`)) return;

    setVehicleStatus.mutate(
      { id: vehicle._id, active: !vehicle.active },
      {
        onSuccess: () =>
          setSnackbar({
            open: true,
            message: `Vehículo ${vehicle.active ? 'desactivado' : 'activado'}`,
            severity: 'success',
          }),
        onError: (err) => {
          if (isOfflineQueuedError(err)) {
            setSnackbar({
              open: true,
              message: `Vehículo ${vehicle.active ? 'desactivado' : 'activado'} sin conexión`,
              severity: 'success',
            });
            return;
          }
          setActionError(err instanceof Error ? err.message : 'Error al actualizar estado');
        },
      },
    );
  };

  const driverNameOf = (vehicle: Vehicle): string | null =>
    vehicle.driverId ? (drivers.find((d) => d._id === vehicle.driverId)?.name ?? null) : null;

  if (loading) {
    return <LoadingState label="Cargando vehículos…" />;
  }

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
      {/* 1 — Header */}
      <PageHeader
        title="Vehículos"
        subtitle="Administración de la flota de reparto"
        icon={<IconDirectionsCar size={24} />}
        actions={
          <MuiButton variant="primary" onClick={openCreateDialog} startIcon={<IconPlus size={18} />}>
            Nuevo Vehículo
          </MuiButton>
        }
      />

      {/* Toolbar — count + include-inactive toggle */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <Typography variant="subtitle2" color="onSurfaceVariant">
          {vehicles.length} vehículo{vehicles.length === 1 ? '' : 's'}
        </Typography>
        <FormControlLabel
          control={
            <Checkbox
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              color="primary"
            />
          }
          label="Ver inactivos"
          sx={{ flexShrink: 0 }}
        />
      </Box>

      {(readError || actionError) && (
        <Alert severity="error" sx={{ mb: 3 }}>{readError ?? actionError}</Alert>
      )}

      {/* 2 — White card list */}
      {vehicles.length === 0 ? (
        <EmptyState
          icon={<IconCar size={30} />}
          title={includeInactive ? 'No hay vehículos registrados' : 'No hay vehículos activos'}
          subtitle="Registrá un vehículo para asignarlo a las rutas de reparto."
          action={
            <MuiButton variant="primary" startIcon={<IconPlus />} onClick={openCreateDialog}>
              Nuevo Vehículo
            </MuiButton>
          }
        />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {vehicles.map((vehicle) => {
            const driverName = driverNameOf(vehicle);
            return (
              <Box
                key={vehicle._id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/vehiculos/${vehicle._id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(`/vehiculos/${vehicle._id}`);
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
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, flexWrap: 'wrap' }}>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 40,
                      height: 40,
                      borderRadius: '12px',
                      bgcolor: vehicle.active ? 'primaryContainer' : 'surfaceContainerHigh',
                      color: vehicle.active ? 'onPrimaryContainer' : 'onSurfaceVariant',
                      flexShrink: 0,
                    }}
                  >
                    <IconCar size={20} />
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Typography
                        variant="body1"
                        sx={{ fontWeight: 700, color: 'onSurface', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {vehicle.name}
                      </Typography>
                      {/* Plate chip — surface-container pill */}
                      <Box
                        sx={{
                          px: 1.25,
                          py: 0.25,
                          borderRadius: '9999px',
                          bgcolor: 'surfaceContainer',
                          color: 'onSurfaceVariant',
                          fontSize: '0.6875rem',
                          fontWeight: 700,
                          fontFamily: 'var(--font-mono)',
                          letterSpacing: '0.04em',
                          flexShrink: 0,
                        }}
                      >
                        {vehicle.plate}
                      </Box>
                      <MuiChip
                        label={FUEL_TYPE_LABELS[vehicle.fuelType]}
                        color="default"
                        size="small"
                        variant="outlined"
                      />
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 0.75, flexWrap: 'wrap' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                        <IconPerson size={15} color="var(--mui-palette-onSurfaceVariant)" />
                        <Typography variant="body2" color="onSurfaceVariant" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {driverName ?? 'Sin chofer asignado'}
                        </Typography>
                      </Box>
                      {vehicle.km != null && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                          <IconLocalShipping size={15} color="var(--mui-palette-onSurfaceVariant)" />
                          <Typography variant="caption" color="onSurfaceVariant" sx={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                            {fmtNum(vehicle.km)} km
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0 }}>
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: vehicle.active ? 'success.main' : 'outline',
                          flexShrink: 0,
                        }}
                      />
                      <Typography variant="caption" color="onSurfaceVariant">
                        {vehicle.active ? 'Activo' : 'Inactivo'}
                      </Typography>
                    </Box>
                    {/* Stop-click wrappers keep the card navigation from firing */}
                    <Box onClick={(e) => e.stopPropagation()}>
                      <MuiButton
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog(vehicle)}
                        startIcon={<IconEdit size={16} />}
                      >
                        Editar
                      </MuiButton>
                    </Box>
                    <Box onClick={(e) => e.stopPropagation()}>
                      <MuiButton
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleStatus(vehicle)}
                        sx={{ color: vehicle.active ? 'error.main' : 'success.main' }}
                      >
                        {vehicle.active ? 'Desactivar' : 'Activar'}
                      </MuiButton>
                    </Box>
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      {/* 3 — Create/edit dialog */}
      <MuiDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog?.mode === 'create' ? 'Nuevo Vehículo' : 'Editar Vehículo'}
        maxWidth="sm"
        actions={
          <>
            <MuiButton variant="ghost" onClick={() => setDialog(null)} disabled={submitting}>
              Cancelar
            </MuiButton>
            <MuiButton
              variant="primary"
              isLoading={submitting}
              disabled={submitting}
              onClick={() => {
                const formEl = document.querySelector('[data-vehicle-form]') as HTMLFormElement | null;
                formEl?.requestSubmit();
              }}
            >
              {submitting ? 'Guardando...' : dialog?.mode === 'create' ? 'Crear Vehículo' : 'Guardar Cambios'}
            </MuiButton>
          </>
        }
      >
        <Box component="form" data-vehicle-form onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}

          <MuiTextField
            label="Nombre"
            placeholder="Nombre del vehículo"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            slotProps={{
              input: {
                startAdornment: <InputAdornment position="start"><IconCar size={16} color="var(--mui-palette-onSurfaceVariant)" /></InputAdornment>,
              },
            }}
          />

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <MuiTextField
              label="Modelo"
              placeholder="Marca y modelo (opcional)"
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
            />
            <MuiTextField
              label="Patente"
              placeholder="AB123CD"
              value={form.plate}
              onChange={(e) => setForm({ ...form, plate: e.target.value })}
              required
              slotProps={{ htmlInput: { maxLength: 20 } }}
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
              placeholder="0"
            />
            <MuiTextField
              label="Consumo (km/l)"
              type="number"
              value={form.consumption}
              onChange={(e) => setForm({ ...form, consumption: e.target.value })}
              placeholder="0"
            />
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <MuiTextField
              label="Seguro (referencia)"
              type="number"
              value={form.insuranceCost}
              onChange={(e) => setForm({ ...form, insuranceCost: e.target.value })}
              placeholder="0.00"
            />
            <MuiTextField
              label="Mantenimiento (referencia)"
              type="number"
              value={form.maintenanceCost}
              onChange={(e) => setForm({ ...form, maintenanceCost: e.target.value })}
              placeholder="0.00"
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
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <IconPerson size={16} />
                  <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <Typography variant="body2" noWrap>{driver.name}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>{driver.email}</Typography>
                  </Box>
                </Box>
              </MenuItem>
            ))}
          </MuiTextField>

          <MuiTextField
            label="Notas (opcional)"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            multiline
            rows={2}
            placeholder="Observaciones sobre el vehículo"
          />
        </Box>
      </MuiDialog>

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