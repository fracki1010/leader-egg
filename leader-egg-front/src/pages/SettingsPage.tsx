import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import Alert from '@mui/material/Alert';
import Avatar from '@mui/material/Avatar';
import { useAuthStore } from '../stores/authStore.ts';
import { useBusinessProfile, usePuntoCero } from '../hooks/queries/index.ts';
import { useUpdateBusinessProfile } from '../hooks/mutations/index.ts';
import { MuiButton, MuiSnackbar, MuiTextField, PageHeader } from '../components/ui/index.ts';
import { ChangePasswordDialog } from '../components/settings/ChangePasswordDialog.tsx';
import { OpeningBalancesSection } from '../components/settings/OpeningBalancesSection.tsx';
import { ThemeToggle } from '../components/ThemeToggle.tsx';
import { InstallBanner } from '../components/driver/InstallBanner.tsx';
import { ROLE_LABELS } from '../lib/permissions.ts';
import { RUNNING_BUILD_ID, checkForNewVersion } from '../lib/app-version.ts';
import { m3Shape } from '../theme/index.ts';
import {
  IconChevronRight,
  IconCircleCheck,
  IconDownload,
  IconInfo,
  IconKey,
  IconLock,
  IconLogout,
  IconRefresh,
  IconSettings,
  IconShieldPerson,
  IconStorefront,
  IconUsers,
} from '../components/ui/icons.tsx';
import type { BusinessProfile } from '../types/index.ts';

/* ── Layout primitives ───────────────────────── */

function SettingsSection({ children }: { children: ReactNode }) {
  return (
    <Box
      component="section"
      sx={{
        mb: 3,
        p: { xs: 2, sm: 2.5 },
        borderRadius: '20px',
        bgcolor: 'surfaceContainer',
        border: 1,
        borderColor: 'outlineVariant',
        minWidth: 0,
      }}
    >
      {children}
    </Box>
  );
}

function SectionHeading({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 2, minWidth: 0 }}>
      <Box sx={{ display: 'flex', color: 'onSurfaceVariant', mt: '2px', flexShrink: 0 }}>{icon}</Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography component="div" variant="titleSmall" sx={{ fontWeight: 700, color: 'onSurface' }}>
          {title}
        </Typography>
        {description && (
          <Typography component="div" variant="caption" color="onSurfaceVariant" sx={{ mt: 0.25 }}>
            {description}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function RowButton({
  icon,
  label,
  description,
  onClick,
  tone = 'default',
  ariaLabel,
}: {
  icon: ReactNode;
  label: string;
  description?: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
  ariaLabel?: string;
}) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        width: '100%',
        minHeight: 52,
        px: 1,
        py: 1,
        borderRadius: m3Shape.medium,
        border: 0,
        bgcolor: 'transparent',
        textAlign: 'left',
        cursor: 'pointer',
        color: tone === 'danger' ? 'error.main' : 'onSurface',
        '&:hover': { bgcolor: 'action.hover' },
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: 2,
        },
      }}
    >
      <Box
        aria-hidden="true"
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          borderRadius: m3Shape.medium,
          flexShrink: 0,
          bgcolor: tone === 'danger' ? 'errorContainer' : 'surfaceContainerHigh',
          color: tone === 'danger' ? 'onErrorContainer' : 'onSurfaceVariant',
        }}
      >
        {icon}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography component="div" variant="body1" sx={{ fontWeight: 500 }}>
          {label}
        </Typography>
        {description && (
          <Typography component="div" variant="caption" color="onSurfaceVariant">
            {description}
          </Typography>
        )}
      </Box>
      <Box aria-hidden="true" sx={{ display: 'flex', color: 'onSurfaceVariant', flexShrink: 0 }}>
        <IconChevronRight size={18} />
      </Box>
    </Box>
  );
}

/* ── Business profile ───────────────────────── */

const EMPTY_PROFILE: BusinessProfile = { businessName: '', address: '', phone: '' };

