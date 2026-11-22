import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-with-providers.tsx';
import { OpeningBalancesSection } from '../OpeningBalancesSection.tsx';
import { ApiError } from '../../../api/client.ts';
import type { BusinessConfig } from '../../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { setupApiMock } = vi.hoisted(() => ({
  setupApiMock: { getPuntoCero: vi.fn(), updateOpeningBalances: vi.fn() },
}));

vi.mock('../../../api/setup.ts', () => ({ setupApi: setupApiMock }));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const puntoCero: BusinessConfig = {
  finalized: true,
  openingCash: 50000,
  openingBalances: { cash: 50000, mp: 10000, bank: 400000 },
  openingBalancesSetAt: { cash: null, mp: null, bank: null },
  clientDebts: [],
  supplierDebts: [],
  stock: [],
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('OpeningBalancesSection — one-time lock preserved', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupApiMock.getPuntoCero.mockResolvedValue(puntoCero);
    setupApiMock.updateOpeningBalances.mockResolvedValue(puntoCero);
  });

  it('shows the three balances and submits only unlocked accounts', async () => {
    renderWithProviders(<OpeningBalancesSection />);

    expect(await screen.findByText('$ 50.000,00')).toBeDefined();
    expect(screen.getByText('$ 10.000,00')).toBeDefined();
    expect(screen.getByText('$ 400.000,00')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /Editar saldos/i }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText('Efectivo'), { target: { value: '70000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Guardar/i }));

    await waitFor(() => {
      expect(setupApiMock.updateOpeningBalances).toHaveBeenCalledWith({
        cash: 70000,
        mp: 10000,
        bank: 400000,
      });
    });
    expect(await screen.findByText('Saldos iniciales actualizados')).toBeDefined();
  });

  it('never re-submits an account whose opening balance is already locked', async () => {
    setupApiMock.getPuntoCero.mockResolvedValue({
      ...puntoCero,
      openingBalancesSetAt: { cash: '2026-01-01T12:00:00.000Z', mp: null, bank: null },
    });

    renderWithProviders(<OpeningBalancesSection />);
    await screen.findByText(/Bloqueado · cargado el 01\/01\/2026/);

    fireEvent.click(screen.getByRole('button', { name: /Editar saldos/i }));
    const dialog = await screen.findByRole('dialog');

    const cashInput = within(dialog).getByLabelText('Efectivo') as HTMLInputElement;
    expect(cashInput.disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText('Mercado Pago'), { target: { value: '20000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Guardar/i }));

    await waitFor(() => {
      expect(setupApiMock.updateOpeningBalances).toHaveBeenCalledWith({ mp: 20000, bank: 400000 });
    });
  });

  it('refreshes the lock state and shows the message on a 409', async () => {
    setupApiMock.updateOpeningBalances.mockRejectedValue(
      new ApiError('La cuenta ya fue cargada', 409),
    );

    renderWithProviders(<OpeningBalancesSection />);
    await screen.findByText('$ 50.000,00');

    fireEvent.click(screen.getByRole('button', { name: /Editar saldos/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Efectivo'), { target: { value: '70000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Guardar/i }));

    expect(await screen.findByText('La cuenta ya fue cargada')).toBeDefined();
    await waitFor(() => expect(setupApiMock.getPuntoCero.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
