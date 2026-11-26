import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore.ts';
import { useUsers } from '../hooks/queries/index.ts';
import { useRegisterUser, useUpdateUser, useDeleteUser, useSetWhatsappPhone } from '../hooks/mutations/index.ts';
import { PermissionsEditor } from '../components/users/PermissionsEditor.tsx';
import {
  ALL_PERMISSIONS,
  PRESETS,
  normalizePermissions,
} from '../lib/permissions.ts';
import { isOfflineQueuedError } from '../hooks/use-offline-mutation.ts';
import {
  MuiButton,
  MuiTextField,
  MuiDialog,
  MuiSnackbar,
  MuiChip,
  LoadingState,
  EmptyState,
} from '../components/ui/index.ts';
import {
  IconPersonAdd,
  IconBadge,
  IconSearch,
  IconClose,
  IconTune,
  IconEdit,
  IconRoute,
  IconPersonOff,
  IconAdminPanelSettings,
  IconLocalShipping,
  IconVerifiedUser,
  IconShieldPerson,
  IconPin,
  IconCalendarToday,
  IconPersonSearch,
  IconUsers,
  IconCheck,
  IconWarning,
  IconVisibilityOff,
  IconStorefront,
} from '../components/ui/icons.tsx';
import type { AppUser, UserRole } from '../types/index.ts';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Avatar from '@mui/material/Avatar';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import MuiAlert from '@mui/material/Alert';
import Tooltip from '@mui/material/Tooltip';
import InputAdornment from '@mui/material/InputAdornment';
import { m3Shape } from '../theme/index.ts';

/* ═══════════════════════════════════════════════════════════════
   Usuarios y Equipo — rich M3 reference redesign
   ═══════════════════════════════════════════════════════════════
   Sections:
   1. Header (primary-fixed icon square + "+ Nuevo")
   2. Team KPI grid (Miembros / Choferes / Admins — real counts)
   3. Search + segmented filter chips (client-side)
   4. Rich user cards (avatar tone by role, "Tú" badge, role pill,
      permission box, Permisos / Editar / Ver Ruta / delete)
   5. Security PIN banner (informational, honest no-op)
   6. New user dialog (role select shows the role's permissions)
   ═══════════════════════════════════════════════════════════════ */

/* ── Permission limitation model ───────────────────────────────
   Each role maps to a fixed set of capabilities. The UI surfaces
   them in three places: the create/edit role select helper, the
   card's permission box, and the "Permisos" dialog. The labels are
   descriptive of the real backend authorization (admin-only writes,
   driver scoped to its own route, viewer read-only). */

interface RolePermission {
  /** Pill + dialog title label (Admin General / Chofer Activo / Consultor) */
  roleLabel: string;
  /** Option label in the create/edit role select */
  selectLabel: string;
  /** Short identity line under the email (Control total / Chofer · Reparto / Solo lectura) */
  tagline: string;
  /** One-line scope shown in the card's permission box */
  scope: string;
  /** "Este rol podrá: …" helper shown under the role select */
  helper: string;
  /** Read-only capability list shown in the Permisos dialog (check icons) */
  permissions: string[];
  /** Icon for the tagline line */
  taglineIcon: ReactNode;
}

