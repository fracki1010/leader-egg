import { useState, type FormEvent } from 'react';
import Box from '@mui/material/Box';
import MuiAlert from '@mui/material/Alert';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import { useAuthStore } from '../../stores/authStore.ts';
import { MuiButton, MuiDialog, MuiTextField } from '../ui/index.ts';
import { IconVisibilityOff } from '../ui/icons.tsx';

/** Minimum new-password length — mirrors the backend Zod schema. */
export const MIN_PASSWORD_LENGTH = 8;

interface ChangePasswordDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after the API accepted the change and the token was replaced. */
  onSuccess: () => void;
}

/**
 * ChangePasswordDialog — self-service password rotation for every tenant role.
 *
 * Validates locally (required current password, min length, new ≠ current,
 * confirmation match) and delegates the API call to the auth store, which also
 * persists the replacement token. The backend invalidates every previous token
 * (including the one used for this request), so the swap is not optional.
 */
export function ChangePasswordDialog({ open, onClose, onSuccess }: ChangePasswordDialogProps) {
  const changePassword = useAuthStore((state) => state.changePassword);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowPasswords(false);
    setFormError(null);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);

    if (!currentPassword) {
      setFormError('Ingresá tu contraseña actual');
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setFormError('La nueva contraseña debe tener al menos 8 caracteres');
      return;
    }
    if (newPassword === currentPassword) {
      setFormError('La nueva contraseña debe ser distinta de la actual');
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError('Las contraseñas no coinciden');
      return;
    }

    setSubmitting(true);
    void (async () => {
      try {
        await changePassword({ currentPassword, newPassword });
        reset();
        onSuccess();
      } catch (error) {
        setFormError(
          error instanceof Error ? error.message : 'Error al cambiar la contraseña',
        );
      } finally {
        setSubmitting(false);
      }
    })();
  };

  const inputType = showPasswords ? 'text' : 'password';
  const visibilityAdornment = (
    <InputAdornment position="end">
      <IconButton
        edge="end"
        aria-label={showPasswords ? 'Ocultar contraseñas' : 'Mostrar contraseñas'}
        onClick={() => setShowPasswords((prev) => !prev)}
        size="small"
      >
        <IconVisibilityOff size={18} />
      </IconButton>
    </InputAdornment>
  );

  return (
    <MuiDialog
      open={open}
      onClose={handleClose}
      title="Cambiar contraseña"
      maxWidth="xs"
      actions={
        <>
          <MuiButton variant="secondary" onClick={handleClose} disabled={submitting}>
            Cancelar
          </MuiButton>
          <MuiButton
            variant="primary"
            isLoading={submitting}
            disabled={submitting}
            onClick={() => {
              const form = document.getElementById('change-password-form') as HTMLFormElement | null;
              form?.requestSubmit();
            }}
          >
            {submitting ? 'Guardando...' : 'Guardar'}
          </MuiButton>
        </>
      }
    >
      <Box
        id="change-password-form"
        component="form"
        onSubmit={handleSubmit}
        sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}
      >
        {formError && <MuiAlert severity="error">{formError}</MuiAlert>}

        <MuiTextField
          label="Contraseña actual"
          type={inputType}
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          autoFocus
          autoComplete="current-password"
          slotProps={{ input: { endAdornment: visibilityAdornment } }}
        />

        <MuiTextField
          label="Nueva contraseña"
          type={inputType}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          autoComplete="new-password"
          helperText="Mínimo 8 caracteres"
          slotProps={{ input: { endAdornment: visibilityAdornment } }}
        />

        <MuiTextField
          label="Repetir nueva contraseña"
          type={inputType}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          autoComplete="new-password"
          slotProps={{ input: { endAdornment: visibilityAdornment } }}
        />
      </Box>
    </MuiDialog>
  );
}
