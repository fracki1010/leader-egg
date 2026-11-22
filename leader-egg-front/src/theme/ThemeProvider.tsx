import { type ReactNode } from 'react';
import { CssVarsProvider, useColorScheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { theme } from './theme';

/**
 * Custom hook to access and toggle color scheme.
 * Uses MUI's useColorScheme under the hood.
 */
export function useColorMode() {
  const { mode, systemMode, setMode } = useColorScheme();
  // `mode` can be 'system'; the toggle and the icon must look at the mode that
  // is actually in effect, otherwise the sun/moon glyph lies.
  const resolvedMode = (mode === 'system' ? systemMode : mode) ?? 'light';
  const toggle = () => setMode(resolvedMode === 'light' ? 'dark' : 'light');
  return { mode: resolvedMode, toggle };
}

interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * Wraps the application in MUI's CssVarsProvider.
 *
 * CssVarsProvider generates CSS custom properties (--mui-palette-primary-main etc.)
 * that are the primary styling mechanism. CssBaseline provides base resets.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  return (
    <CssVarsProvider
      theme={theme as any}
      defaultMode="light"
      disableTransitionOnChange={false}
    >
      <CssBaseline />
      {children}
    </CssVarsProvider>
  );
}
