import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { PlatformPuntoCeroPage } from '../PlatformPuntoCeroPage.tsx';
import type { PlatformPuntoCero } from '../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { platformApiMock, navigateMock } = vi.hoisted(() => ({
  platformApiMock: {
    getPuntoCero: vi.fn(),
    setPuntoCero: vi.fn(),
  },
  navigateMock: vi.fn(),
}));

vi.mock('../../api/platform.ts', () => ({ platformApi: platformApiMock }));
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ id: 't1' }),
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const baseData: PlatformPuntoCero = {
  tenant: { id: 't1', name: 'Distribuidora Sur', slug: 'distribuidora-sur' },
  state: {
    finalized: false,
    finalizedAt: null,
    openingBalances: { cash: 0, mp: 0, bank: 0 },
    openingBalancesSetAt: { cash: null, mp: null, bank: null },
  },
  products: [
    { id: 'p1', name: 'Blanco Chico', maplesPerCajon: 12, stock: 0 },
  ],
  customers: [{ id: 'c1', name: 'Cliente A', openingDebt: 0 }],
  suppliers: [{ id: 's1', name: 'Proveedor A', openingDebt: 0 }],
};

const finalizedData: PlatformPuntoCero = {
  ...baseData,
  state: {
    finalized: true,
    finalizedAt: '2026-02-01T12:00:00Z',
    openingBalances: { cash: 0, mp: 0, bank: 0 },
    openingBalancesSetAt: { cash: null, mp: null, bank: null },
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

async function fillWizardValues() {
  await screen.findByText('Stock inicial');
  fireEvent.change(screen.getByLabelText('Blanco Chico'), { target: { value: '10' } });
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));

  await screen.findByText('Saldos iniciales');
  fireEvent.change(screen.getByLabelText('Efectivo'), { target: { value: '1000' } });
  fireEvent.change(screen.getByLabelText('Mercado Pago'), { target: { value: '200' } });
  fireEvent.change(screen.getByLabelText('Banco'), { target: { value: '300' } });
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));

  await screen.findByText('Deudas de clientes');
  fireEvent.change(screen.getByLabelText('Cliente A'), { target: { value: '250' } });
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));

  await screen.findByText('Deudas con proveedores');
  fireEvent.change(screen.getByLabelText('Proveedor A'), { target: { value: '400' } });
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));

  await screen.findByText('Revisión final');
}

async function advanceToReviewWithoutValues() {
  await screen.findByText('Stock inicial');
  for (let i = 0; i < 4; i += 1) {
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
  }
  await screen.findByText('Revisión final');
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('PlatformPuntoCeroPage — platform wizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformApiMock.getPuntoCero.mockResolvedValue(baseData);
    platformApiMock.setPuntoCero.mockResolvedValue(baseData);
  });

  it('renders the company name and the "Sin finalizar" status chip', async () => {
    renderWithProviders(<PlatformPuntoCeroPage />);

    expect(await screen.findByText('Distribuidora Sur')).toBeDefined();
    expect(screen.getByText('Sin finalizar')).toBeDefined();
    expect(platformApiMock.getPuntoCero).toHaveBeenCalledWith('t1');
  });

  it('shows the entered values in the review step', async () => {
    renderWithProviders(<PlatformPuntoCeroPage />);

    await fillWizardValues();

    expect(screen.getByText('10 maples en 1 productos')).toBeDefined();
    expect(screen.getByText('$ 1.000,00')).toBeDefined();
    expect(screen.getByText('$ 200,00')).toBeDefined();
    expect(screen.getByText('$ 300,00')).toBeDefined();
    expect(screen.getByText('$ 1.500,00')).toBeDefined();
    expect(screen.getByText('$ 250,00')).toBeDefined();
    expect(screen.getByText('$ 400,00')).toBeDefined();
  });

  it('opens the confirmation modal and does not call the API until confirmed', async () => {
    renderWithProviders(<PlatformPuntoCeroPage />);

    await fillWizardValues();
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar Punto Cero' }));

    expect(
      await screen.findByText(/Ejecutar Punto Cero para Distribuidora Sur/),
    ).toBeDefined();
    expect(screen.getByText(/No se puede deshacer/)).toBeDefined();
    expect(platformApiMock.setPuntoCero).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Sí, ejecutar Punto Cero' }));

    await waitFor(() => {
      expect(platformApiMock.setPuntoCero).toHaveBeenCalledTimes(1);
    });
  });

  it('submits the expected payload once confirmed', async () => {
    renderWithProviders(<PlatformPuntoCeroPage />);

    await fillWizardValues();
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar Punto Cero' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, ejecutar Punto Cero' }));

    await waitFor(() => {
      expect(platformApiMock.setPuntoCero).toHaveBeenCalledWith('t1', {
        stock: [{ productId: 'p1', quantity: 10 }],
        openingBalances: { cash: 1000, mp: 200, bank: 300 },
        clientDebts: [{ customerId: 'c1', amount: 250 }],
        supplierDebts: [{ supplierId: 's1', amount: 400 }],
      });
    });

    expect(navigateMock).toHaveBeenCalledWith('/platform');
  });

  it('requires the slug and sends force:true when the setup is already finalized', async () => {
    platformApiMock.getPuntoCero.mockResolvedValue(finalizedData);
    platformApiMock.setPuntoCero.mockResolvedValue(finalizedData);

    renderWithProviders(<PlatformPuntoCeroPage />);

    expect(await screen.findByText(/Finalizado el/)).toBeDefined();
    expect(screen.getByText(/ya finalizó su Punto Cero/)).toBeDefined();

    await advanceToReviewWithoutValues();
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar Punto Cero' }));

    const confirm = (await screen.findByRole('button', {
      name: 'Sí, ejecutar Punto Cero',
    })) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    const slugInput = screen.getByLabelText(/Escribí el slug para confirmar/);
    fireEvent.change(slugInput, { target: { value: 'wrong-slug' } });
    expect(confirm.disabled).toBe(true);

    fireEvent.change(slugInput, { target: { value: 'distribuidora-sur' } });
    await waitFor(() => expect(confirm.disabled).toBe(false));

    fireEvent.click(confirm);

    await waitFor(() => {
      expect(platformApiMock.setPuntoCero).toHaveBeenCalledWith('t1', { force: true });
    });
  });
});