const ROLE_PERMISSIONS: Record<UserRole, RolePermission> = {
  superadmin: {
    roleLabel: 'Super Admin',
    selectLabel: 'Super Admin',
    tagline: 'Control total + setup',
    taglineIcon: <IconShieldPerson size={14} />,
    scope: 'Todo lo de un admin, más la configuración crítica (Punto Cero). Único rol con acceso al setup inicial.',
    helper: 'Control total del negocio — todo lo de un admin, más la configuración crítica del Punto Cero y el estado inicial.',
    permissions: [
      'Gestionar inventario y precios',
      'Administrar clientes y pedidos',
      'Registrar compras y promociones',
      'Ver reportes y dashboard',
      'Gestionar usuarios y permisos',
      'Configurar Punto Cero (setup inicial)',
    ],
  },
  admin: {
    roleLabel: 'Admin General',
    selectLabel: 'Administrador',
    tagline: 'Control total',
    taglineIcon: <IconAdminPanelSettings size={14} />,
    scope: 'Acceso completo: inventario, precios, clientes, pedidos, compras, promos, reportes y usuarios.',
    helper: 'Control total del negocio — inventario, precios, clientes, pedidos, compras, promos, reportes y gestión de usuarios.',
    permissions: [
      'Gestionar inventario y precios',
      'Administrar clientes y pedidos',
      'Registrar compras y promociones',
      'Ver reportes y dashboard',
      'Gestionar usuarios y permisos',
    ],
  },
  driver: {
    roleLabel: 'Chofer Activo',
    selectLabel: 'Repartidor / Chofer',
    tagline: 'Chofer · Reparto',
    taglineIcon: <IconLocalShipping size={14} />,
    scope: 'Solo su ruta: ve entregas asignadas, avanza paradas y registra cobros. Sin acciones de administración.',
    helper: 'Solo su ruta — ver entregas asignadas, avanzar paradas, registrar cobros y ver sus datos. NO puede crear ni editar clientes, productos, precios, compras, promos ni usuarios.',
    permissions: [
      'Ver sus entregas asignadas',
      'Avanzar paradas de su ruta',
      'Registrar cobros de sus entregas',
      'Ver sus propios datos',
    ],
  },
  viewer: {
    roleLabel: 'Consultor',
    selectLabel: 'Consultor',
    tagline: 'Solo lectura',
    taglineIcon: <IconVisibilityOff size={14} />,
    scope: 'Solo lectura: consulta dashboard, clientes, pedidos y stock. Sin acciones de escritura.',
    helper: 'Solo lectura — ver dashboard, clientes, pedidos y stock. Sin acciones de escritura ni gestión de usuarios.',
    permissions: [
      'Ver dashboard y reportes',
      'Consultar clientes y pedidos',
      'Ver stock',
      'Sin acciones de escritura',
    ],
  },
  puesto: {
    roleLabel: 'Puesto',
    selectLabel: 'Puesto',
    tagline: 'Ventas de mostrador',
    taglineIcon: <IconStorefront size={14} />,
    scope: 'Solo el puesto: registra ventas de mostrador (efectivo o transferencia) y cierra la caja del puesto. Sin gestión de clientes, stock ni precios.',
    helper: 'Solo el puesto — registrar ventas de mostrador (efectivo o transferencia), ver sus pedidos y cerrar la caja del puesto. NO puede gestionar clientes, productos, precios, compras, promos, rutas ni usuarios.',
    permissions: [
      'Registrar ventas de mostrador',
      'Ver sus pedidos del puesto',
      'Cerrar la caja del puesto',
      'Ver su dashboard',
    ],
  },
};

/** Role pill tones (per reference: primary-fixed / secondary-container / surface-container-high) */
const ROLE_PILL_TONE: Record<UserRole, { bg: string; color: string }> = {
  superadmin: { bg: 'tertiaryContainer', color: 'onTertiaryContainer' },
  admin: { bg: 'primaryFixed', color: 'onPrimaryFixed' },
  driver: { bg: 'secondaryContainer', color: 'onSecondaryContainer' },
  viewer: { bg: 'surfaceContainerHigh', color: 'onSurfaceVariant' },
  puesto: { bg: 'warningContainer', color: 'onWarningContainer' },
};

/** Avatar tones by role */
const ROLE_AVATAR_TONE: Record<UserRole, { bg: string; color: string }> = {
  superadmin: { bg: 'tertiaryContainer', color: 'onTertiaryContainer' },
  admin: { bg: 'primaryFixed', color: 'onPrimaryFixed' },
  driver: { bg: 'secondaryContainer', color: 'onSecondaryContainer' },
  viewer: { bg: 'surfaceContainerHigh', color: 'onSurfaceVariant' },
  puesto: { bg: 'warningContainer', color: 'onWarningContainer' },
};

/* ── Filter chips ─────────────────────────────────────────────── */

type UserFilter = 'ALL' | 'drivers' | 'admin' | 'puesto';

const FILTERS: { value: UserFilter; label: string }[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'drivers', label: 'Repartidores' },
  { value: 'admin', label: 'Administración' },
  { value: 'puesto', label: 'Puestos' },
];

/* ── Helpers ─────────────────────────────────────────────────── */

/** Map known backend (English) errors to Spanish UI labels. */
const friendlyError = (message: string): string => {
  if (/email already registered/i.test(message)) return 'Ya existe un usuario con ese email';
  if (/cannot delete user with assigned routes/i.test(message)) return 'No se puede eliminar: el usuario tiene rutas asignadas';
  if (/own user/i.test(message)) return 'No podés eliminar tu propio usuario';
  if (/own role/i.test(message)) return 'No podés cambiar tu propio rol';
  if (/at least one admin/i.test(message)) return 'Al menos un administrador debe conservar el permiso de usuarios';
  if (/not found/i.test(message)) return 'El usuario no existe';
  return message;
};

