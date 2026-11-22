import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlatformTenants } from '../hooks/queries/index.ts';
import { useCreateTenant, useUpdateTenant, useDeleteTenant, useResetPlatformTenant } from '../hooks/mutations/index.ts';
import {
  MuiButton,
  MuiTextField,
  MuiDialog,
  MuiSnackbar,
  MuiChip,
  MuiCard,
  PageHeader,
  LoadingState,
  EmptyState,
} from '../components/ui/index.ts';
import {
  IconAdminPanelSettings,
  IconPlus,
  IconDelete,
  IconWarning,
  IconStorefront,
  IconPersonAdd,
  IconPointOfSale,
  IconRefresh,
} from '../components/ui/icons.tsx';
import type { CreateTenantRequest, PlatformTenant } from '../types/index.ts';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import MuiAlert from '@mui/material/Alert';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';

/* ═══════════════════════════════════════════════════════════════
   PlatformTenantsPage — the multi-tenant company manager.
   Lists every registered company and offers provision / suspend /
   activate / delete. Only reachable with a platform admin session.
   ═══════════════════════════════════════════════════════════════ */

/* ── Helpers ─────────────────────────────────────────────────── */

/** Derive a URL/db-safe slug from a company name: lowercase a-z0-9 with dashes. */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Keep an editable slug inside the [a-z0-9-] alphabet. */
function sanitizeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
}

const formatDate = (d: string): string =>
  new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });

const friendlyError = (message: string): string => {
  if (/slug.*(taken|exists|use)/i.test(message)) return 'Ese slug ya está en uso';
  if (/slug/i.test(message)) return 'El slug no es válido';
  if (/email/i.test(message)) return 'El email del administrador no es válido';
  if (/not found/i.test(message)) return 'La empresa no existe';
  return message;
};

/* ── Create form ─────────────────────────────────────────────── */

interface CreateForm {
  name: string;
  slug: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  plan: string;
}

const emptyForm: CreateForm = {
  name: '',
  slug: '',
  adminName: '',
  adminEmail: '',
  adminPassword: '',
  plan: '',
};

/* ── Tenant card ─────────────────────────────────────────────── */

