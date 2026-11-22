import { createTheme } from '@mui/material/styles';
import type { Shadows } from '@mui/material/styles';

/* ═══════════════════════════════════════════════════════════════
   EL HUEVO LÍDER — Warm Cream / Vivid Orange Design System (PJS)
   ═══════════════════════════════════════════════════════════════
   Brand identity (from the user's reference style):
     font           → Plus Jakarta Sans (400/600/700/800) everywhere.
                      Numbers/stats = 800 with -0.02em tracking;
                      headlines = 700 with -0.02em; labels = 600–700
                      with a small-caps feel; body = 400.
     background     → warm cream #fff8f5. Cards are WHITE
                      (surface-container-lowest), 16px radius, soft
                      shadow-sm, hover shadow-md. NOT flat tonal.
     primary        → VIVID ORANGE #EA580C (main) / #F97316 (light);
                      container #ffdcc3 (light peach "yolk").
     secondary      → GREEN #006d30 (container #92f5a4) — semantic
                      success/paid counterpoint to orange.
     tertiary       → warm amber #b45309 (container #fde68a).
     error          → #ba1a1a, error-container #ffdad6.
     outline        → #887364, outline-variant #dbc2b0.

   Shape language:
     cards/containers → 16px (rounded-2xl)
     buttons/inputs   → 12px (rounded-xl)
     chips/pills      → full (9999)
     dialogs/bottom   → 28px (extra-large)
   ═══════════════════════════════════════════════════════════════ */

/* ── Typeface ─────────────────────────────────────────────────── */

export const MONO_FAMILY = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";
const FAMILY = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";

/* ── Brand ramps (50–900) ─────────────────────────────────────── */

/** Vivid orange — primary. Energetic brand accent (orange-500/600 family). */
const vividOrange = {
  50: '#FFF4ED',
  100: '#FFE6D5',
  200: '#FECAA9',
  300: '#FDA878',
  400: '#F98143',
  500: '#F97316',
  600: '#EA580C',
  700: '#C2410C',
  800: '#9A3A06',
  900: '#7C320B',
};

/** Green — secondary. The semantic "success/paid" counterpoint to vivid orange. */
const green = {
  50: '#E5F7EB',
  100: '#C5EFD2',
  200: '#98E0AE',
  300: '#5CCB7E',
  400: '#2FB359',
  500: '#129743',
  600: '#006D30',
  700: '#005A28',
  800: '#004520',
  900: '#003316',
};

/** Warm amber — tertiary. Cohesive orange-family accent (amber-700 family). */
const amber = {
  50: '#FFFBEB',
  100: '#FEF3C7',
  200: '#FDE68A',
  300: '#FCD34D',
  400: '#FBBF24',
  500: '#F59E0B',
  600: '#D97706',
  700: '#B45309',
  800: '#92400E',
  900: '#78350F',
};

const warningOrange = {
  50: '#FFF4EA',
  100: '#FFE4C7',
  200: '#FFCE9E',
  300: '#FFB06B',
  400: '#FF8C42',
  500: '#F2761F',
  600: '#C95E14',
  700: '#9E470F',
  800: '#6B300A',
  900: '#3B1B05',
};

const red = {
  50: '#FDEDEC',
  100: '#F9D5D2',
  200: '#F0AAA5',
  300: '#E67870',
  400: '#D94A42',
  500: '#C62B22',
  600: '#BA1A1A',
  700: '#961010',
  800: '#6E0A0A',
  900: '#4C0606',
};

const successGreen = {
  50: '#E7F6EC',
  100: '#C8E9D2',
  200: '#A5D9B5',
  300: '#7BC494',
  400: '#4FAE74',
  500: '#2C9459',
  600: '#007233',
  700: '#006026',
  800: '#004A1E',
  900: '#003516',
};

const infoBlue = {
  50: '#E9F2FA',
  100: '#CFE3F2',
  200: '#A3C9E8',
  300: '#6DA8D9',
  400: '#3D88C4',
  500: '#1F6DA8',
  600: '#00639B',
  700: '#00517F',
  800: '#003D60',
  900: '#002B44',
};

/* ── Color schemes ─────────────────────────────────────────────── */

