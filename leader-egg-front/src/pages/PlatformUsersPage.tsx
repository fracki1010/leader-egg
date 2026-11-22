import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  usePlatformTenants,
  usePlatformUsers,
} from '../hooks/queries/index.ts';
import {
  useCreatePlatformUser,
  useUpdatePlatformUser,
  useDeletePlatformUser,
  useResetPlatformUserPassword,
} from '../hooks/mutations/index.ts';
import {
  MuiButton,
  MuiTextField,
  MuiDialog,
  MuiSnackbar,
  MuiChip,
  PageHeader,
  LoadingState,
  EmptyState,
} from '../components/ui/index.ts';
import { PermissionsEditor } from '../components/users/PermissionsEditor.tsx';
import { PRESETS, normalizePermissions } from '../lib/permissions.ts';
import {
  IconBadge,
  IconDelete,
  IconEdit,
  IconKey,
  IconPersonAdd,
  IconPersonSearch,
  IconSearch,
  IconClose,
} from '../components/ui/icons.tsx';
import type { PlatformUser, UserRole } from '../types/index.ts';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import InputAdornment from '@mui/material/InputAdornment';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import MuiAlert from '@mui/material/Alert';

/* ═══════════════════════════════════════════════════════════════
   PlatformUsersPage — platform-wide user manager.
   Lists every user across ALL companies and lets a platform admin
   create / edit / reset-password / delete them. Only reachable with
   a platform admin session.
   ═══════════════════════════════════════════════════════════════ */

/* ── Helpers ─────────────────────────────────────────────────── */

const ROLE_LABELS: Record<UserRole, string> = {
  superadmin: 'Super Admin',
  admin: 'Administrador',
  driver: 'Repartidor',
  puesto: 'Puesto',
  viewer: 'Consultor',
};

const ROLE_TONES: Record<UserRole, { bg: string; color: string }> = {
  superadmin: { bg: 'tertiaryContainer', color: 'onTertiaryContainer' },
  admin: { bg: 'primaryFixed', color: 'onPrimaryFixed' },
  driver: { bg: 'secondaryContainer', color: 'onSecondaryContainer' },
  viewer: { bg: 'surfaceContainerHigh', color: 'onSurfaceVariant' },
  puesto: { bg: 'warningContainer', color: 'onWarningContainer' },
};

/** Roles the platform admin may assign (the legacy superadmin is read-only). */
const ASSIGNABLE_ROLES: UserRole[] = ['admin', 'driver', 'puesto', 'viewer'];

const formatDate = (d: string): string =>
  new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });

const friendlyError = (message: string): string => {
  if (/already registered/i.test(message)) return 'Ya existe un usuario con ese email';
  if (/at least one admin must keep user management/i.test(message)) {
    return 'Al menos un administrador debe conservar el permiso de usuarios';
  }
  if (/at least one admin/i.test(message)) {
    return 'No se puede eliminar: la empresa debe conservar al menos un administrador';
  }
  if (/not found/i.test(message)) return 'El usuario no existe';
  if (/email/i.test(message)) return 'El email no es válido';
  return message;
};

/** Default a fresh admin to the full permission set. */
const defaultPermissionsForRole = (role: UserRole, current: string[]): string[] =>
  role === 'admin' && current.length === 0 ? [...PRESETS.full] : current;

/** Debounces a fast-changing value (search input) by `delay` ms. */
function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/* ── Types ───────────────────────────────────────────────────── */

interface CreateForm {
  tenantId: string;
  name: string;
  email: string;
  password: string;
  role: UserRole;
  permissions: string[];
}

const emptyCreateForm: CreateForm = {
  tenantId: '',
  name: '',
  email: '',
  password: '',
  role: 'driver',
  permissions: [],
};

interface EditState {
  user: PlatformUser;
  name: string;
  role: UserRole;
  permissions: string[];
}

/* ── Page ────────────────────────────────────────────────────── */

