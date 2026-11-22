import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { ProductDetailPage } from '../ProductDetailPage.tsx';
import type { InventoryItem, PriceEntry, Product } from '../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { productsApiMock, inventoryApiMock, navigateMock } = vi.hoisted(() => ({
  productsApiMock: {
    get: vi.fn(),
    listPrices: vi.fn(),
    getActivePrice: vi.fn(),
    createPrice: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
  },
  inventoryApiMock: {
    getByProduct: vi.fn(),
    getTransactions: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
    adjustStock: vi.fn(),
    incrementStock: vi.fn(),
    decrementStock: vi.fn(),
    classify: vi.fn(),
    updateThreshold: vi.fn(),
  },
  navigateMock: vi.fn(),
}));

vi.mock('../../api/products.ts', () => ({ productsApi: productsApiMock }));
vi.mock('../../api/inventory.ts', () => ({ inventoryApi: inventoryApiMock }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'p1' }),
  useNavigate: () => navigateMock,
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const product: Product = {
  _id: 'p1',
  variety: 'blanco',
  caliber: 'grande',
  displayName: 'Blanco Grande',
  eggsPerMaple: 30,
  maplesPerCajon: 12,
  costPrice: 4416.67,
  lowStockThreshold: 20,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const inventory: InventoryItem = {
  _id: 'inv1',
  productId: { _id: 'p1', variety: 'blanco', caliber: 'grande', lowStockThreshold: 20 },
  quantity: 5,
  lowStockThreshold: 20,
  lastUpdated: '2026-01-01T00:00:00Z',
};

const cajonPrice: PriceEntry = {
  _id: 'pc',
  productId: 'p1',
  price: 63000,
  unit: 'cajon',
  effectiveFrom: '2026-01-01T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ProductDetailPage — Ganancia section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    productsApiMock.get.mockResolvedValue(product);
    productsApiMock.listPrices.mockResolvedValue([]);
    inventoryApiMock.getByProduct.mockResolvedValue(inventory);
    inventoryApiMock.getTransactions.mockResolvedValue([]);
    // Only the cajón unit has an active price.
    productsApiMock.getActivePrice.mockImplementation((_id: string, unit?: string) =>
      unit === 'cajon' ? Promise.resolve(cajonPrice) : Promise.reject(new Error('no price')),
    );
  });

  it("renders the correct $ and % margin for a unit with an active price and cost", async () => {
    renderWithProviders(<ProductDetailPage />);

    expect(await screen.findByText('Blanco Grande')).toBeDefined();

    // Section heading renders.
    expect(screen.getAllByText('Ganancia').length).toBeGreaterThan(0);

    // cost 4416.67 × 12 = 53000.04 → cajón margin 63000 − 53000.04 = 9999.96 (15,9 %)
    expect((await screen.findAllByText('$ 63.000,00')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('$ 53.000,04')).toBeDefined();
    expect(screen.getByText('$ 9.999,96')).toBeDefined();
    expect(screen.getByText('15,9 %')).toBeDefined();
  });

  it('shows "sin costo" and no numeric margin when the cost is missing', async () => {
    productsApiMock.get.mockResolvedValue({ ...product, costPrice: null });
    renderWithProviders(<ProductDetailPage />);

    expect(await screen.findByText('Blanco Grande')).toBeDefined();

    expect((await screen.findAllByText(/sin costo/i)).length).toBeGreaterThan(0);
    expect(screen.getByText('Cargá un costo para ver la ganancia.')).toBeDefined();
    // No fake numeric margin is rendered.
    expect(screen.queryByText('$ 9.999,96')).toBeNull();
    expect(screen.queryByText('15,9 %')).toBeNull();
  });

  it('shows an empty state with a price CTA when there is no active price', async () => {
    productsApiMock.getActivePrice.mockRejectedValue(new Error('no price'));
    renderWithProviders(<ProductDetailPage />);

    expect(await screen.findByText('Blanco Grande')).toBeDefined();
    expect(await screen.findByText('Cargar precio')).toBeDefined();
  });

  it('opens the help dialog explaining the weighted average cost', async () => {
    renderWithProviders(<ProductDetailPage />);

    expect(await screen.findByText('Blanco Grande')).toBeDefined();
    fireEvent.click(await screen.findByRole('button', { name: '¿Cómo se calcula?' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/promedio ponderado/)).toBeDefined();
    expect(within(dialog).getByText(/4\.583,34/)).toBeDefined();
  });
});