const lightScheme = {
  palette: {
    /* M3 accent roles — vivid orange primary, green secondary (semantic
       success/paid counterpoint), amber tertiary. Primary main #EA580C
       keeps AA-large for white button text; light #F97316 is the vivid pop. */
    primary: { main: '#EA580C', light: '#F97316', dark: '#C2410C', contrastText: '#FFFFFF', ...vividOrange },
    onPrimary: '#FFFFFF',
    primaryContainer: '#FFDCC3',
    onPrimaryContainer: '#7C320B',
    primaryFixed: '#FFDCC3',
    onPrimaryFixed: '#7C320B',
    secondary: { main: green[600], light: green[400], dark: green[800], contrastText: '#FFFFFF', ...green },
    onSecondary: '#FFFFFF',
    secondaryContainer: '#92F5A4',
    onSecondaryContainer: '#007233',
    secondaryFixed: '#95F8A7',
    onSecondaryFixed: '#002107',
    tertiary: { main: amber[700], light: amber[500], dark: amber[800], contrastText: '#FFFFFF', ...amber },
    onTertiary: '#FFFFFF',
    tertiaryContainer: '#FDE68A',
    onTertiaryContainer: '#78350F',
    tertiaryFixed: '#FDE68A',
    onTertiaryFixed: '#78350F',
    error: { main: red[600], light: red[400], dark: red[800], contrastText: '#FFFFFF', ...red },
    onError: '#FFFFFF',
    errorContainer: '#FFDAD6',
    onErrorContainer: '#93000A',
    warning: { main: warningOrange[400], light: warningOrange[300], dark: warningOrange[600], contrastText: '#FFFFFF', ...warningOrange },
    warningContainer: '#FFDCC3',
    onWarningContainer: '#2F1500',
    success: { main: successGreen[600], light: successGreen[400], dark: successGreen[700], contrastText: '#FFFFFF', ...successGreen },
    successContainer: '#92F5A4',
    onSuccessContainer: '#007233',
    info: { main: infoBlue[600], light: infoBlue[400], dark: infoBlue[700], contrastText: '#FFFFFF', ...infoBlue },
    infoContainer: '#D6E5F7',
    onInfoContainer: '#00344F',
    /* M3 surface hierarchy — warm cream canvas, WHITE cards.
       background.default (#fff8f5) ≠ paper (#ffffff) → cards pop. */
    surface: '#FFF8F5',
    surfaceDim: '#E4D6D0',
    surfaceBright: '#FFF8F5',
    surfaceContainerLowest: '#FFFFFF',
    surfaceContainerLow: '#FAF2EE',
    surfaceContainer: '#F4ECE8',
    surfaceContainerHigh: '#EEE7E3',
    surfaceContainerHighest: '#E9E1DD',
    onSurface: '#1E1B19',
    onSurfaceVariant: '#554336',
    outline: '#887364',
    outlineVariant: '#DBC2B0',
    inverseSurface: '#322F2D',
    inverseOnSurface: '#F5ECE8',
    inversePrimary: '#FDA878',
    /* MUI mappings */
    background: { default: '#FFF8F5', paper: '#FFFFFF' },
    text: { primary: '#1E1B19', secondary: '#554336' },
    divider: '#DBC2B0',
  },
};