export function PlatformUsersPage() {
  const tenantsQuery = usePlatformTenants();
  const tenants = tenantsQuery.data ?? [];

  // Filters
  const [tenantFilter, setTenantFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim(), 300);

  const usersQuery = usePlatformUsers({
    tenantId: tenantFilter || undefined,
    search: search || undefined,
  });
  const users = usersQuery.data ?? [];
  const loading = usersQuery.isLoading;
  const queryError = usersQuery.error;
  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : 'Error al cargar usuarios'
    : null;

  // Dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(emptyCreateForm);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editState, setEditState] = useState<EditState | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const [resetTarget, setResetTarget] = useState<PlatformUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<PlatformUser | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'info';
  }>({ open: false, message: '', severity: 'success' });

  // Mutations
  const createUser = useCreatePlatformUser();
  const updateUser = useUpdatePlatformUser();
  const deleteUser = useDeletePlatformUser();
  const resetUserPassword = useResetPlatformUserPassword();
  const submitting = createUser.isPending;
  const editing = updateUser.isPending;
  const deleting = deleteUser.isPending;
  const resetting = resetUserPassword.isPending;

  // Client-side role narrowing (search + tenant are handled by the hook/API).
  const visibleUsers = useMemo(
    () => (roleFilter ? users.filter((u) => u.role === roleFilter) : users),
    [users, roleFilter],
  );

  /* ── Create ─────────────────────────────────── */

  const openCreate = () => {
    setCreateForm(emptyCreateForm);
    setCreateError(null);
    setCreateOpen(true);
  };

  const closeCreate = () => {
    if (submitting) return;
    setCreateOpen(false);
    setCreateForm(emptyCreateForm);
    setCreateError(null);
  };

  const handleCreateSubmit = (e: FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    const tenantId = createForm.tenantId;
    const name = createForm.name.trim();
    const email = createForm.email.trim();

    if (!tenantId || !name || !email || !createForm.password) {
      setCreateError('Completá todos los campos obligatorios');
      return;
    }

    createUser.mutate(
      {
        tenantId,
        name,
        email,
        password: createForm.password,
        role: createForm.role,
        permissions:
          createForm.role === 'admin' ? normalizePermissions(createForm.permissions) : undefined,
      },
      {
        onSuccess: () => {
          closeCreate();
          setSnackbar({ open: true, message: 'Usuario creado correctamente', severity: 'success' });
        },
        onError: (err) => {
          setCreateError(friendlyError(err instanceof Error ? err.message : 'Error al crear usuario'));
        },
      },
    );
  };

  /* ── Edit (name + role) ─────────────────────── */

  const openEdit = (user: PlatformUser) => {
    setEditState({
      user,
      name: user.name,
      role: user.role,
      permissions: user.permissions ?? [],
    });
    setEditError(null);
  };

  const closeEdit = () => {
    if (editing) return;
    setEditState(null);
    setEditError(null);
  };

  const handleCreateRoleChange = (role: UserRole) => {
    setCreateForm((prev) => ({
      ...prev,
      role,
      permissions: defaultPermissionsForRole(role, prev.permissions),
    }));
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
    setEditError(null);

    updateUser.mutate(
      {
        id: editState.user.id,
        data: {
          tenantId: editState.user.tenantId,
          name: editState.name.trim(),
          role: editState.role,
          permissions:
            editState.role === 'admin' ? normalizePermissions(editState.permissions) : undefined,
        },
      },
      {
        onSuccess: (updated) => {
          setEditState(null);
          setSnackbar({
            open: true,
            message: `Usuario ${updated.name} actualizado`,
            severity: 'success',
          });
        },
        onError: (err) => {
          setEditError(friendlyError(err instanceof Error ? err.message : 'Error al actualizar usuario'));
        },
      },
    );
  };

  /* ── Reset password ─────────────────────────── */

  const openReset = (user: PlatformUser) => {
    setResetTarget(user);
    setResetPassword('');
    setResetError(null);
  };

  const closeReset = () => {
    if (resetting) return;
    setResetTarget(null);
    setResetPassword('');
    setResetError(null);
  };

  const handleResetSubmit = () => {
    if (!resetTarget) return;
    setResetError(null);

    if (resetPassword.length < 8) {
      setResetError('La contraseña debe tener al menos 8 caracteres');
      return;
    }

    resetUserPassword.mutate(
      { id: resetTarget.id, tenantId: resetTarget.tenantId, newPassword: resetPassword },
      {
        onSuccess: () => {
          setSnackbar({
            open: true,
            message: `Contraseña de ${resetTarget.name} actualizada`,
            severity: 'success',
          });
          setResetTarget(null);
          setResetPassword('');
        },
        onError: (err) => {
          setResetError(friendlyError(err instanceof Error ? err.message : 'Error al resetear la contraseña'));
        },
      },
    );
  };

  /* ── Delete ─────────────────────────────────── */

  const openDelete = (user: PlatformUser) => {
    setDeleteTarget(user);
    setDeleteError(null);
  };

  const closeDelete = () => {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteError(null);
  };

  const handleDeleteSubmit = () => {
    if (!deleteTarget) return;
    setDeleteError(null);

    deleteUser.mutate(
      { id: deleteTarget.id, tenantId: deleteTarget.tenantId },
      {
        onSuccess: () => {
          setSnackbar({ open: true, message: 'Usuario eliminado', severity: 'success' });
          setDeleteTarget(null);
        },
        onError: (err) => {
          setDeleteError(friendlyError(err instanceof Error ? err.message : 'Error al eliminar usuario'));
        },
      },
    );
  };

  /* ── Render ─────────────────────────────────── */

  const roleOptions = useMemo(() => {
    const set = new Set<UserRole>(ASSIGNABLE_ROLES);
    if (editState && !set.has(editState.role)) set.add(editState.role);
    return [...set];
  }, [editState]);

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
      <PageHeader
        title="Usuarios"
        subtitle="Administrá los usuarios de todas las empresas"
        icon={<IconBadge size={24} />}
        actions={
          <MuiButton variant="primary" onClick={openCreate} startIcon={<IconPersonAdd size={18} />}>
            Nuevo usuario
          </MuiButton>
        }
      />

      {/* Filters */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' },
          gap: 2,
          mb: 3,
        }}
      >
        <MuiTextField
          label="Empresa"
          value={tenantFilter}
          onChange={(e) => setTenantFilter(e.target.value)}
          select
        >
          <MenuItem value="">Todas</MenuItem>
          {tenants.map((tenant) => (
            <MenuItem key={tenant.id} value={tenant.id}>
              {tenant.name}
            </MenuItem>
          ))}
        </MuiTextField>

        <MuiTextField
          placeholder="Buscar por nombre o email..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <IconSearch size={18} />
                </InputAdornment>
              ),
              endAdornment: searchInput ? (
                <InputAdornment position="end">
                  <IconButton
                    aria-label="Limpiar búsqueda"
                    onClick={() => setSearchInput('')}
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

        <MuiTextField
          label="Rol"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          select
        >
          <MenuItem value="">Todos</MenuItem>
          {ASSIGNABLE_ROLES.map((role) => (
            <MenuItem key={role} value={role}>
              {ROLE_LABELS[role]}
            </MenuItem>
          ))}
        </MuiTextField>
      </Box>

      {error && (
        <MuiAlert severity="error" sx={{ mb: 2.5 }}>
          {error}
        </MuiAlert>
      )}

      {loading ? (
        <LoadingState label="Cargando usuarios…" />
      ) : visibleUsers.length === 0 ? (
        <EmptyState
          icon={<IconPersonSearch size={30} />}
          title="No hay usuarios"
          subtitle="Ningún usuario coincide con los filtros seleccionados."
          action={
            <MuiButton variant="primary" startIcon={<IconPersonAdd />} onClick={openCreate}>
              Nuevo usuario
            </MuiButton>
          }
        />
      ) : (
        <Paper
          variant="outlined"
          sx={{
            bgcolor: 'surfaceContainerLowest',
            borderRadius: '16px',
            overflow: 'hidden',
            borderColor: 'outlineVariant',
          }}
        >
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Nombre</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Email</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Rol</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Empresa</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Alta</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="right">
                    Acciones
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleUsers.map((user) => {
                  const tone = ROLE_TONES[user.role];
                  return (
                    <TableRow key={user.id} hover>
                      <TableCell sx={{ fontWeight: 600 }}>{user.name}</TableCell>
                      <TableCell
                        sx={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
                      >
                        {user.email}
                      </TableCell>
                      <TableCell>
                        <MuiChip
                          label={ROLE_LABELS[user.role]}
                          sx={{ bgcolor: tone.bg, color: tone.color, fontWeight: 700 }}
                        />
                      </TableCell>
                      <TableCell>{user.tenantName}</TableCell>
                      <TableCell
                        sx={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
                      >
                        {formatDate(user.createdAt)}
                      </TableCell>
                      <TableCell align="right">
                        <IconButton
                          aria-label={`Editar ${user.name}`}
                          size="small"
                          onClick={() => openEdit(user)}
                          sx={{ color: 'onSurfaceVariant' }}
                        >
                          <IconEdit size={18} />
                        </IconButton>
                        <IconButton
                          aria-label={`Resetear contraseña de ${user.name}`}
                          size="small"
                          onClick={() => openReset(user)}
                          sx={{ color: 'onSurfaceVariant' }}
                        >
                          <IconKey size={18} />
                        </IconButton>
                        <IconButton
                          aria-label={`Eliminar ${user.name}`}
                          size="small"
                          onClick={() => openDelete(user)}
                          sx={{
                            color: 'onSurfaceVariant',
                            '&:hover': { bgcolor: 'errorContainer', color: 'onErrorContainer' },
                          }}
                        >
                          <IconDelete size={18} />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Create dialog */}
      <MuiDialog
        open={createOpen}
        onClose={closeCreate}
        title="Nuevo usuario"
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
                const formEl = document.querySelector('[data-platform-user-form]') as HTMLFormElement | null;
                formEl?.requestSubmit();
              }}
            >
              {submitting ? 'Creando...' : 'Crear usuario'}
            </MuiButton>
          </>
        }
      >
        <Box
          component="form"
          data-platform-user-form
          onSubmit={handleCreateSubmit}
          sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}
        >
          {createError && <MuiAlert severity="error">{createError}</MuiAlert>}

          <MuiTextField
            label="Empresa"
            value={createForm.tenantId}
            onChange={(e) => setCreateForm({ ...createForm, tenantId: e.target.value })}
            select
            required
            autoFocus
          >
            {tenants.map((tenant) => (
              <MenuItem key={tenant.id} value={tenant.id}>
                {tenant.name}
              </MenuItem>
            ))}
          </MuiTextField>

          <MuiTextField
            label="Nombre"
            placeholder="Nombre completo"
            value={createForm.name}
            onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
            required
          />

          <MuiTextField
            label="Email"
            type="email"
            placeholder="email@ejemplo.com"
            value={createForm.email}
            onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
            required
          />

          <MuiTextField
            label="Contraseña"
            type="password"
            placeholder="Mínimo 6 caracteres"
            value={createForm.password}
            onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
            required
            autoComplete="new-password"
          />

          <MuiTextField
            label="Rol"
            value={createForm.role}
            onChange={(e) => handleCreateRoleChange(e.target.value as UserRole)}
            select
            required
          >
            {ASSIGNABLE_ROLES.map((role) => (
              <MenuItem key={role} value={role}>
                {ROLE_LABELS[role]}
              </MenuItem>
            ))}
          </MuiTextField>

          {createForm.role === 'admin' ? (
            <PermissionsEditor
              value={createForm.permissions}
              onChange={(permissions) => setCreateForm({ ...createForm, permissions })}
              disabled={submitting}
            />
          ) : (
            <Typography variant="caption" color="onSurfaceVariant" sx={{ fontWeight: 600 }}>
              Los permisos de reparto y puesto son fijos.
            </Typography>
          )}
        </Box>
      </MuiDialog>

      {/* Edit dialog */}
      <MuiDialog
        open={editState !== null}
        onClose={closeEdit}
        title="Editar usuario"
        maxWidth="xs"
        actions={
          <>
            <MuiButton variant="secondary" onClick={closeEdit} disabled={editing}>
              Cancelar
            </MuiButton>
            <MuiButton variant="primary" isLoading={editing} disabled={editing || !editState} onClick={handleEditSubmit}>
              {editing ? 'Guardando...' : 'Guardar'}
            </MuiButton>
          </>
        }
      >
        {editState && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 1 }}>
            {editError && <MuiAlert severity="error">{editError}</MuiAlert>}

            <Typography variant="body2" color="onSurfaceVariant">
              {editState.user.email} · {editState.user.tenantName}
            </Typography>

            <MuiTextField
              label="Nombre"
              value={editState.name}
              onChange={(e) => setEditState({ ...editState, name: e.target.value })}
              required
              autoFocus
            />

            <MuiTextField
              label="Rol"
              value={editState.role}
              onChange={(e) => handleEditRoleChange(e.target.value as UserRole)}
              select
              required
            >
              {roleOptions.map((role) => (
                <MenuItem key={role} value={role}>
                  {ROLE_LABELS[role]}
                </MenuItem>
              ))}
            </MuiTextField>

            {editState.role === 'admin' ? (
              <PermissionsEditor
                value={editState.permissions}
                onChange={(permissions) => setEditState({ ...editState, permissions })}
                disabled={editing}
              />
            ) : (
              <Typography variant="caption" color="onSurfaceVariant" sx={{ fontWeight: 600 }}>
                {editState.role === 'superadmin'
                  ? 'El Super Admin siempre tiene acceso total.'
                  : 'Los permisos de reparto y puesto son fijos.'}
              </Typography>
            )}
          </Box>
        )}
      </MuiDialog>

      {/* Reset password dialog */}
      <MuiDialog
        open={resetTarget !== null}
        onClose={closeReset}
        title="Resetear contraseña"
        maxWidth="xs"
        actions={
          <>
            <MuiButton variant="secondary" onClick={closeReset} disabled={resetting}>
              Cancelar
            </MuiButton>
            <MuiButton variant="primary" isLoading={resetting} disabled={resetting} onClick={handleResetSubmit}>
              {resetting ? 'Guardando...' : 'Resetear'}
            </MuiButton>
          </>
        }
      >
        {resetTarget && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {resetError && <MuiAlert severity="error">{resetError}</MuiAlert>}

            <Typography variant="body2" color="onSurfaceVariant">
              Nueva contraseña para <Box component="span" sx={{ fontWeight: 700 }}>{resetTarget.name}</Box>
            </Typography>

            <MuiTextField
              label="Nueva contraseña"
              type="password"
              placeholder="Mínimo 8 caracteres"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              required
              autoFocus
              autoComplete="new-password"
            />
          </Box>
        )}
      </MuiDialog>

      {/* Delete dialog */}
      <MuiDialog
        open={deleteTarget !== null}
        onClose={closeDelete}
        title="Eliminar usuario"
        maxWidth="xs"
        actions={
          <>
            <MuiButton variant="secondary" onClick={closeDelete} disabled={deleting}>
              Cancelar
            </MuiButton>
            <MuiButton
              variant="danger"
              isLoading={deleting}
              disabled={deleting}
              startIcon={<IconDelete />}
              onClick={handleDeleteSubmit}
            >
              {deleting ? 'Eliminando...' : 'Eliminar'}
            </MuiButton>
          </>
        }
      >
        {deleteTarget && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {deleteError && <MuiAlert severity="error">{deleteError}</MuiAlert>}

            <Typography variant="body1">
              ¿Eliminar usuario <Box component="span" sx={{ fontWeight: 700 }}>{deleteTarget.name}</Box> de{' '}
              {deleteTarget.tenantName}?
            </Typography>

            <Typography variant="caption" color="text.secondary">
              Esta acción no se puede deshacer.
            </Typography>
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
