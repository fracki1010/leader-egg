import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { ProductDetailPage } from '../ProductDetailPage.tsx';
import type { InventoryItem, Product, StockTransaction } from '../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { productsApiMock, inventoryApiMock } = vi.hoisted(() => ({
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
}));

vi.mock('../../api/products.ts', () => ({ productsApi: productsApiMock }));
vi.mock('../../api/inventory.ts', () => ({ inventoryApi: inventoryApiMock }));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const product: Product = {
  _id: 'p1',
  variety: 'blanco',
  caliber: 'grande',
  displayName: 'Blanco Grande',
  eggsPerMaple: 30,
  maplesPerCajon: 12,
  costPrice: 100,
  lowStockThreshold: 20,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const inventory: InventoryItem = {
  _id: 'inv1',
  productId: { _id: 'p1', variety: 'blanco', caliber: 'grande', lowStockThreshold: 20 },
  quantity: 105,
  lowStockThreshold: 20,
  lastUpdated: '2026-01-01T00:00:00Z',
};

const purchaseTransaction: StockTransaction = {
  _id: 'tx-purchase',
  productId: 'p1',
  type: 'purchase',
  quantity: 5,
  purchaseId: 'pur-1',
  notes: 'Compra PUR-20261026-001 (Blanco Grande)',
  createdBy: 'admin',
  createdAt: '2026-10-26T10:00:00Z',
};

const adjustmentTransaction: StockTransaction = {
  _id: 'tx-adjustment',
  productId: 'p1',
  type: 'adjustment',
  quantity: -2,
  notes: 'Ajuste manual',
  createdBy: 'admin',
  createdAt: '2026-10-25T10:00:00Z',
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ProductDetailPage — purchase movement links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    productsApiMock.get.mockResolvedValue(product);
    productsApiMock.listPrices.mockResolvedValue([]);
    productsApiMock.getActivePrice.mockRejectedValue(new Error('no price'));
    inventoryApiMock.getByProduct.mockResolvedValue(inventory);
  });

  const renderPage = () =>
    renderWithProviders(
      <MemoryRouter initialEntries={['/products/p1']}>
        <Routes>
          <Route path="/products/:id" element={<ProductDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

  it('renders a focusable "Ver compra" link for purchase movements', async () => {
    inventoryApiMock.getTransactions.mockResolvedValue([purchaseTransaction]);

    renderPage();
    expect(await screen.findByText('Blanco Grande')).toBeDefined();

    const link = await screen.findByRole('link', { name: 'Ver compra' });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/compras/pur-1');
  });

  it('keeps non-purchase movements as plain text with no purchase link', async () => {
    inventoryApiMock.getTransactions.mockResolvedValue([adjustmentTransaction]);

    renderPage();
    expect(await screen.findByText('Blanco Grande')).toBeDefined();
    expect(await screen.findByText('Ajuste manual')).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Ver compra' })).toBeNull();
  });
});
