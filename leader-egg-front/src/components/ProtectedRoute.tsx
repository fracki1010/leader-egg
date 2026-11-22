import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore.ts';
import { getHomePath, hasPermission } from '../lib/permissions.ts';
import type { UserRole } from '../types/index.ts';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { MuiButton } from './ui/MuiButton.tsx';
import { IconWarning } from './ui/icons.tsx';

interface ProtectedRouteProps {
  allowedRoles?: UserRole[];
  /** Module permission required for admins (ignored for other roles). */
  permission?: string;
}

export function ProtectedRoute({ allowedRoles, permission }: ProtectedRouteProps) {
  const { isAuthenticated, user } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // No guard → any authenticated user passes.
  // Otherwise the user's role must be listed, or the user is a superadmin
  // and the guard allows admins (superadmin inherits admin access; admin
  // does NOT inherit superadmin-only routes).
  const isAllowed = !allowedRoles
    || allowedRoles.includes(user.role)
    || (user.role === 'superadmin' && allowedRoles.includes('admin'));

  // Module permissions only constrain admins. Superadmins bypass them and the
  // backend ignores module permissions for driver / puesto / viewer.
  const hasModuleAccess = !permission
    || user.role === 'superadmin'
    || user.role !== 'admin'
    || hasPermission(user.permissions ?? [], permission);

  if (!isAllowed || !hasModuleAccess) {
    const home = getHomePath(user);
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1.5,
          minHeight: '60vh',
          px: 3,
          textAlign: 'center',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 56,
            height: 56,
            borderRadius: '50%',
            bgcolor: 'errorContainer',
            color: 'onErrorContainer',
            mb: 1,
          }}
        >
          <IconWarning size={26} />
        </Box>
        <Typography variant="titleLarge" sx={{ fontWeight: 700, color: 'onSurface' }}>
          403 — Acceso denegado
        </Typography>
        <Typography variant="body2" color="onSurfaceVariant" sx={{ maxWidth: 420 }}>
          No tenés permiso para acceder a esta página.
        </Typography>
        <MuiButton variant="primary" onClick={() => navigate(home, { replace: true })} sx={{ mt: 1 }}>
          Volver
        </MuiButton>
      </Box>
    );
  }

  return <Outlet />;
}
