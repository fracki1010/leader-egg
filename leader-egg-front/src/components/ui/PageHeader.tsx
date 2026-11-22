import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

interface PageHeaderProps {
  /** Page title — rendered in the Plus Jakarta Sans display typeface */
  title: string;
  /** Optional node rendered inline after the title (e.g. a count pill) */
  titleAdornment?: ReactNode;
  /** Supporting line under the title (onSurfaceVariant) */
  subtitle?: string;
  /** Icon rendered in a tonal "yolk" container (primaryContainer) */
  icon?: ReactNode;
  /** Right-aligned actions (buttons, filters…) — wraps on mobile */
  actions?: ReactNode;
}

/**
 * PageHeader — the single page-head pattern for the whole app.
 *
 * WHY (interface-design skill): every page used to hand-roll its header
 * with slightly different sizes, icon containers and spacing. One
 * component = one hierarchy: icon chip leads, PJS title carries the
 * personality, subtitle stays quiet, actions sit right. Stacks on mobile.
 *
 * Signature: the icon sits in a 48px primaryContainer chip with a
 * medium radius — the "yolk chip" that anchors every section.
 */
export function PageHeader({ title, titleAdornment, subtitle, icon, actions }: PageHeaderProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 2,
        mb: 4,
        flexDirection: { xs: 'column', md: 'row' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
        {icon && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 48,
              height: 48,
              borderRadius: '16px',
              bgcolor: 'primaryContainer',
              color: 'onPrimaryContainer',
              flexShrink: 0,
            }}
          >
            {icon}
          </Box>
        )}
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap', minWidth: 0 }}>
            <Typography
              variant="h4"
              sx={{ fontWeight: 700, letterSpacing: '-0.02em', color: 'onSurface', lineHeight: 1.2 }}
            >
              {title}
            </Typography>
            {titleAdornment}
          </Box>
          {subtitle && (
            <Typography variant="body2" color="onSurfaceVariant" sx={{ mt: 0.5 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
      </Box>
      {actions && (
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', flexShrink: 0 }}>{actions}</Box>
      )}
    </Box>
  );
}