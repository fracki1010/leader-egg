import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../../test/render-with-providers.tsx';
import { AgentActionCard } from '../AgentActionCard.tsx';
import type { AgentAction } from '../../../types/index.ts';

/* ── Fixtures ──────────────────────────────── */

const baseAction = (overrides: Partial<AgentAction> = {}): AgentAction => ({
  id: 'a1',
  messageId: 'm1',
  type: 'create_order',
  preview: '2 maples de huevos para Juana',
  status: 'pending',
  createdAt: '2026-03-10T14:00:00.000Z',
  expiresAt: '2026-03-10T14:15:00.000Z',
  ...overrides,
});

function renderCard(action: AgentAction) {
  const onConfirm = vi.fn<(next: AgentAction) => void>();
  const onCancel = vi.fn<(next: AgentAction) => void>();

  renderWithProviders(
    <MemoryRouter>
      <AgentActionCard action={action} onConfirm={onConfirm} onCancel={onCancel} />
    </MemoryRouter>,
  );

  return { onConfirm, onCancel };
}

/* ── Tests ─────────────────────────────────── */

describe('AgentActionCard', () => {
  it('renders the pending order preview and calls the handlers', () => {
    const { onConfirm, onCancel } = renderCard(baseAction());

    expect(screen.getByText('Pedido')).toBeDefined();
    expect(screen.getByText('2 maples de huevos para Juana')).toBeDefined();
    expect(screen.getByText(/Requiere tu confirmación/)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]?.[0]).toMatchObject({ id: 'a1', status: 'pending' });

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel.mock.calls[0]?.[0]).toMatchObject({ id: 'a1', status: 'pending' });
  });

  it('renders the order-status action with its own label', () => {
    renderCard(
      baseAction({
        type: 'change_order_status',
        preview: 'Cambiar el pedido ORD-1 de Pendiente a En tránsito.',
      }),
    );

    expect(screen.getByText('Estado del pedido')).toBeDefined();
    expect(screen.getByText(/En tránsito/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDefined();
  });

  it('renders the result summary and the order link when confirmed', () => {
    renderCard(
      baseAction({
        status: 'confirmed',
        resultSummary: 'Pedido #42 creado',
        resultRef: { entity: 'order', id: '42', label: 'Ver pedido #42' },
      }),
    );

    expect(screen.getByText('Pedido #42 creado')).toBeDefined();

    const link = screen.getByRole('link', { name: 'Ver pedido #42' });
    expect(link.getAttribute('href')).toBe('/orders/42');
    expect(screen.queryByRole('button', { name: 'Confirmar' })).toBeNull();
  });

  it('renders the customer link when confirmed and no link for payments', () => {
    const { unmount } = renderWithProviders(
      <MemoryRouter>
        <AgentActionCard
          action={baseAction({
            status: 'confirmed',
            resultSummary: 'Cliente creado',
            resultRef: { entity: 'customer', id: 'c9' },
          })}
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: 'Ver cliente' });
    expect(link.getAttribute('href')).toBe('/customers/c9');

    unmount();

    renderWithProviders(
      <MemoryRouter>
        <AgentActionCard
          action={baseAction({
            type: 'register_payment',
            status: 'confirmed',
            resultSummary: 'Pago registrado',
            resultRef: { entity: 'payment', id: 'p7', label: 'Pago de $5.000' },
          })}
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Pago de $5.000')).toBeDefined();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders the error copy when failed', () => {
    renderCard(
      baseAction({
        status: 'failed',
        error: 'No hay stock suficiente para ese pedido.',
      }),
    );

    expect(screen.getByText('No hay stock suficiente para ese pedido.')).toBeDefined();
    expect(screen.getByText('Falló')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Confirmar' })).toBeNull();
  });

  it('renders the expired copy when it timed out', () => {
    renderCard(baseAction({ status: 'expired' }));

    expect(screen.getByText('Venció')).toBeDefined();
    expect(
      screen.getByText('Esta acción venció. Volvé a pedírsela al asistente si todavía la necesitás.'),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Confirmar' })).toBeNull();
  });
});
