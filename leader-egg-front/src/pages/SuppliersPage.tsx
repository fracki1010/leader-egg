import { useState } from 'react';
import { useSuppliers } from '../hooks/queries/index.ts';
import { useUpdateSupplierStatus } from '../hooks/mutations/index.ts';
import { isOfflineQueuedError } from '../hooks/use-offline-mutation.ts';
import type { Supplier } from '../types/index.ts';
import {
  MuiButton,
  MuiChip,
  MuiSnackbar,
  MuiCard,
  EmptyState,
  LoadingState,
} from '../components/ui/index.ts';
import {
  IconEdit,
  IconDelete,
  IconPlus,
  IconPhone,
  IconStore,
} from '../components/ui/icons.tsx';
import { SupplierFormDialog } from '../components/supplier/SupplierFormDialog.tsx';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';

/* ── Types ──────────────────────────────────── */

interface SupplierDialogState {
  mode: 'create' | 'edit';
  supplier: Supplier | null;
}

interface SnackbarState {
  open: boolean;
  message: string;
  severity: 'success' | 'error';
}

/* ── SuppliersPage ──────────────────────────── */

/**
 * SuppliersPage — M3 list of suppliers with create/edit dialog and
 * activate/deactivate toggle. Rendered as the "Proveedores" tab inside
 * ComprasPage (keeps suppliers discoverable without a separate route).
 */
export function SuppliersPage() {
  const [includeInactive, setIncludeInactive] = useState(false);

  // Read — the include-inactive toggle keys the suppliers query.
  const suppliersQuery = useSuppliers(includeInactive);
  const suppliers = suppliersQuery.data ?? [];
  const loading = suppliersQuery.isLoading;

  const readError = suppliersQuery.error
    ? suppliersQuery.error instanceof Error
      ? suppliersQuery.error.message
      : 'Error al cargar proveedores'
    : null;

  // Write — offline-aware status toggle invalidates the suppliers domain.
  const setSupplierStatus = useUpdateSupplierStatus();

  // Mutation (write) error — kept separate from the read error alert.
  const [actionError, setActionError] = useState<string | null>(null);

  // Create/edit dialog state
  const [dialog, setDialog] = useState<SupplierDialogState | null>(null);

  // Snackbar
  const [snackbar, setSnackbar] = useState<SnackbarState>({ open: false, message: '', severity: 'success' });

  const handleToggleStatus = (supplier: Supplier) => {
    const action = supplier.active ? 'desactivar' : 'activar';
    if (!window.confirm(`¿Seguro querés ${action} a "${supplier.name}"?`)) return;

    setSupplierStatus.mutate(
      { id: supplier._id, active: !supplier.active },
      {
        onSuccess: () =>
          setSnackbar({
            open: true,
            message: `Proveedor ${supplier.active ? 'desactivado' : 'activado'}`,
            severity: 'success',
          }),
        onError: (err) => {
          // Offline queued write: normal outcome, the OfflineBanner already confirmed it.
          if (isOfflineQueuedError(err)) {
            setSnackbar({
              open: true,
              message: `Proveedor ${supplier.active ? 'desactivado' : 'activado'} sin conexión`,
              severity: 'success',
            });
            return;
          }
          setActionError(err instanceof Error ? err.message : 'Error al actualizar estado');
        },
      },
    );
  };

  if (loading) {
    return <LoadingState label="Cargando proveedores…" />;
  }

  return (
    <Box>
      {/* Toolbar — inline action row (the page header lives in ComprasPage) */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <Typography variant="subtitle2" color="onSurfaceVariant">
          {suppliers.length} proveedor{suppliers.length === 1 ? '' : 'es'}
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
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
          <MuiButton
            variant="primary"
            startIcon={<IconPlus />}
            onClick={() => setDialog({ mode: 'create', supplier: null })}
          >
            Nuevo Proveedor
          </MuiButton>
        </Box>
      </Box>

      {(readError || actionError) && (
        <Alert severity="error" sx={{ mb: 3 }}>{readError ?? actionError}</Alert>
      )}

      {/* Supplier list */}
      <MuiCard
        variant="elevated"
        sx={{ p: 0, overflow: 'hidden', '& .MuiCardContent-root': { p: 0, '&:last-child': { pb: 0 } } }}
      >
        {suppliers.length === 0 ? (
          <EmptyState
            title="No hay proveedores"
            subtitle="Registrá tu primer proveedor para poder cargar compras."
            action={
              <MuiButton variant="primary" startIcon={<IconPlus />} onClick={() => setDialog({ mode: 'create', supplier: null })}>
                Crear proveedor
              </MuiButton>
            }
          />
        ) : (
          suppliers.map((supplier) => (
            <Box
              key={supplier._id}
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                p: 2,
                px: 3,
                borderBottom: 1,
                borderColor: 'divider',
                gap: 3,
                flexDirection: { xs: 'column', md: 'row' },
                '&:last-child': { borderBottom: 'none' },
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
                  <IconStore size={18} color="var(--mui-palette-primary-main)" />
                  <Typography variant="body1" sx={{ fontWeight: 600 }}>
                    {supplier.name}
                  </Typography>
                  <MuiChip
                    label={supplier.active ? 'Activo' : 'Inactivo'}
                    color={supplier.active ? 'success' : 'error'}
                    size="small"
                    variant="outlined"
                  />
                </Box>
                <Box sx={{ display: 'flex', gap: 3, fontSize: 'body2.fontSize', color: 'text.secondary', flexWrap: 'wrap', alignItems: 'center' }}>
                  {supplier.contact && (
                    <Typography variant="body2" color="text.secondary">
                      Contacto: {supplier.contact}
                    </Typography>
                  )}
                  {supplier.phone && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <IconPhone size={14} color="var(--mui-palette-text-secondary)" />
                      <Typography variant="body2" color="text.secondary">{supplier.phone}</Typography>
                    </Box>
                  )}
                </Box>
              </Box>

              {/* Row actions */}
              <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                <MuiButton variant="ghost" size="sm" onClick={() => setDialog({ mode: 'edit', supplier })} startIcon={<IconEdit />}>
                  Editar
                </MuiButton>
                <MuiButton
                  variant="ghost"
                  size="sm"
                  onClick={() => handleToggleStatus(supplier)}
                  startIcon={<IconDelete />}
                  sx={{ color: supplier.active ? 'error.main' : 'success.main' }}
                >
                  {supplier.active ? 'Desactivar' : 'Activar'}
                </MuiButton>
              </Box>
            </Box>
          ))
        )}
      </MuiCard>

      {/* Create/edit dialog */}
      <SupplierFormDialog
        open={dialog !== null}
        mode={dialog?.mode ?? 'create'}
        supplier={dialog?.supplier ?? null}
        onClose={() => setDialog(null)}
        onSaved={(message) => {
          setSnackbar({ open: true, message, severity: 'success' });
        }}
      />

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