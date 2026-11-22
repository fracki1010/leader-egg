import { forwardRef } from 'react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import type { AlertColor } from '@mui/material/Alert';

export interface MuiSnackbarProps {
  open: boolean;
  onClose: () => void;
  message?: string;
  severity?: AlertColor;
  autoHideDuration?: number;
  action?: React.ReactNode;
}

/**
 * M3 Snackbar — transient alert with 4s auto-dismiss.
 * Wraps MUI Snackbar + Alert for consistent brand styling.
 */
export const MuiSnackbar = forwardRef<HTMLDivElement, MuiSnackbarProps>(
  (
    {
      open,
      onClose,
      message,
      severity = 'success',
      autoHideDuration = 4000,
      action,
    },
    ref,
  ) => {
    return (
      <Snackbar
        ref={ref}
        open={open}
        autoHideDuration={autoHideDuration}
        onClose={onClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={onClose}
          severity={severity}
          variant="filled"
          action={action}
          sx={{ width: '100%' }}
        >
          {message}
        </Alert>
      </Snackbar>
    );
  },
);

MuiSnackbar.displayName = 'MuiSnackbar';
