import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore.ts';
import { MuiButton, MuiTextField, MuiCard } from '../components/ui/index.ts';
import { IconEgg, IconWarning } from '../components/ui/icons.tsx';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isLoading, error, clearError, isAuthenticated } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/dashboard';
  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();

    try {
      await login({ email, password });
      navigate(from, { replace: true });
    } catch {
      // Error is set in auth store
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        bgcolor: 'background.default',
        p: 2,
      }}
    >
      <MuiCard variant="elevated" sx={{ width: '100%', maxWidth: 400, p: 4 }}>
        {/* Brand */}
        <Box sx={{ textAlign: 'center', mb: 6 }}>
          <Box sx={{ mb: 2 }}>
            <IconEgg size={64} />
          </Box>
          <Typography variant="h4" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
            El Huevo Líder
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Distribuidora de huevos
          </Typography>
        </Box>

        {/* Form */}
        <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {error && (
            <Alert severity="error" icon={<IconWarning size={20} />}>
              {error}
            </Alert>
          )}

          <MuiTextField
            label="Correo electrónico"
            type="email"
            placeholder="admin@elhuevolider.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />

          <MuiTextField
            label="Contraseña"
            type="password"
            placeholder="Ingresá tu contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />

          <MuiButton
            variant="primary"
            type="submit"
            fullWidth
            isLoading={isLoading}
            disabled={isLoading}
          >
            {isLoading ? 'Ingresando...' : 'Ingresar'}
          </MuiButton>
        </Box>

        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', textAlign: 'center', mt: 4 }}
        >
          Sistema de gestión de pedidos y entregas
        </Typography>
      </MuiCard>
    </Box>
  );
}
