import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { PromosPage } from '../PromosPage.tsx';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { mutationMock } = vi.hoisted(() => ({
  mutationMock: { create: vi.fn(), update: vi.fn(), status: vi.fn(), del: vi.fn() },
}));

// The list is empty so the page renders immediately; we only exercise the form.
vi.mock('../../hooks/queries/index.ts', () => ({
  usePromotions: () => ({ data: [], isLoading: false, error: null }),
  useProducts: () => ({ data: [], isLoading: false, error: null }),
}));

vi.mock('../../hooks/mutations/index.ts', () => ({
  useCreatePromotion: () => ({ mutate: mutationMock.create, isPending: false }),
  useUpdatePromotion: () => ({ mutate: mutationMock.update, isPending: false }),
  useSetPromotionStatus: () => ({ mutate: mutationMock.status, isPending: false }),
  useDeletePromotion: () => ({ mutate: mutationMock.del, isPending: false }),
}));

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('PromosPage — fixed_price group pricing form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('labels the fixed_price fields for group pricing and previews the group rule', async () => {
    renderWithProviders(<PromosPage />);

    // fixed_price is the default type in the create dialog.
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva Promo' }));

    expect(await screen.findByLabelText('Precio del grupo')).toBeDefined();
    expect(screen.getByLabelText('Cada (cantidad de unidades)')).toBeDefined();
    // The old per-unit label must be gone.
    expect(screen.queryByLabelText('Precio promocional')).toBeNull();

    // Before any value is typed the preview asks for the group price.
    const preview = screen.getByTestId('fixed-price-preview');
    expect(within(preview).getByText(/precio del grupo para ver el ejemplo/i)).toBeDefined();

    // Typing "3 x 16000" derives the Spanish worked example live.
    fireEvent.change(screen.getByLabelText('Precio del grupo'), { target: { value: '16000' } });
    fireEvent.change(screen.getByLabelText('Cada (cantidad de unidades)'), { target: { value: '3' } });

    expect(within(preview).getByText(/Cada 3 unidades/)).toBeDefined();
    expect(within(preview).getByText(/Si llevás 4, pagás/)).toBeDefined();
    expect(within(preview).getByText(/1 unidad al precio normal/)).toBeDefined();
  });
});
