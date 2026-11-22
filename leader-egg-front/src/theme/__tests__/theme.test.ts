import { describe, it, expect } from 'vitest';
import { theme } from '../theme';

const vars = theme.vars;

describe('M3 theme tokens', () => {
  it('generates css vars for M3 surface container roles', () => {
    expect(vars).toBeDefined();
    expect(vars!.palette.surfaceContainerLow).toBeDefined();
    expect(vars!.palette.surfaceContainer).toBeDefined();
    expect(vars!.palette.surfaceContainerHigh).toBeDefined();
    expect(vars!.palette.surfaceContainerHighest).toBeDefined();
    expect(vars!.palette.surfaceContainerLowest).toBeDefined();
    expect(vars!.palette.surfaceDim).toBeDefined();
    expect(vars!.palette.surfaceBright).toBeDefined();
    expect(vars!.palette.outline).toBeDefined();
    expect(vars!.palette.outlineVariant).toBeDefined();
    expect(vars!.palette.onSurface).toBeDefined();
    expect(vars!.palette.onSurfaceVariant).toBeDefined();
    expect(vars!.palette.primaryContainer).toBeDefined();
    expect(vars!.palette.onPrimaryContainer).toBeDefined();
    expect(vars!.palette.secondaryContainer).toBeDefined();
    expect(vars!.palette.onSecondaryContainer).toBeDefined();
    expect(vars!.palette.tertiaryContainer).toBeDefined();
    expect(vars!.palette.errorContainer).toBeDefined();
    expect(vars!.palette.successContainer).toBeDefined();
    expect(vars!.palette.warningContainer).toBeDefined();
  });

  it('exposes M3 typography variants', () => {
    expect(theme.typography.titleLarge.fontSize).toBe('1.375rem');
    expect(theme.typography.labelLarge.fontWeight).toBe(600);
    expect(theme.typography.bodyMedium.fontSize).toBe('0.875rem');
  });

  it('exposes M3 shape scale', () => {
    expect(theme.shape.small).toBe(8);
    expect(theme.shape.medium).toBe(12);
    expect(theme.shape.large).toBe(16);
    expect(theme.shape.extraLarge).toBe(28);
    expect(theme.shape.full).toBe(9999);
  });

  it('exposes M3 elevation shadows', () => {
    expect(theme.shadows[0]).toBe('none');
    expect(theme.shadows[3]).toContain('rgba');
  });

  it('has full color role pairs in both schemes', () => {
    const schemes = (theme as unknown as { colorSchemes: { light: { palette: Record<string, unknown> }; dark: { palette: Record<string, unknown> } } }).colorSchemes;
    expect(schemes.light.palette.primaryContainer).toBeDefined();
    expect(schemes.light.palette.onPrimaryContainer).toBeDefined();
    expect(schemes.light.palette.tertiary).toBeDefined();
    expect(schemes.dark.palette.surfaceContainerHigh).toBeDefined();
    expect(schemes.dark.palette.onTertiaryContainer).toBeDefined();
  });
});