/** Compact permission summary shown in each user card. */
const permissionSummary = (user: AppUser): string => {
  if (user.role === 'superadmin') return 'Acceso total';
  if (user.role !== 'admin') return 'Acceso por rol';
  const permissions = normalizePermissions(user.permissions ?? []);
  if (permissions.length === 0) return 'Sin permisos';
  if (ALL_PERMISSIONS.every((permission) => permissions.includes(permission))) {
    return 'Acceso total';
  }
  const modules = new Set(permissions.map((permission) => permission.split('.')[0]));
  return `${modules.size} ${modules.size === 1 ? 'módulo' : 'módulos'}`;
};

const formatDate = (d: string): string =>
  new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });

const initials = (name: string): string =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || '?';

/* ── Types ───────────────────────────────────────────────────── */

interface CreateForm {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  permissions: string[];
}

const emptyForm: CreateForm = {
  name: '',
  email: '',
  password: '',
  role: 'driver',
  permissions: [],
};

interface EditState {
  user: AppUser;
  role: UserRole;
  permissions: string[];
  /** WhatsApp number as typed; empty clears the link. */
  phone: string;
}

/** Default a fresh admin to the full permission set. */
const defaultPermissionsForRole = (role: UserRole, current: string[]): string[] =>
  role === 'admin' && current.length === 0 ? [...PRESETS.full] : current;

/* ── Metric tile (team KPIs) ─────────────────────────────────── */

function TeamMetricTile({
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

/* ── Segmented filter chip ─────────────────────────────────────
   Active = primary filled + white label; inactive = surface-container. */

function CountChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
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

/* ── Role permissions dialog ─────────────────────────────────── */

function PermissionsDialog({
  role,
  onClose,
}: {
  role: UserRole | null;
  onClose: () => void;
}) {
  const perm = role ? ROLE_PERMISSIONS[role] : null;
  const tone = role ? ROLE_PILL_TONE[role] : null;

  return (
    <MuiDialog
      open={role !== null}
      onClose={onClose}
      title={perm ? `Permisos — ${perm.roleLabel}` : ''}
      maxWidth="xs"
      actions={
        <MuiButton variant="secondary" onClick={onClose}>
          Cerrar
        </MuiButton>
      }
    >
      {perm && tone && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <MuiChip
              label={perm.roleLabel}
              size="small"
              sx={{ bgcolor: tone.bg, color: tone.color, fontWeight: 700 }}
            />
            <Typography variant="caption" color="onSurfaceVariant" sx={{ fontWeight: 600 }}>
              {perm.tagline}
            </Typography>
          </Box>

          <Typography variant="body2" color="onSurfaceVariant">
            {perm.scope}
          </Typography>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {perm.permissions.map((permission) => (
              <Box
                key={permission}
                sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    bgcolor: 'secondaryContainer',
                    color: 'onSecondaryContainer',
                    flexShrink: 0,
                  }}
                >
                  <IconCheck size={14} />
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 600, color: 'onSurface' }}>
                  {permission}
                </Typography>
              </Box>
            ))}
          </Box>

          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 1.5,
              py: 1,
              borderRadius: '12px',
              bgcolor: 'surfaceContainerLow',
            }}
          >
            <IconShieldPerson size={16} color="var(--mui-palette-onSurfaceVariant)" style={{ flexShrink: 0 }} />
            <Typography variant="caption" color="onSurfaceVariant" sx={{ fontWeight: 600 }}>
              Los permisos de reparto y puesto son fijos. Editá un administrador para ajustar sus módulos.
            </Typography>
          </Box>
        </Box>
      )}
    </MuiDialog>
  );
}

/* ── User card ─────────────────────────────────────────────────
   White card (surface-container-lowest, 16px, shadow-sm → md on hover):
   - Row 1: 44px avatar (initials, role tone, decorative green online
     dot) + name + "Tú" badge + email + tagline; right = role pill.
   - Permission box (surface-container-low): role scope line + footer
     "Alta: {date}" + decorative green "Activo" indicator.
   - Actions row: Permisos / Editar (ghost) + Ver Ruta (driver only);
     right = delete (person_off, error hover; disabled for self). */

