import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore.ts';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { MuiButton } from '../components/ui/MuiButton.tsx';
import { IconWarning } from '../components/ui/icons.tsx';

/**
 * Shown to an admin whose account has no modules enabled. It is intentionally
 * outside the dynamic-home redirect chain to avoid an infinite loop.
 */
export function SinAccesoPage() {
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
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
          width: 64,
          height: 64,
          borderRadius: '50%',
          bgcolor: 'warningContainer',
          color: 'onWarningContainer',
        }}
      >
        <IconWarning size={30} />
      </Box>
      <Typography variant="titleLarge" sx={{ fontWeight: 700, color: 'onSurface' }}>
        Sin acceso a módulos
      </Typography>
      <Typography variant="body2" color="onSurfaceVariant" sx={{ maxWidth: 420 }}>
        No tenés módulos habilitados. Pedile a un administrador que te asigne permisos.
      </Typography>
      <MuiButton variant="primary" onClick={() => void handleLogout()} sx={{ mt: 1 }}>
        Cerrar sesión
      </MuiButton>
    </Box>
  );
}
