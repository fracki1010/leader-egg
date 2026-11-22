import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { useColorMode } from '../theme/index.ts';
import { IconDarkMode, IconLightMode } from './ui/icons.tsx';

interface ThemeToggleProps {
  /** `sm` fits the app bar / sidebar rows; `md` for standalone placements. */
  size?: 'sm' | 'md';
}

/**
 * Color-scheme switch (light ⇄ dark).
 *
 * The app's palette ships both M3 schemes, so this only flips the active one;
 * MUI persists the choice under `mui-mode`, which makes "light" stick across
 * reloads and installs. The icon shows the mode you would switch TO.
 */
export function ThemeToggle({ size = 'sm' }: ThemeToggleProps) {
  const { mode, toggle } = useColorMode();
  const isDark = mode === 'dark';

  return (
    <Tooltip title={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}>
      <IconButton
        aria-label={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
        onClick={toggle}
        size={size === 'sm' ? 'small' : 'medium'}
        sx={{
          width: size === 'sm' ? 36 : 44,
          height: size === 'sm' ? 36 : 44,
          color: 'onSurfaceVariant',
          bgcolor: 'surfaceContainerHigh',
          border: '1px solid',
          borderColor: 'outlineVariant',
          '&:hover': { bgcolor: 'surfaceContainerHighest', color: 'onSurface' },
        }}
      >
        {isDark ? <IconLightMode size={size === 'sm' ? 18 : 22} /> : <IconDarkMode size={size === 'sm' ? 18 : 22} />}
      </IconButton>
    </Tooltip>
  );
}