const darkScheme = {
  palette: {
    /* Inverted vivid-orange palette — same family, dark canvas */
    primary: { main: '#FDA878', light: '#FECAA9', dark: '#C2410C', contrastText: '#4A2500', 50: '#7C320B', 100: '#9A3A06', 200: '#C2410C', 300: '#EA580C', 400: '#F97316', 500: '#F98143', 600: '#FDA878', 700: '#FECAA9', 800: '#FFE6D5', 900: '#FFF4ED' },
    onPrimary: '#4A2500',
    primaryContainer: '#9A3A06',
    onPrimaryContainer: '#FFDCC3',
    primaryFixed: '#FFDCC3',
    onPrimaryFixed: '#7C320B',
    secondary: { main: '#77D98C', light: '#92F5A4', dark: '#006D30', contrastText: '#00391C', 50: '#003316', 100: '#004520', 200: '#005A28', 300: '#006D30', 400: '#129743', 500: '#2FB359', 600: '#5CCB7E', 700: '#98E0AE', 800: '#C5EFD2', 900: '#E5F7EB' },
    onSecondary: '#00391C',
    secondaryContainer: '#005325',
    onSecondaryContainer: '#92F5A4',
    secondaryFixed: '#95F8A7',
    onSecondaryFixed: '#002107',
    tertiary: { main: '#FBBF24', light: '#FCD34D', dark: '#92400E', contrastText: '#3E2500', 50: '#78350F', 100: '#92400E', 200: '#B45309', 300: '#D97706', 400: '#F59E0B', 500: '#FBBF24', 600: '#FCD34D', 700: '#FDE68A', 800: '#FEF3C7', 900: '#FFFBEB' },
    onTertiary: '#3E2500',
    tertiaryContainer: '#78350F',
    onTertiaryContainer: '#FDE68A',
    tertiaryFixed: '#FDE68A',
    onTertiaryFixed: '#78350F',
    error: { main: '#FFB4AB', light: '#FFDAD6', dark: '#BA1A1A', contrastText: '#690005', 50: '#4C0606', 100: '#6E0A0A', 200: '#961010', 300: '#BA1A1A', 400: '#C62B22', 500: '#D94A42', 600: '#E67870', 700: '#F0AAA5', 800: '#F9D5D2', 900: '#FDEDEC' },
    onError: '#690005',
    errorContainer: '#93000A',
    onErrorContainer: '#FFDAD6',
    warning: { main: '#FFB06B', light: '#FFCE9E', dark: '#F2761F', contrastText: '#3B1B05', 50: '#3B1B05', 100: '#6B300A', 200: '#9E470F', 300: '#C95E14', 400: '#F2761F', 500: '#FF8C42', 600: '#FFB06B', 700: '#FFCE9E', 800: '#FFE4C7', 900: '#FFF4EA' },
    warningContainer: '#6B300A',
    onWarningContainer: '#FFE4C7',
    success: { main: '#7BC494', light: '#A5D9B5', dark: '#007233', contrastText: '#003516', 50: '#003516', 100: '#004A1E', 200: '#006026', 300: '#007233', 400: '#2C9459', 500: '#4FAE74', 600: '#7BC494', 700: '#A5D9B5', 800: '#C8E9D2', 900: '#E7F6EC' },
    successContainer: '#005325',
    onSuccessContainer: '#92F5A4',
    info: { main: '#6DA8D9', light: '#A3C9E8', dark: '#00639B', contrastText: '#002B44', 50: '#002B44', 100: '#003D60', 200: '#00517F', 300: '#00639B', 400: '#1F6DA8', 500: '#3D88C4', 600: '#6DA8D9', 700: '#A3C9E8', 800: '#CFE3F2', 900: '#E9F2FA' },
    infoContainer: '#003D60',
    onInfoContainer: '#CFE3F2',
    surface: '#171310',
    surfaceDim: '#171310',
    surfaceBright: '#3E3835',
    surfaceContainerLowest: '#12100E',
    surfaceContainerLow: '#1F1A18',
    surfaceContainer: '#241F1D',
    surfaceContainerHigh: '#2E2927',
    surfaceContainerHighest: '#393432',
    onSurface: '#ECE1DD',
    onSurfaceVariant: '#D5C2B8',
    outline: '#9E887C',
    outlineVariant: '#4F4138',
    inverseSurface: '#ECE1DD',
    inverseOnSurface: '#322F2D',
    inversePrimary: '#EA580C',
    background: { default: '#141110', paper: '#1F1A18' },
    text: { primary: '#ECE1DD', secondary: '#D5C2B8' },
    divider: '#4F4138',
  },
};

/* ── PJS typography scale ───────────────────────────────────────
   One family everywhere (Plus Jakarta Sans). Display/headline
   stay tight (-0.02em) and heavy (800/700); titles 600–700;
   labels 600 with a small-caps feel (tracking); body 400. */