function BusinessProfileForm() {
  const query = useBusinessProfile();
  const update = useUpdateBusinessProfile();

  const [form, setForm] = useState<BusinessProfile>(EMPTY_PROFILE);
  const [initial, setInitial] = useState<BusinessProfile>(EMPTY_PROFILE);
  const [formError, setFormError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error';
  }>({ open: false, message: '', severity: 'success' });

  useEffect(() => {
    if (!query.data) return;
    setForm(query.data);
    setInitial(query.data);
  }, [query.data]);

  const dirty =
    form.businessName !== initial.businessName ||
    form.address !== initial.address ||
    form.phone !== initial.phone;
  const submitting = update.isPending;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const businessName = form.businessName.trim();
    if (!businessName) {
      setFormError('El nombre del negocio es obligatorio');
      return;
    }
    if (businessName.length > 120) {
      setFormError('El nombre del negocio no puede superar los 120 caracteres');
      return;
    }
    if (form.address.trim().length > 200) {
      setFormError('La dirección no puede superar los 200 caracteres');
      return;
    }
    if (form.phone.trim().length > 40) {
      setFormError('El teléfono no puede superar los 40 caracteres');
      return;
    }

    // PATCH only the fields that actually changed.
    const payload: Partial<BusinessProfile> = {};
    if (businessName !== initial.businessName) payload.businessName = businessName;
    if (form.address.trim() !== initial.address) payload.address = form.address.trim();
    if (form.phone.trim() !== initial.phone) payload.phone = form.phone.trim();

    if (Object.keys(payload).length === 0) return;

    update.mutate(payload, {
      onSuccess: (data) => {
        setForm(data);
        setInitial(data);
        setSnackbar({ open: true, message: 'Perfil del negocio actualizado', severity: 'success' });
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : 'Error al guardar el perfil';
        setFormError(message);
        setSnackbar({ open: true, message, severity: 'error' });
      },
    });
  };

  if (query.isLoading) {
    return (
      <Typography component="p" variant="body2" color="onSurfaceVariant">
        Cargando perfil del negocio…
      </Typography>
    );
  }

  if (query.error && !query.data) {
    return (
      <Alert
        severity="error"
        action={
          <MuiButton variant="ghost" size="sm" onClick={() => void query.refetch()}>
            Reintentar
          </MuiButton>
        }
      >
        {query.error instanceof Error ? query.error.message : 'Error al cargar el perfil'}
      </Alert>
    );
  }

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {formError && <Alert severity="error">{formError}</Alert>}

      <MuiTextField
        label="Nombre del negocio"
        value={form.businessName}
        onChange={(e) => setForm((prev) => ({ ...prev, businessName: e.target.value }))}
        required
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <MuiTextField
        label="Dirección"
        value={form.address}
        onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <MuiTextField
        label="Teléfono"
        value={form.phone}
        onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
        slotProps={{ inputLabel: { shrink: true } }}
      />

      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <MuiButton
          variant="primary"
          type="submit"
          isLoading={submitting}
          disabled={submitting || !dirty}
        >
          {submitting ? 'Guardando...' : dirty ? 'Guardar cambios' : 'Sin cambios'}
        </MuiButton>
      </Box>

      <MuiSnackbar
        open={snackbar.open}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        message={snackbar.message}
        severity={snackbar.severity}
      />
    </Box>
  );
}

/* ── Punto cero summary ─────────────────────── */

function PuntoCeroSummary({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const navigate = useNavigate();
  const query = usePuntoCero(true);
  const finalized = query.data?.finalized ?? false;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', minHeight: 52 }}>
      <Box
        aria-hidden="true"
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          borderRadius: m3Shape.medium,
          bgcolor: finalized ? 'successContainer' : 'warningContainer',
          color: finalized ? 'onSuccessContainer' : 'onWarningContainer',
          flexShrink: 0,
        }}
      >
        {finalized ? <IconCircleCheck size={20} /> : <IconInfo size={20} />}
      </Box>
      <Box sx={{ flex: 1, minWidth: 140 }}>
        <Typography component="div" variant="body1" sx={{ fontWeight: 500 }}>
          Punto Cero
        </Typography>
        <Typography component="div" variant="caption" color="onSurfaceVariant">
          {query.isLoading
            ? 'Cargando estado…'
            : finalized
              ? 'Configuración finalizada'
              : 'Configuración pendiente'}
        </Typography>
      </Box>
      {isSuperAdmin && (
        <MuiButton
          variant="secondary"
          size="sm"
          onClick={() => navigate('/setup/punto-cero')}
          sx={{ borderRadius: m3Shape.full }}
        >
          Abrir Punto Cero
        </MuiButton>
      )}
    </Box>
  );
}

