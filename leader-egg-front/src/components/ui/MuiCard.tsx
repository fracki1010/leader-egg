import type { ReactNode, MouseEvent } from 'react';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';

type CardVariant = 'elevated' | 'filled' | 'outlined';

interface MuiCardProps {
  variant?: CardVariant;
  children: ReactNode;
  className?: string;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  sx?: Record<string, unknown>;
}

/**
 * MuiCard — Wrapper for MUI Card with the white/soft card style.
 *
 * All variants share the brand card recipe: WHITE background
 * (surface-container-lowest), 16px radius (rounded-2xl), a subtle
 * outline-variant border at 40% opacity, and soft shadows — NOT flat
 * tonal surfaces.
 * - Elevated: white + shadow-sm (elevation 1)
 * - Filled:   white + stronger shadow (elevation 3) — "sticky" cards
 * - Outlined: white + border, no shadow
 *
 * Clickable cards get a gentle hover lift (shadow-md + translateY(-1px))
 * that makes lists feel tactile.
 */
export function MuiCard({
  variant = 'elevated',
  children,
  className,
  onClick,
  sx,
}: MuiCardProps) {
  return (
    <Card
      variant={variant === 'outlined' ? 'outlined' : 'elevation'}
      elevation={variant === 'filled' ? 3 : 1}
      className={className}
      onClick={onClick}
      sx={{
        backgroundColor: 'surfaceContainerLowest',
        border: 1,
        borderColor: 'color-mix(in srgb, var(--mui-palette-outlineVariant) 40%, transparent)',
        ...(variant === 'outlined' && {
          boxShadow: 'none',
        }),
        ...(onClick && {
          cursor: 'pointer',
          transition: 'transform 0.18s cubic-bezier(0.2, 0, 0, 1), box-shadow 0.18s, border-color 0.18s',
          '&:hover': {
            transform: 'translateY(-1px)',
            boxShadow: '0 4px 10px rgba(0,0,0,0.07), 0 12px 32px rgba(0,0,0,0.09)',
          },
        }),
        ...sx,
      }}
    >
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>{children}</CardContent>
    </Card>
  );
}