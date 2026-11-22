import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-with-providers.tsx';
import { PermissionsEditor } from '../PermissionsEditor.tsx';
import { PRESETS } from '../../../lib/permissions.ts';

describe('PermissionsEditor', () => {
  it('adds manage for a module and drops the redundant view', () => {
    const onChange = vi.fn();
    renderWithProviders(<PermissionsEditor value={['orders.view']} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Pedidos: administrar' }));

    expect(onChange).toHaveBeenCalledWith(['orders.manage']);
  });

  it('replaces the value with the selected preset', () => {
    const onChange = vi.fn();
    renderWithProviders(<PermissionsEditor value={['orders.view']} onChange={onChange} />);

    fireEvent.click(screen.getByText('Solo lectura'));

    expect(onChange).toHaveBeenCalledWith(PRESETS.readonly);
  });

  it('only exposes view for reports and manage for users', () => {
    renderWithProviders(<PermissionsEditor value={[]} onChange={() => undefined} />);

    expect(screen.queryByRole('button', { name: 'Reportes: administrar' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reportes: ver' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Usuarios: ver' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Usuarios: administrar' })).toBeDefined();
  });
});