function TenantCard({
  tenant,
  onToggleActive,
  onPuntoCero,
  onReset,
  onDelete,
  toggling,
  resetting,
}: {
  tenant: PlatformTenant;
  onToggleActive: (tenant: PlatformTenant) => void;
  onPuntoCero: (tenant: PlatformTenant) => void;
  onReset: (tenant: PlatformTenant) => void;
  onDelete: (tenant: PlatformTenant) => void;
  toggling: boolean;
  resetting: boolean;
}) {
  return (
    <MuiCard variant="elevated" sx={{ p: 0 }}>
      {/* Identity + status */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, minWidth: 0 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 44,
            height: 44,
            borderRadius: '14px',
            bgcolor: 'primaryContainer',
            color: 'onPrimaryContainer',
            flexShrink: 0,
          }}
        >
          <IconStorefront size={22} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            variant="titleMedium"
            sx={{ fontWeight: 700, color: 'onSurface', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {tenant.name}
          </Typography>
          <Typography
            component="div"
            variant="labelMedium"
            color="onSurfaceVariant"
            sx={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
            noWrap
          >
            @{tenant.slug}
          </Typography>
        </Box>
        <MuiChip
          label={tenant.active ? 'Activa' : 'Suspendida'}
          color={tenant.active ? 'success' : 'warning'}
          sx={{ flexShrink: 0 }}
        />
      </Box>

      {/* Meta grid */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 1.5,
          mt: 2,
          px: 1.5,
          py: 1.5,
          borderRadius: '12px',
          bgcolor: 'surfaceContainerLow',
          border: 1,
          borderColor: 'outlineVariant',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="labelSmall" color="onSurfaceVariant" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Base de datos
          </Typography>
          <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }} noWrap>
            {tenant.dbName}
          </Typography>
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="labelSmall" color="onSurfaceVariant" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Usuarios
          </Typography>
          <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {tenant.userCount ?? '—'}
          </Typography>
        </Box>
        <Box sx={{ minWidth: 0, gridColumn: '1 / -1' }}>
          <Typography variant="labelSmall" color="onSurfaceVariant" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Alta
          </Typography>
          <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
            {formatDate(tenant.createdAt)}
          </Typography>
        </Box>
      </Box>

      {/* Actions */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          mt: 1.5,
          pt: 1.5,
          borderTop: 1,
          borderColor: 'outlineVariant',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <MuiButton
            variant="secondary"
            size="sm"
            onClick={() => onPuntoCero(tenant)}
            startIcon={<IconPointOfSale size={18} />}
          >
            Punto Cero
          </MuiButton>
          <MuiButton
            variant="ghost"
            size="sm"
            onClick={() => onReset(tenant)}
            startIcon={<IconRefresh size={18} />}
            isLoading={resetting}
            sx={{
              color: 'error.main',
              '&:hover': { bgcolor: 'errorContainer', color: 'onErrorContainer' },
            }}
          >
            Resetear datos
          </MuiButton>
          <MuiButton variant="secondary" size="sm" onClick={() => onToggleActive(tenant)} isLoading={toggling}>
            {tenant.active ? 'Suspender' : 'Activar'}
          </MuiButton>
        </Box>
        <IconButton
          aria-label={`Eliminar ${tenant.name}`}
          size="small"
          onClick={() => onDelete(tenant)}
          sx={{
            width: 40,
            height: 40,
            color: 'onSurfaceVariant',
            '&:hover': { bgcolor: 'errorContainer', color: 'onErrorContainer' },
          }}
        >
          <IconDelete size={18} />
        </IconButton>
      </Box>
    </MuiCard>
  );
}

/* ── Page ────────────────────────────────────────────────────── */

export function PlatformTenantsPage() {
  const navigate = useNavigate();
  const tenantsQuery = usePlatformTenants();
  const tenants = tenantsQuery.data ?? [];
  const loading = tenantsQuery.isLoading;
  const queryError = tenantsQuery.error;
  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : 'Error al cargar empresas'
    : null;

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>(emptyForm);
  const [slugEdited, setSlugEdited] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<PlatformTenant | null>(null);
  const [deleteSlug, setDeleteSlug] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Reset dialog
  const [resetTarget, setResetTarget] = useState<PlatformTenant | null>(null);
  const [resetSlug, setResetSlug] = useState('');
  const [resetZeroDebt, setResetZeroDebt] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  // Snackbar
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  const createTenant = useCreateTenant();
  const updateTenant = useUpdateTenant();
  const deleteTenant = useDeleteTenant();
  const resetTenant = useResetPlatformTenant();
  const submitting = createTenant.isPending;
  const deleting = deleteTenant.isPending;
  const resetting = resetTenant.isPending;

  /* ── Create ─────────────────────────────────── */

  const openCreate = () => {
    setForm(emptyForm);
    setSlugEdited(false);
    setFormError(null);
    setCreateOpen(true);
  };

  const closeCreate = () => {
    if (submitting) return;
    setCreateOpen(false);
    setForm(emptyForm);
    setSlugEdited(false);
    setFormError(null);
  };

  const handleCreate = () => {
    setFormError(null);

    const name = form.name.trim();
    const slug = form.slug.trim();
    const adminName = form.adminName.trim();
    const adminEmail = form.adminEmail.trim();
    const adminPassword = form.adminPassword;
    const plan = form.plan.trim();

    if (!name || !slug || !adminName || !adminEmail || !adminPassword) {
      setFormError('Completá todos los campos obligatorios');
      return;
    }

    const payload: CreateTenantRequest = {
      name,
      slug,
      adminName,
      adminEmail,
      adminPassword,
      ...(plan ? { plan } : {}),
    };

    createTenant.mutate(payload, {
      onSuccess: () => {
        closeCreate();
        setSnackbar({ open: true, message: 'Empresa creada correctamente', severity: 'success' });
      },
      onError: (err) => {
        setFormError(friendlyError(err instanceof Error ? err.message : 'Error al crear la empresa'));
      },
    });
  };

  const handleCreateSubmit = (e: FormEvent) => {
    e.preventDefault();
    handleCreate();
  };

  /* ── Toggle active ──────────────────────────── */

  const handleToggleActive = (tenant: PlatformTenant) => {
    updateTenant.mutate(
      { id: tenant.id, data: { active: !tenant.active } },
      {
        onSuccess: (updated) => {
          setSnackbar({
            open: true,
            message: updated.active ? `${updated.name} activada` : `${updated.name} suspendida`,
            severity: 'success',
          });
        },
        onError: (err) => {
          setSnackbar({
            open: true,
            message: friendlyError(err instanceof Error ? err.message : 'Error al actualizar la empresa'),
            severity: 'error',
          });
        },
      },
    );
  };

  /* ── Delete ─────────────────────────────────── */

  const openDelete = (tenant: PlatformTenant) => {
    setDeleteTarget(tenant);
    setDeleteSlug('');
    setDeleteError(null);
  };

  const closeDelete = () => {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteSlug('');
    setDeleteError(null);
  };

  const canDelete = deleteTarget !== null && deleteSlug === deleteTarget.slug;

  const handleDelete = () => {
    if (!deleteTarget || !canDelete) return;
    setDeleteError(null);

    deleteTenant.mutate(
      { id: deleteTarget.id, slug: deleteSlug },
      {
        onSuccess: () => {
          setSnackbar({ open: true, message: 'Empresa eliminada', severity: 'success' });
          setDeleteTarget(null);
          setDeleteSlug('');
        },
        onError: (err) => {
          setDeleteError(friendlyError(err instanceof Error ? err.message : 'Error al eliminar la empresa'));
        },
      },
    );
  };

  /* ── Reset ──────────────────────────────────── */

  const openReset = (tenant: PlatformTenant) => {
    setResetTarget(tenant);
    setResetSlug('');
    setResetZeroDebt(false);
    setResetError(null);
  };

  const closeReset = () => {
    if (resetting) return;
    setResetTarget(null);
    setResetSlug('');
    setResetZeroDebt(false);
    setResetError(null);
  };

  const canReset = resetTarget !== null && resetSlug === resetTarget.slug;

  const handleReset = () => {
    if (!resetTarget || !canReset) return;
    setResetError(null);

    resetTenant.mutate(
      {
        tenantId: resetTarget.id,
        payload: { confirm: resetSlug, zeroCustomerDebt: resetZeroDebt },
      },
      {
        onSuccess: (result) => {
          const deletedCount = Object.values(result.deleted).reduce((sum, count) => sum + count, 0);
          const collectionCount = Object.keys(result.deleted).length;
          setSnackbar({
            open: true,
            message: `Reset completo: ${deletedCount} registros borrados en ${collectionCount} colecciones`,
            severity: 'success',
          });
          setResetTarget(null);
          setResetSlug('');
          setResetZeroDebt(false);
        },
        onError: (err) => {
          setResetError(
            friendlyError(err instanceof Error ? err.message : 'Error al resetear los datos'),
          );
        },
      },
    );
  };

  /* ── Render ─────────────────────────────────── */

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
      <PageHeader
        title="Panel de Plataforma"
        subtitle="Administrá las empresas registradas en El Huevo Líder"
        icon={<IconAdminPanelSettings size={24} />}
        actions={
          <MuiButton variant="primary" onClick={openCreate} startIcon={<IconPlus size={18} />}>
            Nueva empresa
          </MuiButton>
        }
      />

      {error && (
        <MuiAlert severity="error" sx={{ mb: 2.5 }}>
          {error}
        </MuiAlert>
      )}

      {loading ? (
        <LoadingState label="Cargando empresas…" />
      ) : tenants.length === 0 ? (
        <EmptyState
          icon={<IconStorefront size={30} />}
          title="No hay empresas"
          subtitle="Creá la primera empresa para empezar a gestionar el sistema multi-empresa."
          action={
            <MuiButton variant="primary" startIcon={<IconPlus />} onClick={openCreate}>
              Nueva empresa
            </MuiButton>
          }
        />
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
          {tenants.map((tenant) => (
            <TenantCard
              key={tenant.id}
              tenant={tenant}
              toggling={updateTenant.isPending && updateTenant.variables?.id === tenant.id}
              onToggleActive={handleToggleActive}
              onPuntoCero={(t) => navigate(`/platform/tenants/${t.id}/punto-cero`)}
              onReset={openReset}
              onDelete={openDelete}
              resetting={resetting && resetTenant.variables?.tenantId === tenant.id}
            />
          ))}
        </Box>
      )}

      {/* Create dialog */}
      <MuiDialog
        open={createOpen}
        onClose={closeCreate}
        title="Nueva empresa"
        maxWidth="sm"
        actions={
          <>
            <MuiButton variant="secondary" onClick={closeCreate} disabled={submitting}>
              Cancelar
            </MuiButton>
            <MuiButton variant="primary" isLoading={submitting} disabled={submitting} onClick={handleCreate}>
              {submitting ? 'Creando...' : 'Crear empresa'}
            </MuiButton>
          </>
        }
      >
        <Box component="form" onSubmit={handleCreateSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>
          {formError && <MuiAlert severity="error">{formError}</MuiAlert>}

          <MuiTextField
            label="Nombre de la empresa"
            placeholder="Distribuidora del Sur"
            value={form.name}
            onChange={(e) => {
              const value = e.target.value;
              setForm((prev) => ({ ...prev, name: value, slug: slugEdited ? prev.slug : slugify(value) }));
            }}
            required
            autoFocus
          />

          <MuiTextField
            label="Slug"
            placeholder="distribuidora-del-sur"
            value={form.slug}
            onChange={(e) => {
              setSlugEdited(true);
              setForm((prev) => ({ ...prev, slug: sanitizeSlug(e.target.value) }));
            }}
            required
            helperText="Identificador único: minúsculas, números y guiones (a-z0-9-)"
          />

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderRadius: '12px', bgcolor: 'surfaceContainerLow' }}>
            <IconPersonAdd size={16} color="var(--mui-palette-onSurfaceVariant)" style={{ flexShrink: 0 }} />
            <Typography variant="caption" color="onSurfaceVariant" sx={{ fontWeight: 600 }}>
              Se creará un administrador para esta empresa.
            </Typography>
          </Box>

          <MuiTextField
            label="Nombre del administrador"
            placeholder="Nombre completo"
            value={form.adminName}
            onChange={(e) => setForm((prev) => ({ ...prev, adminName: e.target.value }))}
            required
          />

          <MuiTextField
            label="Email del administrador"
            type="email"
            placeholder="admin@empresa.com"
            value={form.adminEmail}
            onChange={(e) => setForm((prev) => ({ ...prev, adminEmail: e.target.value }))}
            required
          />

          <MuiTextField
            label="Contraseña del administrador"
            type="password"
            placeholder="Mínimo 6 caracteres"
            value={form.adminPassword}
            onChange={(e) => setForm((prev) => ({ ...prev, adminPassword: e.target.value }))}
            required
            autoComplete="new-password"
          />

          <MuiTextField
            label="Plan (opcional)"
            placeholder="básico, pro…"
            value={form.plan}
            onChange={(e) => setForm((prev) => ({ ...prev, plan: e.target.value }))}
          />
        </Box>
      </MuiDialog>

      {/* Delete dialog */}
      <MuiDialog
        open={deleteTarget !== null}
        onClose={closeDelete}
        title="Eliminar empresa"
        maxWidth="xs"
        actions={
          <>
            <MuiButton variant="secondary" onClick={closeDelete} disabled={deleting}>
              Cancelar
            </MuiButton>
            <MuiButton
              variant="danger"
              isLoading={deleting}
              disabled={deleting || !canDelete}
              startIcon={<IconDelete />}
              onClick={handleDelete}
            >
              {deleting ? 'Eliminando...' : 'Eliminar empresa'}
            </MuiButton>
          </>
        }
      >
        {deleteTarget && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <MuiAlert severity="warning" icon={<IconWarning size={16} />}>
              Se eliminará TODA la información de <Box component="span" sx={{ fontWeight: 700 }}>{deleteTarget.name}</Box>.
              Esta acción no se puede deshacer.
            </MuiAlert>

            {deleteError && <MuiAlert severity="error">{deleteError}</MuiAlert>}

            <MuiTextField
              label="Escribí el slug para confirmar"
              placeholder={deleteTarget.slug}
              value={deleteSlug}
              onChange={(e) => setDeleteSlug(e.target.value)}
              required
              autoFocus
              helperText={`Slug: ${deleteTarget.slug}`}
            />
          </Box>
        )}
      </MuiDialog>

      {/* Reset dialog */}
      <MuiDialog
        open={resetTarget !== null}
        onClose={closeReset}
        title="Resetear datos"
        maxWidth="sm"
        actions={
          <>
            <MuiButton variant="secondary" onClick={closeReset} disabled={resetting}>
              Cancelar
            </MuiButton>
            <MuiButton
              variant="ghost"
              isLoading={resetting}
              disabled={resetting || !canReset}
              startIcon={<IconRefresh />}
              onClick={handleReset}
              sx={{
                color: 'error.main',
                '&:hover': { bgcolor: 'errorContainer', color: 'onErrorContainer' },
              }}
            >
              {resetting ? 'Reseteando...' : 'Resetear datos'}
            </MuiButton>
          </>
        }
      >
        {resetTarget && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <MuiAlert severity="warning" icon={<IconWarning size={16} />}>
              Se borrarán los datos operativos de{' '}
              <Box component="span" sx={{ fontWeight: 700 }}>
                {resetTarget.name}
              </Box>
              . El Punto Cero volverá a quedar pendiente. Esta acción no se puede deshacer.
            </MuiAlert>

            {resetError && <MuiAlert severity="error">{resetError}</MuiAlert>}

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                gap: 1.5,
              }}
            >
              <Box
                sx={{
                  px: 1.5,
                  py: 1.25,
                  borderRadius: '12px',
                  bgcolor: 'surfaceContainerLow',
                  border: 1,
                  borderColor: 'outlineVariant',
                }}
              >
                <Typography
                  variant="labelMedium"
                  sx={{ fontWeight: 700, color: 'success.main', mb: 0.5 }}
                >
                  SE CONSERVA
                </Typography>
                <Typography variant="body2" color="onSurfaceVariant">
                  Clientes, usuarios, productos y precios. El stock queda en cero.
                </Typography>
              </Box>
              <Box
                sx={{
                  px: 1.5,
                  py: 1.25,
                  borderRadius: '12px',
                  bgcolor: 'errorContainer',
                  border: 1,
                  borderColor: 'error.main',
                }}
              >
                <Typography
                  variant="labelMedium"
                  sx={{ fontWeight: 700, color: 'onErrorContainer', mb: 0.5 }}
                >
                  SE BORRA
                </Typography>
                <Typography variant="body2" sx={{ color: 'onErrorContainer' }}>
                  Pedidos, pagos, compras, gastos, devoluciones, rutas, vehículos, proveedores,
                  promociones, ajustes de caja, cuentas corrientes, cierres diarios, movimientos de
                  stock y contadores.
                </Typography>
              </Box>
            </Box>

            <MuiTextField
              label="Escribí el slug para confirmar"
              placeholder={resetTarget.slug}
              value={resetSlug}
              onChange={(e) => setResetSlug(e.target.value)}
              required
              autoFocus
              disabled={resetting}
              helperText={`Slug: ${resetTarget.slug}`}
            />

            <FormControlLabel
              control={
                <Checkbox
                  checked={resetZeroDebt}
                  onChange={(e) => setResetZeroDebt(e.target.checked)}
                  disabled={resetting}
                />
              }
              label="Poner también en cero la deuda de los clientes"
            />
          </Box>
        )}
      </MuiDialog>

      <MuiSnackbar
        open={snackbar.open}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
        severity={snackbar.severity}
      />
    </Box>
  );
}