function UserCard({
  user,
  isCurrentUser,
  onPermissions,
  onEdit,
  onDelete,
  onViewRoute,
}: {
  user: AppUser;
  isCurrentUser: boolean;
  onPermissions: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onViewRoute: () => void;
}) {
  const perm = ROLE_PERMISSIONS[user.role];
  const pillTone = ROLE_PILL_TONE[user.role];
  const avatarTone = ROLE_AVATAR_TONE[user.role];

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        width: '100%',
        bgcolor: 'surfaceContainerLowest',
        border: 1,
        borderColor: 'outlineVariant',
        borderRadius: '16px',
        boxShadow: 1,
        p: 2,
        transition: 'box-shadow 0.2s cubic-bezier(0.2, 0, 0, 1), transform 0.12s',
        '&:hover': { boxShadow: 4 },
      }}
    >
      {/* Row 1 — identity + role pill */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, minWidth: 0 }}>
        <Box sx={{ position: 'relative', flexShrink: 0 }}>
          <Avatar
            sx={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              bgcolor: avatarTone.bg,
              color: avatarTone.color,
              fontWeight: 700,
              fontSize: '0.9375rem',
            }}
          >
            {initials(user.name)}
          </Avatar>
          {/* Decorative online dot (no presence data) */}
          <Box
            sx={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: 11,
              height: 11,
              borderRadius: '50%',
              bgcolor: 'success.main',
              border: 2,
              borderColor: 'surfaceContainerLowest',
            }}
          />
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minWidth: 0 }}>
            <Typography
              variant="titleMedium"
              sx={{ fontWeight: 700, color: 'onSurface', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {user.name}
            </Typography>
            {isCurrentUser && (
              <Box
                component="span"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.25,
                  px: 0.75,
                  py: 0.25,
                  borderRadius: 9999,
                  bgcolor: 'secondaryContainer',
                  color: 'onSecondaryContainer',
                  fontSize: '0.6875rem',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                }}
              >
                <IconVerifiedUser size={12} />
                TÚ
              </Box>
            )}
          </Box>
          <Typography
            variant="body2"
            color="onSurfaceVariant"
            sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {user.email}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
            {perm.taglineIcon}
            <Typography variant="caption" color="onSurfaceVariant" sx={{ fontWeight: 600 }}>
              {perm.tagline}
            </Typography>
          </Box>
        </Box>

        <MuiChip
          label={perm.roleLabel}
          size="small"
          sx={{ flexShrink: 0, bgcolor: pillTone.bg, color: pillTone.color, fontWeight: 700 }}
        />
      </Box>

      {/* Permission box — role scope + Alta/Activo footer */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          px: 1.5,
          py: 1.25,
          borderRadius: '12px',
          bgcolor: 'surfaceContainerLow',
          border: 1,
          borderColor: 'outlineVariant',
        }}
      >
        <Typography variant="body2" color="onSurfaceVariant">
          {perm.scope}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <MuiChip
            label={permissionSummary(user)}
            size="small"
            sx={{ bgcolor: 'secondaryContainer', color: 'onSecondaryContainer', fontWeight: 700 }}
          />
          <Typography variant="caption" color="onSurfaceVariant" sx={{ fontWeight: 600 }}>
            Rol: {perm.roleLabel}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <IconCalendarToday size={13} color="var(--mui-palette-onSurfaceVariant)" style={{ flexShrink: 0 }} />
            <Typography variant="caption" color="onSurfaceVariant" sx={{ fontWeight: 600 }}>
              Alta: {formatDate(user.createdAt)}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main' }} />
            <Typography variant="caption" color="success.main" sx={{ fontWeight: 700 }}>
              Activo
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Actions row */}
      <Box
        sx={{
          borderTop: 1,
          borderColor: 'outlineVariant',
          pt: 1.25,
          mt: 0.25,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          flexWrap: 'wrap',
        }}
      >
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          <MuiButton variant="ghost" size="sm" onClick={onPermissions} startIcon={<IconTune size={14} />}>
            Permisos
          </MuiButton>
          <MuiButton variant="ghost" size="sm" onClick={onEdit} startIcon={<IconEdit size={14} />}>
            Editar
          </MuiButton>
          {user.role === 'driver' && (
            <MuiButton variant="ghost" size="sm" onClick={onViewRoute} startIcon={<IconRoute size={14} />}>
              Ver Ruta
            </MuiButton>
          )}
        </Box>

        {isCurrentUser ? (
          <Tooltip title="No podés eliminar tu propio usuario">
            <Box
              component="span"
              sx={{
                display: 'inline-flex',
                width: 40,
                height: 40,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: m3Shape.full,
                color: 'outline',
                cursor: 'not-allowed',
                flexShrink: 0,
              }}
              aria-label="No podés eliminar tu propio usuario"
            >
              <IconPersonOff size={18} />
            </Box>
          </Tooltip>
        ) : (
          <IconButton
            aria-label={`Eliminar usuario ${user.name}`}
            size="small"
            onClick={onDelete}
            sx={{
              flexShrink: 0,
              width: 40,
              height: 40,
              color: 'onSurfaceVariant',
              '&:hover': {
                bgcolor: 'errorContainer',
                color: 'onErrorContainer',
              },
            }}
          >
            <IconPersonOff size={18} />
          </IconButton>
        )}
      </Box>
    </Box>
  );
}

/* ── UsersPage ───────────────────────────────────────────────── */

