import { useState, type FormEvent } from 'react';
import { useChangePlatformPassword } from '../hooks/mutations/index.ts';
import { MuiButton, MuiDialog, MuiTextField } from './ui/index.ts';
import Box from '@mui/material/Box';
import MuiAlert from '@mui/material/Alert';

/**
 * PlatformChangePasswordDialog — self-service password change for the
 * signed-in platform admin. Validates the new password locally (min length +
 * confirmation) and delegates the API call to the TanStack Query mutation.
 *
 * Success and server errors are surfaced through the parent's snackbar via the
 * `onSuccess` / `onError` callbacks, keeping this component free of app chrome.
 */

/** Minimum new-password length — mirrors the backend Zod schema. */
export const MIN_PASSWORD_LENGTH = 8;

interface PlatformChangePasswordDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

export function PlatformChangePasswordDialog({
  open,
  onClose,
  onSuccess,
  onError,
}: PlatformChangePasswordDialogProps) {
  const changePassword = useChangePlatformPassword();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const submitting = changePassword.isPending;

  const reset = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setFormError(null);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const submit = () => {
    setFormError(null);

    if (!currentPassword) {
      setFormError('Ingresá tu contraseña actual');
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setFormError('La nueva contraseña debe tener al menos 8 caracteres');
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError('Las contraseñas no coinciden');
      return;
    }

    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          reset();
          onSuccess('Contraseña actualizada correctamente');
        },
        onError: (error) => {
          const message =
            error instanceof Error ? error.message : 'Error al cambiar la contraseña';
          setFormError(message);
          onError(message);
        },
      },
    );
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

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
            onClick={submit}
          >
            {submitting ? 'Guardando...' : 'Guardar'}
          </MuiButton>
        </>
      }
    >
      <Box
        component="form"
        onSubmit={handleSubmit}
        sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}
      >
        {formError && <MuiAlert severity="error">{formError}</MuiAlert>}

        <MuiTextField
          label="Contraseña actual"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          autoFocus
          autoComplete="current-password"
        />

        <MuiTextField
          label="Nueva contraseña"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          autoComplete="new-password"
          helperText="Mínimo 8 caracteres"
        />

        <MuiTextField
          label="Repetir nueva contraseña"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          autoComplete="new-password"
        />
      </Box>
    </MuiDialog>
  );
}
