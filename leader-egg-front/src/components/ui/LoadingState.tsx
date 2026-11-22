import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';

interface LoadingStateProps {
  /** Accessible + visible label under the spinner */
  label?: string;
  minHeight?: number;
}

/**
 * LoadingState — centered spinner with a label.
 * WHY: bare spinners float in space; a label grounds the wait
 * ("Cargando tus órdenes…") and reads as a designed state, not a bug.
 */
export function LoadingState({ label = 'Cargando…', minHeight = 400 }: LoadingStateProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        minHeight,
      }}
    >
      <CircularProgress size={36} thickness={4} />
      <Typography variant="body2" color="onSurfaceVariant">
        {label}
      </Typography>
    </Box>
  );
}