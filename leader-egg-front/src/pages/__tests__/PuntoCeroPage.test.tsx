import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { PuntoCeroPage } from '../PuntoCeroPage.tsx';
import type { BusinessConfig, Customer, Product } from '../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { setupApiMock, productsApiMock, customersApiMock, suppliersApiMock, navigateMock } = vi.hoisted(() => ({
  setupApiMock: { getPuntoCero: vi.fn(), setPuntoCero: vi.fn() },
  productsApiMock: { list: vi.fn() },
  customersApiMock: { list: vi.fn() },
  suppliersApiMock: { list: vi.fn() },
  navigateMock: vi.fn(),
}));

vi.mock('../../api/setup.ts', () => ({ setupApi: setupApiMock }));
vi.mock('../../api/products.ts', () => ({ productsApi: productsApiMock }));
vi.mock('../../api/customers.ts', () => ({ customersApi: customersApiMock }));
vi.mock('../../api/suppliers.ts', () => ({ suppliersApi: suppliersApiMock }));
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const unfinalized: BusinessConfig = {
  finalized: false,
  openingCash: 0,
  openingBalances: { cash: 0, mp: 0, bank: 0 },
  openingBalancesSetAt: { cash: null, mp: null, bank: null },
  clientDebts: [],
  supplierDebts: [],
  stock: [],
};

const finalized: BusinessConfig = {
  finalized: true,
  openingCash: 50000,
  openingBalances: { cash: 50000, mp: 0, bank: 0 },
  openingBalancesSetAt: { cash: null, mp: null, bank: null },
  clientDebts: [{ customerId: 'c1', name: 'Cliente A', amount: 25000 }],
  supplierDebts: [],
  stock: [],
};

const product: Product = {
  _id: 'p1',
  variety: 'blanco',
  caliber: 'chico',
  displayName: 'Blanco Chico',
  eggsPerMaple: 30,
  maplesPerCajon: 12,
  lowStockThreshold: 20,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const customer: Customer = {
  _id: 'c1',
  name: 'Cliente A',
  type: 'B2C',
  phone: '+5491100000000',
  address: 'Av. Test 123',
  creditConfig: { limit: 0, termDays: 0 },
  openingDebt: 0,
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('PuntoCeroPage — wizard flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupApiMock.getPuntoCero.mockResolvedValue(unfinalized);
    productsApiMock.list.mockResolvedValue([product]);
    customersApiMock.list.mockResolvedValue([customer]);
    suppliersApiMock.list.mockResolvedValue([]);
  });

  it('walks through the 4 steps + review and finalizes with the accumulated payload', async () => {
    renderWithProviders(<PuntoCeroPage />);

    // Step 1 — Stock
    expect(await screen.findByText('Stock inicial')).toBeDefined();
    fireEvent.change(screen.getByLabelText('Blanco Chico'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));

    // Step 2 — Caja
    expect(await screen.findByText('Caja inicial')).toBeDefined();
    fireEvent.change(screen.getByLabelText('Dinero en caja'), { target: { value: '50000' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));

    // Step 3 — Clientes
    expect(await screen.findByText('Deudas de clientes')).toBeDefined();
    fireEvent.change(screen.getByLabelText('Cliente A'), { target: { value: '25000' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));

    // Step 4 — Proveedores (no suppliers → skipped hint)
    expect(await screen.findByText('Deudas con proveedores')).toBeDefined();
    expect(screen.getByText(/este paso se saltea/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));

    // Step 5 — Review + finalize
    expect(await screen.findByText('Revisión final')).toBeDefined();
    expect(screen.getByText('10 maples en 1 productos')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Finalizar Punto Cero/ }));

    await waitFor(() => {
      expect(setupApiMock.setPuntoCero).toHaveBeenCalledWith({
        openingCash: 50000,
        stock: [{ productId: 'p1', quantity: 10 }],
        clientDebts: [{ customerId: 'c1', amount: 25000 }],
      });
    });
    expect(navigateMock).toHaveBeenCalledWith('/dashboard');
  });

  it('shows the read-only summary when the setup is already finalized', async () => {
    setupApiMock.getPuntoCero.mockResolvedValue(finalized);

    renderWithProviders(<PuntoCeroPage />);

    expect(await screen.findByText('Punto cero ya establecido')).toBeDefined();
    expect(screen.getByText('$ 50.000,00')).toBeDefined();
    expect(screen.getByText('Cliente A')).toBeDefined();
    expect(screen.getByText('$ 25.000,00')).toBeDefined();
    expect(screen.getByRole('button', { name: /Ir al dashboard/ })).toBeDefined();
    expect(setupApiMock.setPuntoCero).not.toHaveBeenCalled();
  });

  it('disables "Siguiente" when a stock amount is invalid (negative)', async () => {
    renderWithProviders(<PuntoCeroPage />);

    await screen.findByText('Stock inicial');
    fireEvent.change(screen.getByLabelText('Blanco Chico'), { target: { value: '-5' } });

    const next = screen.getByRole('button', { name: /Siguiente/ }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });
});