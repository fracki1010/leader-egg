import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import { ThemeProvider } from '../ThemeProvider';
import { MuiFab, MuiDialog } from '../../components/ui/index';
import { IconPlus, IconDashboard, IconStock } from '../../components/ui/icons';

/**
 * Runtime smoke test: verifies the M3 theme renders through the real
 * CssVarsProvider and that the M3 tokens + icon system resolve at runtime.
 */
describe('M3 theme runtime smoke', () => {
  it('renders M3 token-driven surfaces', () => {
    const { container } = render(
      <ThemeProvider>
        <Box sx={{ bgcolor: 'surfaceContainerLow', color: 'onSurface' }} data-testid="surface" />
      </ThemeProvider>,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it('renders icon system components', () => {
    const { container } = render(
      <ThemeProvider>
        <IconPlus size={20} data-testid="plus" />
        <IconDashboard />
        <IconStock color="var(--mui-palette-primary-main)" />
      </ThemeProvider>,
    );
    expect(container.querySelectorAll('svg').length).toBe(3);
  });

  it('renders MUI components with M3 styling', () => {
    const { container } = render(
      <ThemeProvider>
        <Button>Acción</Button>
        <Chip label="Activo" color="success" />
        <Typography variant="titleMedium">Título</Typography>
        <Typography variant="labelLarge">Etiqueta</Typography>
      </ThemeProvider>,
    );
    expect(container.querySelector('button')).toBeTruthy();
    expect(container.textContent).toContain('Acción');
  });

  it('renders MuiFab with default IconPlus and M3 container colors', () => {
    const { container } = render(
      <ThemeProvider>
        <MuiFab aria-label="nuevo" />
      </ThemeProvider>,
    );
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders MuiDialog with IconX close button', () => {
    render(
      <ThemeProvider>
        <MuiDialog open onClose={() => undefined} title="Título">
          Contenido
        </MuiDialog>
      </ThemeProvider>,
    );
    // MUI Dialog renders in a portal attached to document.body
    expect(document.body.querySelector('[aria-label="close"] svg')).toBeTruthy();
    expect(document.body.textContent).toContain('Título');
  });
});