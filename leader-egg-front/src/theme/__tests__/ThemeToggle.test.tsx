import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../ThemeProvider.tsx';
import { ThemeToggle } from '../../components/ThemeToggle.tsx';

/**
 * Regression guard: MUI defaults `colorSchemeSelector` to `'media'` when both
 * light and dark schemes are provided. In that mode the palette follows the OS
 * and `setMode` has NO visual effect — the exact bug this test locks down.
 */
describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('actually switches the palette between light and dark', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    const html = document.documentElement;
    const surface = () => getComputedStyle(html).getPropertyValue('--mui-palette-surface').trim();

    const light = surface();
    expect(light).not.toBe('');

    fireEvent.click(screen.getByRole('button'));
    const dark = surface();
    expect(dark).not.toBe(light);

    fireEvent.click(screen.getByRole('button'));
    expect(surface()).toBe(light);
  });
});