export function UsersPage() {
  const navigate = useNavigate();
  const { user: currentUser, refreshSession } = useAuthStore();

  // Read — the full user list (admin only).
  const usersQuery = useUsers();
  const users = usersQuery.data ?? [];
  const loading = usersQuery.isLoading;
  const queryError = usersQuery.error;
  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : 'Error al cargar usuarios'
    : null;

  // Search + segmented filter (client-side)
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<UserFilter>('ALL');

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  // Edit (role change) dialog
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  // Permissions dialog
  const [permissionsRole, setPermissionsRole] = useState<UserRole | null>(null);

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<AppUser | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Snackbar
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  // Writes — offline-aware; each invalidates users (+ routes on role change).
  const registerUser = useRegisterUser();
  const updateUser = useUpdateUser();
  const setWhatsappPhone = useSetWhatsappPhone();
  const deleteUser = useDeleteUser();
  const submitting = registerUser.isPending;
  const editing = updateUser.isPending || setWhatsappPhone.isPending;
  const deleting = deleteUser.isPending;

  /* Real team KPI counts from the full list */
  const stats = useMemo(
    () => ({
      total: users.length,
      drivers: users.filter((u) => u.role === 'driver').length,
      admins: users.filter((u) => u.role === 'admin' || u.role === 'superadmin').length,
      adminGroup: users.filter((u) => u.role === 'admin' || u.role === 'superadmin' || u.role === 'viewer').length,
      puestos: users.filter((u) => u.role === 'puesto').length,
    }),
    [users],
  );

  /* Client-side search by name / email / role label */
  const visibleUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      const matchesFilter =
        filter === 'ALL'
          ? true
          : filter === 'drivers'
            ? u.role === 'driver'
            : filter === 'puesto'
              ? u.role === 'puesto'
              : u.role === 'admin' || u.role === 'superadmin' || u.role === 'viewer';
      if (!matchesFilter) return false;
      if (!q) return true;
      const perm = ROLE_PERMISSIONS[u.role];
      const haystack = `${u.name} ${u.email} ${perm.selectLabel} ${perm.roleLabel}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [users, filter, search]);

  /* ── Create ─────────────────────────────────── */

  const openCreate = () => {
    setForm(emptyForm);
    setFormError(null);
    setCreateOpen(true);
  };

  const closeCreate = () => {
    if (submitting) return;
    setCreateOpen(false);
    setForm(emptyForm);
    setFormError(null);
  };

  const handleCreateRoleChange = (role: UserRole) => {
    setForm((prev) => ({
      ...prev,
      role,
      permissions: defaultPermissionsForRole(role, prev.permissions),
    }));
  };

  const handleCreateSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    registerUser.mutate(
      {
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        permissions: form.role === 'admin' ? normalizePermissions(form.permissions) : undefined,
      },
      {
        onSuccess: () => {
          closeCreate();
          setSnackbar({ open: true, message: 'Usuario creado correctamente', severity: 'success' });
        },
        onError: (err) => {
          // Offline queued write: normal outcome, the OfflineBanner confirmed it.
          if (isOfflineQueuedError(err)) {
            closeCreate();
            setSnackbar({ open: true, message: 'Usuario guardado (offline)', severity: 'success' });
            return;
          }
          setFormError(friendlyError(err instanceof Error ? err.message : 'Error al crear usuario'));
        },
      },
    );
  };

  /* ── Edit (role change) ─────────────────────── */

  const openEdit = (user: AppUser) => {
    setEditState({
      user,
      role: user.role,
      permissions: user.permissions ?? [],
      phone: user.whatsappPhone ?? '',
    });
    setEditError(null);
  };

  const closeEdit = () => {
    if (editing) return;
    setEditState(null);
    setEditError(null);
  };

  const handleEditRoleChange = (role: UserRole) => {
    setEditState((prev) =>
      prev
        ? { ...prev, role, permissions: defaultPermissionsForRole(role, prev.permissions) }
        : prev,
    );
  };

  const handleEditSubmit = () => {
    if (!editState) return;
    const target = editState.user;
    const newRole = editState.role;
    setEditError(null);

    const phoneInput = editState.phone.trim();
    const phoneChanged = phoneInput !== (target.whatsappPhone ?? '');

    const finishEdit = () => {
      setEditState(null);
      if (target._id === currentUser?._id) {
        void refreshSession();
      }
      setSnackbar({
        open: true,
        message: `Rol de ${target.name} actualizado a ${ROLE_PERMISSIONS[newRole].roleLabel}`,
        severity: 'success',
      });
    };

    updateUser.mutate(
      {
        id: target._id,
        data: {
          role: newRole,
          permissions: newRole === 'admin' ? normalizePermissions(editState.permissions) : undefined,
        },
      },
      {
        onSuccess: () => {
          if (!phoneChanged) {
            finishEdit();
            return;
          }
          // The role is saved; now the number. A failure keeps the dialog open to retry.
          setWhatsappPhone.mutate(
            { id: target._id, phone: phoneInput === '' ? null : phoneInput },
            {
              onSuccess: finishEdit,
              onError: (err) => {
                if (isOfflineQueuedError(err)) {
                  setEditState(null);
                  setSnackbar({ open: true, message: 'Cambio de número guardado (offline)', severity: 'success' });
                  return;
                }
                setEditError(friendlyError(err instanceof Error ? err.message : 'Error al guardar el número de WhatsApp'));
              },
            },
          );
        },
        onError: (err) => {
          if (isOfflineQueuedError(err)) {
            setEditState(null);
            setSnackbar({ open: true, message: 'Cambio de rol guardado (offline)', severity: 'success' });
            return;
          }
          setEditError(friendlyError(err instanceof Error ? err.message : 'Error al actualizar rol'));
        },
      },
    );
  };

  /* ── Delete ─────────────────────────────────── */

  const openDeleteConfirm = (target: AppUser) => {
    setDeleteTarget(target);
    setDeleteError(null);
  };

  const closeDeleteConfirm = () => {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteError(null);
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    setDeleteError(null);

    deleteUser.mutate(deleteTarget._id, {
      onSuccess: () => {
        setSnackbar({ open: true, message: 'Usuario eliminado', severity: 'success' });
        setDeleteTarget(null);
      },
      onError: (err) => {
        if (isOfflineQueuedError(err)) {
          setSnackbar({ open: true, message: 'Usuario eliminado (offline)', severity: 'success' });
          setDeleteTarget(null);
          return;
        }
        setDeleteError(friendlyError(err instanceof Error ? err.message : 'Error al eliminar usuario'));
      },
    });
  };

  if (loading) {
    return <LoadingState label="Cargando usuarios…" />;
  }

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
      {/* 1 — Header: primary-fixed icon square + title + "+ Nuevo" */}
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
            <IconBadge size={24} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h4" sx={{ fontWeight: 700, letterSpacing: '-0.02em', color: 'onSurface', lineHeight: 1.2 }}>
              Usuarios y Equipo
            </Typography>
            <Typography variant="body2" color="onSurfaceVariant" sx={{ mt: 0.5 }}>
              Administrá colaboradores, choferes y permisos de acceso
            </Typography>
          </Box>
        </Box>
        <Box sx={{ flexShrink: 0 }}>
          <MuiButton variant="primary" onClick={openCreate} startIcon={<IconPersonAdd size={18} />}>
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Nuevo Usuario</Box>
            <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>Nuevo</Box>
          </MuiButton>
        </Box>
      </Box>

      {/* 2 — Team KPI grid (real counts) */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2, mb: 3 }}>
        <TeamMetricTile
          label="Miembros"
          icon={<IconUsers size={18} />}
          iconSx={{ bgcolor: 'primaryContainer', color: 'onPrimaryContainer' }}
          value={stats.total}
          sub="En el sistema"
        />
        <TeamMetricTile
          label="Choferes"
          icon={<IconLocalShipping size={18} />}
          iconSx={{ bgcolor: 'secondaryContainer', color: 'onSecondaryContainer' }}
          value={stats.drivers}
          sub="flota"
        />
        <TeamMetricTile
          label="Admins"
          icon={<IconAdminPanelSettings size={18} />}
          iconSx={{ bgcolor: 'tertiaryContainer', color: 'onTertiaryContainer' }}
          value={stats.admins}
          sub="Acceso completo"
        />
      </Box>

      {/* 3 — Search + segmented filter chips */}
      <MuiTextField
        placeholder="Buscar por nombre, email o rol..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        fullWidth
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <IconSearch size={18} />
              </InputAdornment>
            ),
            endAdornment: search ? (
              <InputAdornment position="end">
                <IconButton
                  aria-label="Limpiar búsqueda"
                  onClick={() => setSearch('')}
                  size="small"
                  sx={{ color: 'onSurfaceVariant' }}
                >
                  <IconClose size={16} />
                </IconButton>
              </InputAdornment>
            ) : undefined,
          },
        }}
      />

      <Box
        sx={{
          display: 'flex',
          gap: 1,
          flexWrap: 'wrap',
          py: 1.5,
          mb: 2.5,
        }}
      >
        {FILTERS.map((f) => {
          const active = filter === f.value;
          const count =
            f.value === 'ALL' ? stats.total : f.value === 'drivers' ? stats.drivers : f.value === 'puesto' ? stats.puestos : stats.adminGroup;
          return (
            <CountChip
              key={f.value}
              label={`${f.label} (${count})`}
              active={active}
              onClick={() => setFilter(f.value)}
            />
          );
        })}
      </Box>

      {error && (
        <MuiAlert severity="error" sx={{ mb: 2.5 }}>{error}</MuiAlert>
      )}

      {/* 4 — User cards */}
      {users.length === 0 ? (
        <EmptyState
          icon={<IconPersonSearch size={30} />}
          title="No hay usuarios"
          subtitle="Creá tu primer usuario para gestionar accesos y permisos del equipo."
          action={
            <MuiButton variant="primary" startIcon={<IconPersonAdd />} onClick={openCreate}>
              Nuevo Usuario
            </MuiButton>
          }
        />
      ) : visibleUsers.length === 0 ? (
        <EmptyState
          icon={<IconPersonSearch size={30} />}
          title="No se encontraron usuarios"
          subtitle="Ningún usuario coincide con la búsqueda o el filtro seleccionado."
          action={
            <MuiButton
              variant="secondary"
              onClick={() => {
                setSearch('');
                setFilter('ALL');
              }}
            >
              Limpiar filtros
            </MuiButton>
          }
        />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {visibleUsers.map((user) => {
            const isCurrentUser = user._id === currentUser?._id;
            return (
              <UserCard
                key={user._id}
                user={user}
                isCurrentUser={isCurrentUser}
                onPermissions={() => setPermissionsRole(user.role)}
                onEdit={() => openEdit(user)}
                onDelete={() => openDeleteConfirm(user)}
                onViewRoute={() => navigate('/routes')}
              />
            );
          })}
        </Box>
      )}

      {/* Create dialog */}
      <MuiDialog
        open={createOpen}
        onClose={closeCreate}
        title="Nuevo Usuario"
        maxWidth="sm"
        actions={
          <>
            <MuiButton variant="secondary" onClick={closeCreate} disabled={submitting}>
              Cancelar
            </MuiButton>
            <MuiButton
              variant="primary"
              isLoading={submitting}
              disabled={submitting}
              onClick={() => {
                const formEl = document.querySelector('[data-user-form]') as HTMLFormElement | null;
                formEl?.requestSubmit();
              }}
            >
              {submitting ? 'Guardando...' : 'Crear Usuario'}
            </MuiButton>
          </>
        }
      >
        <Box component="form" data-user-form onSubmit={handleCreateSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>
          {formError && <MuiAlert severity="error">{formError}</MuiAlert>}

          <MuiTextField
            label="Nombre"
            placeholder="Nombre completo"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            autoFocus
          />

          <MuiTextField
            label="Email"
            type="email"
            placeholder="email@ejemplo.com"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />

          <MuiTextField
            label="Contraseña"
            type="password"
            placeholder="Mínimo 6 caracteres"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            autoComplete="new-password"
          />

          <MuiTextField
            label="Rol"
            value={form.role}
            onChange={(e) => handleCreateRoleChange(e.target.value as UserRole)}
            select
            required
            helperText={`Este rol podrá: ${ROLE_PERMISSIONS[form.role].helper}`}
          >
            <MenuItem value="superadmin">{ROLE_PERMISSIONS.superadmin.selectLabel}</MenuItem>
            <MenuItem value="admin">{ROLE_PERMISSIONS.admin.selectLabel}</MenuItem>
            <MenuItem value="driver">{ROLE_PERMISSIONS.driver.selectLabel}</MenuItem>
            <MenuItem value="viewer">{ROLE_PERMISSIONS.viewer.selectLabel}</MenuItem>
            <MenuItem value="puesto">{ROLE_PERMISSIONS.puesto.selectLabel}</MenuItem>
          </MuiTextField>

          {form.role === 'admin' ? (
            <PermissionsEditor
              value={form.permissions}
              onChange={(permissions) => setForm({ ...form, permissions })}
              disabled={submitting}
            />
          ) : (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.5,
                py: 1,
                borderRadius: '12px',
                bgcolor: 'surfaceContainerLow',
              }}
            >
              <IconPin size={16} color="var(--mui-palette-onSurfaceVariant)" style={{ flexShrink: 0 }} />
              <Typography variant="caption" color="onSurfaceVariant" sx={{ fontWeight: 600 }}>
                {form.role === 'superadmin'
                  ? 'El Super Admin siempre tiene acceso total.'
                  : 'Los permisos de reparto y puesto son fijos.'}
              </Typography>
            </Box>
          )}
        </Box>
      </MuiDialog>

      {/* Edit (role change) dialog */}
      <MuiDialog
        open={editState !== null}
        onClose={closeEdit}
        title="Editar rol"
        maxWidth="xs"
        actions={
          <>
            <MuiButton variant="secondary" onClick={closeEdit} disabled={editing}>
              Cancelar
            </MuiButton>
            <MuiButton
              variant="primary"
              isLoading={editing}
              disabled={editing || !editState}
              onClick={handleEditSubmit}
            >
              {editing ? 'Guardando...' : 'Guardar'}
            </MuiButton>
          </>
        }
      >
        {editState && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 1 }}>
            {editError && <MuiAlert severity="error">{editError}</MuiAlert>}

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Avatar
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  bgcolor: ROLE_AVATAR_TONE[editState.user.role].bg,
                  color: ROLE_AVATAR_TONE[editState.user.role].color,
                  fontWeight: 700,
                  fontSize: '0.875rem',
                }}
              >
                {initials(editState.user.name)}
              </Avatar>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body1" sx={{ fontWeight: 700, color: 'onSurface' }} noWrap>
                  {editState.user.name}
                </Typography>
                <Typography variant="body2" color="onSurfaceVariant" noWrap>
                  {editState.user.email}
                </Typography>
              </Box>
            </Box>

            <MuiTextField
              label="Rol"
              value={editState.role}
              onChange={(e) => handleEditRoleChange(e.target.value as UserRole)}
              select
              required
              disabled={editState.user._id === currentUser?._id}
              helperText={
                editState.user._id === currentUser?._id
                  ? 'No podés cambiar tu propio rol.'
                  : `Este rol podrá: ${ROLE_PERMISSIONS[editState.role].helper}`
              }
            >
              <MenuItem value="superadmin">{ROLE_PERMISSIONS.superadmin.selectLabel}</MenuItem>
              <MenuItem value="admin">{ROLE_PERMISSIONS.admin.selectLabel}</MenuItem>
              <MenuItem value="driver">{ROLE_PERMISSIONS.driver.selectLabel}</MenuItem>
              <MenuItem value="viewer">{ROLE_PERMISSIONS.viewer.selectLabel}</MenuItem>
              <MenuItem value="puesto">{ROLE_PERMISSIONS.puesto.selectLabel}</MenuItem>
            </MuiTextField>

            <MuiTextField
              label="Número de WhatsApp"
              value={editState.phone}
              onChange={(e) => setEditState({ ...editState, phone: e.target.value })}
              placeholder="+54 9 2622 517447"
              disabled={editing}
              helperText="Con código de país. El asistente responde a este número como este usuario. Dejalo vacío para quitarlo."
            />

            {editState.role === 'admin' ? (
              <PermissionsEditor
                value={editState.permissions}
                onChange={(permissions) => setEditState({ ...editState, permissions })}
                disabled={editing}
              />
            ) : (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1.5,
                  py: 1,
                  borderRadius: '12px',
                  bgcolor: 'surfaceContainerLow',
                }}
              >
                <IconShieldPerson size={16} color="var(--mui-palette-onSurfaceVariant)" style={{ flexShrink: 0 }} />
                <Typography variant="caption" color="onSurfaceVariant" sx={{ fontWeight: 600 }}>
                  {editState.role === 'superadmin'
                    ? 'El Super Admin siempre tiene acceso total.'
                    : 'Los permisos de reparto y puesto son fijos.'}
                </Typography>
              </Box>
            )}
          </Box>
        )}
      </MuiDialog>

      {/* Permissions dialog */}
      <PermissionsDialog role={permissionsRole} onClose={() => setPermissionsRole(null)} />

      {/* Delete confirm dialog */}
      <MuiDialog
        open={deleteTarget !== null}
        onClose={closeDeleteConfirm}
        title="Eliminar usuario"
        maxWidth="xs"
        actions={
          <>
            <MuiButton variant="secondary" onClick={closeDeleteConfirm} disabled={deleting}>
              Cancelar
            </MuiButton>
            <MuiButton
              variant="danger"
              isLoading={deleting}
              disabled={deleting}
              startIcon={<IconPersonOff />}
              onClick={handleDeleteConfirm}
            >
              {deleting ? 'Eliminando...' : 'Eliminar'}
            </MuiButton>
          </>
        }
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {deleteTarget && (
            <Typography variant="body1">
              ¿Eliminar usuario <Box component="span" sx={{ fontWeight: 700 }}>{deleteTarget.name}</Box>?
            </Typography>
          )}

          {deleteTarget?.role === 'driver' && (
            <MuiAlert severity="warning" icon={<IconWarning size={16} />}>
              Si este repartidor tiene rutas asignadas no se podrá eliminar.
            </MuiAlert>
          )}

          {deleteError && <MuiAlert severity="error">{deleteError}</MuiAlert>}

          <Typography variant="caption" color="text.secondary">
            Esta acción no se puede deshacer.
          </Typography>
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