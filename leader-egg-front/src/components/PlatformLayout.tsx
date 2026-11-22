import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { usePlatformAuthStore } from '../stores/platformAuthStore.ts';
import { MuiButton, MuiSnackbar } from './ui/index.ts';
import {
  IconBadge,
  IconEgg,
  IconKey,
  IconLogout,
  IconShieldPerson,
  IconStorefront,
} from './ui/icons.tsx';
import { PlatformChangePasswordDialog } from './PlatformChangePasswordDialog.tsx';
import Box from '@mui/material/Box';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';

/** Top-level platform sections, shown as navigation links under the app bar. */
const NAV_ITEMS = [
  { to: '/platform', label: 'Empresas', icon: <IconStorefront size={18} /> },
  { to: '/platform/users', label: 'Usuarios', icon: <IconBadge size={18} /> },
] as const;

/**
 * PlatformLayout — the platform admin area's OWN minimal shell.
 *
 * It never nests inside the tenant `Layout`: platform admins are not tenant
 * users, so they get a distinct app bar (brand + "Panel de Plataforma" + the
 * signed-in admin), a "Cambiar contraseña" action, and a logout that only
 * clears the platform session.
 */
export function PlatformLayout() {
  const { admin, logout } = usePlatformAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error';
  }>({ open: false, message: '', severity: 'success' });

  const handleLogout = () => {
    logout();
    navigate('/platform/login', { replace: true });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        position="sticky"
        color="default"
        elevation={0}
        sx={{ borderBottom: 1, borderColor: 'outlineVariant', bgcolor: 'surface' }}
      >
        <Toolbar sx={{ gap: 1.5 }}>
          <IconEgg size={28} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography component="div" variant="titleMedium" sx={{ fontWeight: 700, color: 'onSurface', lineHeight: 1.15 }} noWrap>
              Panel de Plataforma
            </Typography>
            <Typography variant="labelSmall" color="onSurfaceVariant" noWrap sx={{ display: 'block' }}>
              El Huevo Líder
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <Box
              sx={{
                display: { xs: 'none', sm: 'flex' },
                alignItems: 'center',
                gap: 0.75,
                px: 1.5,
                py: 0.5,
                borderRadius: '9999px',
                bgcolor: 'primaryContainer',
                color: 'onPrimaryContainer',
              }}
            >
              <IconShieldPerson size={14} />
              <Typography component="div" variant="labelMedium" noWrap sx={{ fontWeight: 700 }}>
                {admin?.name ?? 'Admin'}
              </Typography>
            </Box>
            <MuiButton
              variant="ghost"
              size="sm"
              onClick={() => setPasswordOpen(true)}
              startIcon={<IconKey size={16} />}
            >
              Cambiar contraseña
            </MuiButton>
            <MuiButton variant="ghost" size="sm" onClick={handleLogout} startIcon={<IconLogout size={16} />}>
              Salir
            </MuiButton>
          </Box>
        </Toolbar>
        <Box
          component="nav"
          sx={{
            display: 'flex',
            gap: 0.5,
            px: { xs: 1.5, sm: 3 },
            py: 1,
            borderTop: 1,
            borderColor: 'outlineVariant',
            flexWrap: 'wrap',
          }}
        >
          {NAV_ITEMS.map((item) => {
            const active = location.pathname === item.to;
            return (
              <Box
                key={item.to}
                component="button"
                type="button"
                onClick={() => navigate(item.to)}
                aria-current={active ? 'page' : undefined}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.75,
                  px: 2,
                  py: 1,
                  minHeight: 40,
                  borderRadius: '9999px',
                  border: 'none',
                  cursor: 'pointer',
                  font: 'inherit',
                  fontWeight: active ? 700 : 600,
                  whiteSpace: 'nowrap',
                  bgcolor: active ? 'primaryContainer' : 'transparent',
                  color: active ? 'onPrimaryContainer' : 'onSurfaceVariant',
                  '&:hover': {
                    bgcolor: active ? 'primaryContainer' : 'surfaceContainerHigh',
                  },
                }}
              >
                {item.icon}
                {item.label}
              </Box>
            );
          })}
        </Box>
      </AppBar>

      <Box
        component="main"
        sx={{ flex: 1, width: '100%', maxWidth: 1200, mx: 'auto', p: { xs: 2, sm: 3, md: 4 } }}
      >
        <Outlet />
      </Box>

      <PlatformChangePasswordDialog
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        onSuccess={(message) => {
          setPasswordOpen(false);
          setSnackbar({ open: true, message, severity: 'success' });
        }}
        onError={(message) => setSnackbar({ open: true, message, severity: 'error' })}
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