/* ── Application ────────────────────────────── */

function ApplicationSection({ isDriver }: { isDriver: boolean }) {
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<'idle' | 'available' | 'current'>('idle');
  const [installDismissed, setInstallDismissed] = useState(false);

  const handleCheck = async () => {
    setChecking(true);
    try {
      const available = await checkForNewVersion();
      setCheckResult(available ? 'available' : 'current');
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', minHeight: 52 }}>
        <Box
          aria-hidden="true"
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 40,
            height: 40,
            borderRadius: m3Shape.medium,
            bgcolor: 'surfaceContainerHigh',
            color: 'onSurfaceVariant',
            flexShrink: 0,
          }}
        >
          <IconSettings size={20} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 140 }}>
          <Typography component="div" variant="body1" sx={{ fontWeight: 500 }}>
            Versión instalada
          </Typography>
          <Typography
            component="div"
            variant="caption"
            color="onSurfaceVariant"
            sx={{ fontFamily: 'var(--font-mono)', overflowWrap: 'anywhere' }}
          >
            {RUNNING_BUILD_ID}
          </Typography>
        </Box>
        <MuiButton
          variant="secondary"
          size="sm"
          startIcon={<IconRefresh size={16} />}
          onClick={() => void handleCheck()}
          isLoading={checking}
          disabled={checking}
          sx={{ borderRadius: m3Shape.full, whiteSpace: 'nowrap' }}
        >
          Buscar actualización
        </MuiButton>
      </Box>

      {checkResult === 'available' && (
        <Alert severity="info" sx={{ mt: 1.5 }}>
          Hay una nueva versión disponible. Usá el aviso de actualización para recargar la app.
        </Alert>
      )}
      {checkResult === 'current' && (
        <Alert severity="success" sx={{ mt: 1.5 }}>
          Ya tenés la última versión.
        </Alert>
      )}

      {isDriver && !installDismissed && (
        <Box sx={{ mt: 2 }}>
          <InstallBanner onDismiss={() => setInstallDismissed(true)} />
        </Box>
      )}
    </>
  );
}

/* ── Page ───────────────────────────────────── */

