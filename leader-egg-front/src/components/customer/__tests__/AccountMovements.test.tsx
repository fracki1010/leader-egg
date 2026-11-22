import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-with-providers.tsx';
import { AccountMovements } from '../AccountMovements.tsx';
import type { AccountMovement } from '../../../api/accounts.ts';
import type { Order } from '../../../types/index.ts';

const movements: AccountMovement[] = [
  {
    type: 'charge',
    id: 'c1',
    date: '2026-10-16T10:00:00.000Z',
    description: 'Deuda manual',
    amount: 5000,
    sign: '+',
  },
  {
    type: 'payment',
    id: 'p1',
    date: '2026-10-17T10:00:00.000Z',
    description: 'Pago en efectivo',
    amount: 3000,
    sign: '-',
    method: 'cash',
  },
];

const openOrder = {
  _id: 'ord-1',
  orderNumber: 'ORD-001',
  createdAt: '2026-10-10T10:00:00.000Z',
  balance: 8000,
  totalAmount: 8000,
} as unknown as Order;

describe('AccountMovements', () => {
  it('starts collapsed and expands to show the ledger rows and open orders', () => {
    renderWithProviders(
      <AccountMovements movements={movements} orders={[openOrder]} ordersTotal={1} />,
    );

    const toggle = screen.getByRole('button', { name: /Movimientos de la cuenta/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('2 movimientos · 1 orden abierta')).toBeDefined();
    expect(screen.queryByText('Deuda manual')).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Deuda manual')).toBeDefined();
    expect(screen.getByText('Pago en efectivo')).toBeDefined();
    expect(screen.getByText(/5\.000,00/)).toBeDefined();
    expect(screen.getByText(/3\.000,00/)).toBeDefined();
    expect(screen.getByText('Órdenes abiertas')).toBeDefined();
    expect(screen.getByText('#ORD-001')).toBeDefined();
  });

  it('shows the ledger and open-orders empty states', () => {
    renderWithProviders(<AccountMovements movements={[]} orders={[]} ordersTotal={0} />);

    fireEvent.click(screen.getByRole('button', { name: /Movimientos de la cuenta/i }));

    expect(screen.getByText('Sin movimientos')).toBeDefined();
    expect(screen.getByText('Sin órdenes pendientes de pago')).toBeDefined();
  });

  it('notifies the caller when an open order is clicked', () => {
    const onOrderClick = vi.fn();
    renderWithProviders(
      <AccountMovements movements={[]} orders={[openOrder]} ordersTotal={1} onOrderClick={onOrderClick} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Movimientos de la cuenta/i }));
    fireEvent.click(screen.getByText('#ORD-001'));

    expect(onOrderClick).toHaveBeenCalledWith('ord-1');
  });
});
