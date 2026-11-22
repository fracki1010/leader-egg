/**
 * Material Design 3 — MUI v9 type augmentations.
 *
 * Extends MUI's Theme with the full M3 token system:
 *  - Color roles (surface containers, on-* pairs, outline, tertiary, ...)
 *  - M3 shape scale (small/medium/large/extraLarge/full)
 *  - M3 typography scale (title/body/label large-medium-small)
 *  - 50–900 tonal scale on palette colors (brand ramp)
 *
 * NOTE: this file is ambient (no imports/exports) so the declarations are global.
 */
import type {} from '@mui/material/styles';
import type {} from '@mui/material/Typography';

declare module '@mui/material/styles' {
  /* ── M3 color roles (all palettes) ─────────────────────────── */
  interface Palette {
    /** Default background color */
    surface: string;
    /** Dimmest surface (both themes) */
    surfaceDim: string;
    /** Brightest surface (both themes) */
    surfaceBright: string;
    surfaceContainerLowest: string;
    surfaceContainerLow: string;
    /** Default container — navigation areas */
    surfaceContainer: string;
    surfaceContainerHigh: string;
    surfaceContainerHighest: string;
    /** Text/icons on any surface */
    onSurface: string;
    /** Lower-emphasis text/icons on surface */
    onSurfaceVariant: string;
    /** Important boundaries (text field borders) */
    outline: string;
    /** Decorative elements (dividers) */
    outlineVariant: string;
    primaryContainer: string;
    onPrimaryContainer: string;
    /** M3 "fixed" roles — mode-independent brand anchors */
    primaryFixed: string;
    onPrimaryFixed: string;
    secondaryContainer: string;
    onSecondaryContainer: string;
    secondaryFixed: string;
    onSecondaryFixed: string;
    /** Complementary accent group */
    tertiary: PaletteColor;
    onTertiary: string;
    tertiaryContainer: string;
    onTertiaryContainer: string;
    tertiaryFixed: string;
    onTertiaryFixed: string;
    onError: string;
    errorContainer: string;
    onErrorContainer: string;
    /** Brand extension — success/warning tonal containers */
    successContainer: string;
    onSuccessContainer: string;
    warningContainer: string;
    onWarningContainer: string;
    infoContainer: string;
    onInfoContainer: string;
    /** Inverse (snackbars) */
    inverseSurface: string;
    inverseOnSurface: string;
    inversePrimary: string;
  }

  interface PaletteOptions {
    surface?: string;
    surfaceDim?: string;
    surfaceBright?: string;
    surfaceContainerLowest?: string;
    surfaceContainerLow?: string;
    surfaceContainer?: string;
    surfaceContainerHigh?: string;
    surfaceContainerHighest?: string;
    onSurface?: string;
    onSurfaceVariant?: string;
    outline?: string;
    outlineVariant?: string;
    primaryContainer?: string;
    onPrimaryContainer?: string;
    primaryFixed?: string;
    onPrimaryFixed?: string;
    secondaryContainer?: string;
    onSecondaryContainer?: string;
    secondaryFixed?: string;
    onSecondaryFixed?: string;
    tertiary?: PaletteColorOptions;
    onTertiary?: string;
    tertiaryContainer?: string;
    onTertiaryContainer?: string;
    tertiaryFixed?: string;
    onTertiaryFixed?: string;
    onError?: string;
    errorContainer?: string;
    onErrorContainer?: string;
    successContainer?: string;
    onSuccessContainer?: string;
    warningContainer?: string;
    onWarningContainer?: string;
    infoContainer?: string;
    onInfoContainer?: string;
    inverseSurface?: string;
    inverseOnSurface?: string;
    inversePrimary?: string;
  }

  /* ── Brand tonal scale (primary.50 … primary.900) ─────────── */
  interface PaletteColor {
    50?: string;
    100?: string;
    200?: string;
    300?: string;
    400?: string;
    500?: string;
    600?: string;
    700?: string;
    800?: string;
    900?: string;
  }

  interface SimplePaletteColorOptions {
    50?: string;
    100?: string;
    200?: string;
    300?: string;
    400?: string;
    500?: string;
    600?: string;
    700?: string;
    800?: string;
    900?: string;
  }

  /* ── M3 shape scale ───────────────────────────────────────── */
  interface Shape {
    small: number;
    medium: number;
    large: number;
    extraLarge: number;
    full: number;
  }

  interface ShapeOptions {
    small?: number;
    medium?: number;
    large?: number;
    extraLarge?: number;
    full?: number;
  }

  /* ── M3 typography scale (custom variants) ────────────────── */
  interface TypographyVariants {
    titleLarge: React.CSSProperties;
    titleMedium: React.CSSProperties;
    titleSmall: React.CSSProperties;
    bodyLarge: React.CSSProperties;
    bodyMedium: React.CSSProperties;
    bodySmall: React.CSSProperties;
    labelLarge: React.CSSProperties;
    labelMedium: React.CSSProperties;
    labelSmall: React.CSSProperties;
  }

  interface TypographyVariantsOptions {
    titleLarge?: React.CSSProperties;
    titleMedium?: React.CSSProperties;
    titleSmall?: React.CSSProperties;
    bodyLarge?: React.CSSProperties;
    bodyMedium?: React.CSSProperties;
    bodySmall?: React.CSSProperties;
    labelLarge?: React.CSSProperties;
    labelMedium?: React.CSSProperties;
    labelSmall?: React.CSSProperties;
  }
}

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    titleLarge: true;
    titleMedium: true;
    titleSmall: true;
    bodyLarge: true;
    bodyMedium: true;
    bodySmall: true;
    labelLarge: true;
    labelMedium: true;
    labelSmall: true;
  }
}