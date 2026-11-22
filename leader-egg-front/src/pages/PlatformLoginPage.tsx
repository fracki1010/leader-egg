import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { usePlatformAuthStore } from '../stores/platformAuthStore.ts';
import { MuiButton, MuiTextField, MuiCard } from '../components/ui/index.ts';
import { IconShieldPerson, IconWarning } from '../components/ui/icons.tsx';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';

/**
 * PlatformLoginPage — platform super-admin sign-in.
 * Posts to `/v1/platform/auth/login` via `platformAuthStore` and lands on the
 * tenant manager. Redirects to `/platform` when already signed in.
 */
export function PlatformLoginPage() {
  const navigate = useNavigate();
  const { login, isLoading, error, clearError, isAuthenticated } = usePlatformAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (isAuthenticated) {
    return <Navigate to="/platform" replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();

    try {
      await login({ email, password });
      navigate('/platform', { replace: true });
    } catch {
      // Error is surfaced by the store.
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
        <Box sx={{ textAlign: 'center', mb: 6 }}>
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 72,
              height: 72,
              borderRadius: '20px',
              bgcolor: 'primaryContainer',
              color: 'onPrimaryContainer',
              mb: 2,
            }}
          >
            <IconShieldPerson size={40} />
          </Box>
          <Typography variant="h4" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
            Panel de Plataforma
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Administración de empresas — El Huevo Líder
          </Typography>
        </Box>

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

          <MuiButton variant="primary" type="submit" fullWidth isLoading={isLoading} disabled={isLoading}>
            {isLoading ? 'Ingresando...' : 'Ingresar'}
          </MuiButton>
        </Box>

        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', textAlign: 'center', mt: 4 }}
        >
          Acceso exclusivo del equipo de plataforma
        </Typography>
      </MuiCard>
    </Box>
  );
}