export function SettingsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const tenant = useAuthStore((state) => state.tenant);
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const logout = useAuthStore((state) => state.logout);

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  const role = user?.role ?? 'viewer';
  const isDriver = role === 'driver';
  const isSuperAdmin = role === 'superadmin';
  const canManageConfig = hasPermission('config.manage');
  const canManageUsers = hasPermission('users.manage');

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', minWidth: 0 }}>
      <PageHeader
        title="Ajustes"
        subtitle="Tu cuenta, seguridad y configuración de la empresa"
        icon={<IconSettings size={24} />}
      />

      {/* 1 — Mi cuenta */}
      <SettingsSection>
        <SectionHeading icon={<IconShieldPerson size={16} />} title="Mi cuenta" />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', minWidth: 0 }}>
          <Avatar
            sx={{
              width: 56,
              height: 56,
              bgcolor: 'primaryContainer',
              color: 'onPrimaryContainer',
              fontSize: 'titleLarge.fontSize',
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {user?.name?.charAt(0).toUpperCase() ?? '?'}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography component="div" variant="titleMedium" noWrap sx={{ fontWeight: 700, color: 'onSurface' }}>
              {user?.name ?? '—'}
            </Typography>
            <Typography component="div" variant="body2" color="onSurfaceVariant" noWrap>
              {user?.email ?? '—'}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 0.75 }}>
              <Box
                component="span"
                sx={{
                  px: 1,
                  py: 0.25,
                  borderRadius: m3Shape.full,
                  bgcolor: 'secondaryContainer',
                  color: 'onSecondaryContainer',
                  fontSize: '0.6875rem',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                {ROLE_LABELS[role]}
              </Box>
              {tenant?.name && (
                <Box
                  component="span"
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.5,
                    px: 1,
                    py: 0.25,
                    borderRadius: m3Shape.full,
                    bgcolor: 'surfaceContainerHigh',
                    color: 'onSurfaceVariant',
                    fontSize: '0.6875rem',
                    fontWeight: 600,
                    maxWidth: '100%',
                  }}
                >
                  <IconStorefront size={12} />
                  <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tenant.name}
                  </Box>
                </Box>
              )}
            </Box>
          </Box>
        </Box>
      </SettingsSection>

      {/* 2 — Seguridad */}
      <SettingsSection>
        <SectionHeading
          icon={<IconKey size={16} />}
          title="Seguridad"
          description="Cambiá tu contraseña cuando lo necesites."
        />
        <RowButton
          icon={<IconKey size={20} />}
          label="Cambiar contraseña"
          description="Se cerrarán tus otras sesiones"
          onClick={() => setPasswordOpen(true)}
        />
      </SettingsSection>

      {/* 3 — Apariencia */}
      <SettingsSection>
        <SectionHeading icon={<IconSettings size={16} />} title="Apariencia" />
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            flexWrap: 'wrap',
            minHeight: 52,
            px: 1,
          }}
        >
          <Box sx={{ flex: 1, minWidth: 140 }}>
            <Typography component="div" variant="body1" sx={{ fontWeight: 500 }}>
              Modo de color
            </Typography>
            <Typography component="div" variant="caption" color="onSurfaceVariant">
              Alterná entre claro y oscuro
            </Typography>
          </Box>
          <ThemeToggle size="md" />
        </Box>
      </SettingsSection>

      {/* 4 — Empresa (config.manage) */}
      {canManageConfig && (
        <SettingsSection>
          <SectionHeading
            icon={<IconStorefront size={16} />}
            title="Empresa"
            description="Datos del negocio y saldos de arranque."
          />

          <Typography component="div" variant="titleSmall" sx={{ fontWeight: 700, color: 'onSurface', mb: 1.5 }}>
            Perfil del negocio
          </Typography>
          <BusinessProfileForm />

          <Divider sx={{ my: 2.5, borderColor: 'outlineVariant' }} />

          <OpeningBalancesSection />

          <Divider sx={{ my: 2.5, borderColor: 'outlineVariant' }} />

          <PuntoCeroSummary isSuperAdmin={isSuperAdmin} />
        </SettingsSection>
      )}

      {/* 5 — Equipo (users.manage) */}
      {canManageUsers && (
        <SettingsSection>
          <SectionHeading icon={<IconUsers size={16} />} title="Equipo" />
          <RowButton
            icon={<IconUsers size={20} />}
            label="Gestionar usuarios"
            description="Roles, permisos y cuentas del equipo"
            onClick={() => navigate('/users')}
          />
        </SettingsSection>
      )}

      {/* 6 — Aplicación */}
      <SettingsSection>
        <SectionHeading icon={<IconDownload size={16} />} title="Aplicación" />
        <ApplicationSection isDriver={isDriver} />
      </SettingsSection>

      {/* 7 — Cerrar sesión */}
      <SettingsSection>
        <SectionHeading icon={<IconLogout size={16} />} title="Sesión" />
        <RowButton
          icon={<IconLogout size={20} />}
          label="Cerrar sesión"
          onClick={() => void handleLogout()}
          tone="danger"
          ariaLabel="Cerrar sesión"
        />
      </SettingsSection>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, pb: 2 }}>
        <Box aria-hidden="true" sx={{ display: 'flex', color: 'onSurfaceVariant' }}>
          <IconLock size={12} />
        </Box>
        <Typography component="div" variant="caption" color="onSurfaceVariant">
          Tu sesión está protegida
        </Typography>
      </Box>

      <ChangePasswordDialog
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        onSuccess={() => {
          setPasswordOpen(false);
          setSnackbar({
            open: true,
            message: 'Contraseña actualizada. Se cerraron tus otras sesiones.',
            severity: 'success',
          });
        }}
      />

      <MuiSnackbar
        open={snackbar.open}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        message={snackbar.message}
        severity={snackbar.severity}
      />
    </Box>
  );
}
