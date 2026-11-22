import Fab from '@mui/material/Fab';
import type { FabProps } from '@mui/material/Fab';
import { IconPlus } from './icons';

export interface MuiFabProps extends Omit<FabProps, 'variant'> {
  /** Color variant — defaults to 'primary' */
  color?: FabProps['color'];
  /** Icon shown when no children are provided — defaults to IconPlus */
  icon?: React.ReactNode;
}

/**
 * MuiFab — floating action button (rounded-full, primaryContainer,
 * soft glow shadow). Extended-FAB proportions when it carries a label
 * (children), otherwise a compact round FAB. Defaults to a "plus" icon.
 */
export function MuiFab({ color = 'primary', children, icon = <IconPlus />, ...props }: MuiFabProps) {
  return (
    <Fab
      color={color}
      {...props}
      sx={{
        position: 'fixed',
        bottom: {
          // Clear the fixed bottom nav AND the device safe area.
          xs: 'calc(84px + env(safe-area-inset-bottom, 0px))',
          md: 32,
        },
        right: 32,
        zIndex: 1000,
        borderRadius: '9999px',
        minHeight: children ? 56 : 48,
        padding: children ? '0 20px' : undefined,
        ...(color === 'primary' && {
          bgcolor: 'primaryContainer',
          color: 'onPrimaryContainer',
          boxShadow: '0 4px 14px color-mix(in srgb, var(--mui-palette-primaryContainer) 45%, transparent), 0 2px 6px rgba(0,0,0,0.08)',
          '&:hover': {
            bgcolor: 'primaryContainer',
            filter: 'brightness(0.96)',
            boxShadow: '0 6px 20px color-mix(in srgb, var(--mui-palette-primaryContainer) 55%, transparent), 0 4px 10px rgba(0,0,0,0.10)',
          },
        }),
        ...props.sx,
      }}
    >
      {children ?? icon}
    </Fab>
  );
}