const pjsTypography = {
  fontFamily: FAMILY,
  htmlFontSize: 16,
  fontWeightLight: 400,
  fontWeightRegular: 400,
  fontWeightMedium: 600,
  fontWeightBold: 700,
  /* Display (hero) — 800, tight tracking, tabular numerals */
  h1: { fontFamily: FAMILY, fontWeight: 800, fontSize: '3.5625rem', lineHeight: '4rem', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' },
  h2: { fontFamily: FAMILY, fontWeight: 800, fontSize: '2.8125rem', lineHeight: '3.25rem', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' },
  h3: { fontFamily: FAMILY, fontWeight: 800, fontSize: '2.25rem', lineHeight: '2.75rem', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' },
  /* Headline — 700, tight tracking */
  h4: { fontFamily: FAMILY, fontWeight: 700, fontSize: '2rem', lineHeight: '2.5rem', letterSpacing: '-0.02em' },
  h5: { fontFamily: FAMILY, fontWeight: 700, fontSize: '1.75rem', lineHeight: '2.25rem', letterSpacing: '-0.02em' },
  h6: { fontFamily: FAMILY, fontWeight: 700, fontSize: '1.5rem', lineHeight: '2rem', letterSpacing: '-0.02em' },
  /* Title — 600–700 */
  subtitle1: { fontFamily: FAMILY, fontWeight: 600, fontSize: '1.375rem', lineHeight: '1.75rem', letterSpacing: '-0.01em' },
  subtitle2: { fontFamily: FAMILY, fontWeight: 600, fontSize: '1rem', lineHeight: '1.5rem', letterSpacing: '-0.01em' },
  titleLarge: { fontFamily: FAMILY, fontWeight: 700, fontSize: '1.375rem', lineHeight: '1.75rem', letterSpacing: '-0.01em' },
  titleMedium: { fontFamily: FAMILY, fontWeight: 600, fontSize: '1rem', lineHeight: '1.5rem', letterSpacing: '0em' },
  titleSmall: { fontFamily: FAMILY, fontWeight: 600, fontSize: '0.875rem', lineHeight: '1.25rem', letterSpacing: '0em' },
  /* Body — 400 */
  body1: { fontFamily: FAMILY, fontWeight: 400, fontSize: '1rem', lineHeight: '1.5rem', letterSpacing: '0em' },
  body2: { fontFamily: FAMILY, fontWeight: 400, fontSize: '0.875rem', lineHeight: '1.25rem', letterSpacing: '0em' },
  bodyLarge: { fontFamily: FAMILY, fontWeight: 400, fontSize: '1rem', lineHeight: '1.5rem', letterSpacing: '0em' },
  bodyMedium: { fontFamily: FAMILY, fontWeight: 400, fontSize: '0.875rem', lineHeight: '1.25rem', letterSpacing: '0em' },
  bodySmall: { fontFamily: FAMILY, fontWeight: 400, fontSize: '0.75rem', lineHeight: '1rem', letterSpacing: '0.02em' },
  /* Label — 600, small-caps feel via tracking */
  button: { fontFamily: FAMILY, fontWeight: 600, fontSize: '0.875rem', lineHeight: '1.25rem', letterSpacing: '0.02em', textTransform: 'none' },
  caption: { fontFamily: FAMILY, fontWeight: 400, fontSize: '0.75rem', lineHeight: '1rem', letterSpacing: '0.02em' },
  overline: { fontFamily: FAMILY, fontWeight: 700, fontSize: '0.6875rem', lineHeight: '1rem', letterSpacing: '0.1em', textTransform: 'uppercase' },
  labelLarge: { fontFamily: FAMILY, fontWeight: 600, fontSize: '0.875rem', lineHeight: '1.25rem', letterSpacing: '0.02em' },
  labelMedium: { fontFamily: FAMILY, fontWeight: 600, fontSize: '0.75rem', lineHeight: '1rem', letterSpacing: '0.04em' },
  labelSmall: { fontFamily: FAMILY, fontWeight: 600, fontSize: '0.6875rem', lineHeight: '1rem', letterSpacing: '0.06em' },
};

/* ── Shape scale (border radii) ─────────────────────────────────
   Cards 16 (rounded-2xl), buttons/inputs 12 (rounded-xl),
   chips full pills, dialogs 28. */

const m3Shape = {
  small: 8,
  medium: 12,
  large: 16,
  extraLarge: 28,
  full: 9999,
  borderRadius: 12,
};

export { m3Shape };

/* ── Elevation (soft, modern shadows) ───────────────────────────
   Softened 0.04–0.12 alpha for an airy lift; cards use shadow-sm
   (levels 1–2) and shadow-md (level 4) on hover. */

const m3Shadows: Shadows = [
  'none',
  '0 1px 2px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.04)',   // 1 — shadow-sm cards
  '0 1px 3px rgba(0,0,0,0.05), 0 4px 14px rgba(0,0,0,0.05)',    // 2 — nav bar, menus
  '0 2px 6px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.07)',    // 3 — FAB, dialogs
  '0 4px 10px rgba(0,0,0,0.07), 0 12px 32px rgba(0,0,0,0.09)',  // 4 — shadow-md hover
  '0 6px 14px rgba(0,0,0,0.09), 0 16px 40px rgba(0,0,0,0.11)',  // 5
  '0 8px 18px rgba(0,0,0,0.10), 0 20px 48px rgba(0,0,0,0.12)',
  '0 10px 22px rgba(0,0,0,0.11), 0 24px 56px rgba(0,0,0,0.13)',
  '0 12px 26px rgba(0,0,0,0.12), 0 28px 64px rgba(0,0,0,0.14)',
  '0 14px 30px rgba(0,0,0,0.13), 0 32px 72px rgba(0,0,0,0.15)',
  '0 16px 34px rgba(0,0,0,0.14), 0 36px 80px rgba(0,0,0,0.16)',
  '0 18px 38px rgba(0,0,0,0.14), 0 40px 88px rgba(0,0,0,0.17)',
  '0 20px 42px rgba(0,0,0,0.15), 0 44px 96px rgba(0,0,0,0.18)',
  '0 22px 46px rgba(0,0,0,0.15), 0 48px 104px rgba(0,0,0,0.19)',
  '0 24px 50px rgba(0,0,0,0.16), 0 52px 112px rgba(0,0,0,0.20)',
  '0 26px 54px rgba(0,0,0,0.16), 0 56px 120px rgba(0,0,0,0.21)',
  '0 28px 58px rgba(0,0,0,0.17), 0 60px 128px rgba(0,0,0,0.21)',
  '0 30px 62px rgba(0,0,0,0.17), 0 64px 136px rgba(0,0,0,0.22)',
  '0 32px 66px rgba(0,0,0,0.18), 0 68px 144px rgba(0,0,0,0.23)',
  '0 34px 70px rgba(0,0,0,0.18), 0 72px 152px rgba(0,0,0,0.23)',
  '0 36px 74px rgba(0,0,0,0.19), 0 76px 160px rgba(0,0,0,0.24)',
  '0 38px 78px rgba(0,0,0,0.19), 0 80px 168px rgba(0,0,0,0.24)',
  '0 40px 82px rgba(0,0,0,0.20), 0 84px 176px rgba(0,0,0,0.25)',
  '0 42px 86px rgba(0,0,0,0.20), 0 88px 184px rgba(0,0,0,0.25)',
  '0 44px 90px rgba(0,0,0,0.21), 0 92px 192px rgba(0,0,0,0.26)',
];

/* ═══════════════════════════════════════════════════════════════ */

export const theme = createTheme({
  // MUI defaults `colorSchemeSelector` to `'media'` when both schemes exist,
  // which makes the palette follow the OS preference and IGNORES setMode().
  // `'data'` writes `data-light` / `data-dark` on <html>, so the in-app
  // light/dark switch actually works.
  cssVariables: { colorSchemeSelector: 'data' },
  colorSchemes: {
    light: lightScheme,
    dark: darkScheme,
  },
  typography: pjsTypography,
  spacing: 8, // 8dp system
  shape: m3Shape,
  shadows: m3Shadows,
  components: {
    /* Buttons: rounded-xl (12px), weight 600, tactile active press */
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: m3Shape.medium,
          fontWeight: 600,
          letterSpacing: '0.01em',
          textTransform: 'none',
          minHeight: 44,
          transition: 'box-shadow 0.2s cubic-bezier(0.2, 0, 0, 1), background-color 0.2s, transform 0.12s',
          '&:active': {
            transform: 'scale(0.97)',
          },
        },
        contained: {
          boxShadow: '0 1px 2px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.06)',
          '&:hover': {
            boxShadow: '0 2px 6px rgba(0,0,0,0.10), 0 4px 12px rgba(0,0,0,0.10)',
          },
        },
        sizeLarge: {
          minHeight: 48,
        },
        sizeMedium: {
          minHeight: 44,
        },
        sizeSmall: {
          minHeight: 36,
        },
      },
    },
    /* FAB: rounded-full, primaryContainer, soft glow */
    MuiFab: {
      styleOverrides: {
        root: {
          borderRadius: m3Shape.full,
          boxShadow: '0 4px 14px color-mix(in srgb, var(--mui-palette-primaryContainer) 45%, transparent), 0 2px 6px rgba(0,0,0,0.08)',
          '&:hover': {
            boxShadow: '0 6px 20px color-mix(in srgb, var(--mui-palette-primaryContainer) 55%, transparent), 0 4px 10px rgba(0,0,0,0.10)',
          },
        },
      },
    },
    /* Dialogs / bottom sheets: extra-large corners on white */
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: m3Shape.extraLarge,
          backgroundColor: 'var(--mui-palette-surfaceContainerLowest)',
        },
      },
    },
    /* Cards: 16px radius, soft border on the white canvas.
       The MuiCard wrapper owns the white bg + shadow/hover behavior. */
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: m3Shape.large,
          '&.MuiCard-elevation': {
            backgroundImage: 'none',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: m3Shape.medium,
        },
      },
    },
    /* Chips: full pills, tiny labelMedium labels (weight 600);
       inactive = surfaceContainer, active colors pass through MUI color */
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: m3Shape.full,
          fontWeight: 600,
          letterSpacing: '0.02em',
        },
        label: {
          fontSize: '0.75rem',
          lineHeight: '1.25rem',
          fontWeight: 600,
        },
        filled: {
          '&.MuiChip-colorDefault': {
            backgroundColor: 'var(--mui-palette-surfaceContainer)',
            color: 'var(--mui-palette-onSurfaceVariant)',
            '&:hover': {
              backgroundColor: 'var(--mui-palette-surfaceContainerHigh)',
            },
          },
        },
        sizeSmall: {
          height: 26,
          '& .MuiChip-label': { px: 1.25 },
        },
        sizeMedium: {
          height: 34,
        },
      },
    },
    /* Inputs: rounded-xl (12px), primary focus ring */
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: m3Shape.medium,
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderWidth: 2,
            borderColor: 'var(--mui-palette-primary-main)',
          },
        },
      },
    },
    MuiFilledInput: {
      styleOverrides: {
        root: {
          borderRadius: m3Shape.medium,
          '&.Mui-focused': {
            backgroundColor: 'var(--mui-palette-surfaceContainerLow)',
          },
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          '&.Mui-focused': {
            color: 'var(--mui-palette-primary-main)',
          },
        },
      },
    },
    /* Dividers use outline-variant, not outline */
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: 'var(--mui-palette-outlineVariant)',
        },
      },
    },
    /* Cleaner table borders: outlineVariant at ~50% opacity */
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: '1px solid color-mix(in srgb, var(--mui-palette-outlineVariant) 50%, transparent)',
        },
        head: {
          fontWeight: 600,
          color: 'var(--mui-palette-onSurfaceVariant)',
        },
      },
    },
    /* Hover state layers for lists + menus */
    MuiListItemButton: {
      styleOverrides: {
        root: {
          '&:hover': {
            backgroundColor: 'var(--mui-palette-action-hover)',
          },
        },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          '&:hover': {
            backgroundColor: 'var(--mui-palette-action-hover)',
          },
        },
      },
    },
    /* Alerts: rounded-xl to match inputs/buttons */
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: m3Shape.medium,
        },
      },
    },
    /* Snackbar / tooltip use extra-small (4dp) corners */
    MuiSnackbar: {
      styleOverrides: {
        root: {
          '& .MuiSnackbarContent-root': {
            borderRadius: 4,
          },
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          borderRadius: 4,
        },
      },
    },
    /* Bottom navigation sits on surface-container. The hairline
       top border is applied by the Layout's fixed Paper wrapper
       (covers the safe-area inset), so no border here. */
    MuiBottomNavigation: {
      styleOverrides: {
        root: {
          backgroundColor: 'var(--mui-palette-surfaceContainer)',
          height: 64,
        },
      },
    },
    /* App bar is surface-container; hairline bottom border */
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: 'var(--mui-palette-surfaceContainer)',
          boxShadow: 'none',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: 'var(--mui-palette-surfaceContainer)',
        },
      },
    },
    /* Progress: pill tracks */
    MuiLinearProgress: {
      styleOverrides: {
        root: {
          borderRadius: m3Shape.full,
        },
      },
    },
  },
});