import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { IconInbox } from './icons';

interface EmptyStateProps {
  /** Icon inside the tonal circle. Defaults to an inbox glyph. */
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  /** Call-to-action button (an invitation to act, never plain text) */
  action?: ReactNode;
}

/**
 * EmptyState — icon in a tonal circle + title + subtitle + CTA.
 * WHY (frontend-design skill): an empty screen is an invitation to act,
 * not a mood. The tonal circle gives the void a focal point and the
 * optional CTA turns "nothing here" into "here's the next step".
 */
export function EmptyState({ icon, title, subtitle, action }: EmptyStateProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: 8,
        px: 2,
        textAlign: 'center',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 72,
          height: 72,
          borderRadius: '50%',
          bgcolor: 'surfaceContainerHighest',
          color: 'onSurfaceVariant',
          mb: 2,
        }}
      >
        {icon ?? <IconInbox size={30} />}
      </Box>
      <Typography variant="body1" sx={{ fontWeight: 600, color: 'onSurface' }}>
        {title}
      </Typography>
      {subtitle && (
        <Typography variant="body2" color="onSurfaceVariant" sx={{ maxWidth: 380, mt: 0.5 }}>
          {subtitle}
        </Typography>
      )}
      {action && <Box sx={{ mt: 2.5 }}>{action}</Box>}
    </Box>
  );
}