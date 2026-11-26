import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { UsersPage } from '../UsersPage.tsx';
import type { AppUser } from '../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { usersApiMock } = vi.hoisted(() => ({
  usersApiMock: {
    list: vi.fn(),
    listDrivers: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    setWhatsappPhone: vi.fn(),
  },
}));

vi.mock('../../api/users.ts', () => ({ usersApi: usersApiMock }));

vi.mock('../../stores/authStore.ts', () => ({
  useAuthStore: () => ({ user: { _id: 'admin-1', name: 'Admin' }, refreshSession: vi.fn() }),
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const admin: AppUser = {
  _id: 'admin-1',
  name: 'Admin',
  email: 'admin@test.com',
  role: 'admin',
  permissions: [],
  createdAt: '2026-01-01T00:00:00Z',
  whatsappPhone: null,
};

const driver: AppUser = {
  _id: 'driver-1',
  name: 'Beto',
  email: 'beto@test.com',
  role: 'driver',
  permissions: [],
  createdAt: '2026-01-02T00:00:00Z',
  whatsappPhone: '542622517447',
};

const renderPage = () =>
  renderWithProviders(
    <MemoryRouter>
      <UsersPage />
    </MemoryRouter>
  );

/** Opens the "Editar rol" dialog for the given user's card. */
const openEditFor = async (name: string) => {
  // Climb from the name to the nearest card that holds exactly one "Editar" action.
  let node: HTMLElement | null = await screen.findByText(name);
  while (node && node.parentElement) {
    const editButtons = within(node).queryAllByRole('button', { name: /^Editar$/ });
    const editButton = editButtons.length === 1 ? editButtons[0] : undefined;
    if (editButton) {
      fireEvent.click(editButton);
      return screen.findByRole('dialog', { name: /Editar rol/ });
    }
    node = node.parentElement;
  }
  throw new Error(`No edit action found for ${name}`);
};

describe('UsersPage — WhatsApp number on the edit dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usersApiMock.list.mockResolvedValue([admin, driver]);
    usersApiMock.listDrivers.mockResolvedValue([]);
    usersApiMock.update.mockResolvedValue({ user: driver });
    usersApiMock.setWhatsappPhone.mockResolvedValue({ phone: '542622500001' });
  });

  it('shows the linked number in the edit dialog', async () => {
    renderPage();

    const dialog = await openEditFor('Beto');

    expect((within(dialog).getByLabelText(/Número de WhatsApp/) as HTMLInputElement).value).toBe('542622517447');
  });

  it('saves a changed number through the whatsapp-phone endpoint', async () => {
    renderPage();
    const dialog = await openEditFor('Beto');

    const field = within(dialog).getByLabelText(/Número de WhatsApp/);
    fireEvent.change(field, { target: { value: '+54 9 2622 500001' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Guardar/ }));

    await waitFor(() =>
      expect(usersApiMock.setWhatsappPhone).toHaveBeenCalledWith('driver-1', '+54 9 2622 500001')
    );
  });

  it('clears the link when the field is emptied', async () => {
    renderPage();
    const dialog = await openEditFor('Beto');

    fireEvent.change(within(dialog).getByLabelText(/Número de WhatsApp/), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Guardar/ }));

    await waitFor(() => expect(usersApiMock.setWhatsappPhone).toHaveBeenCalledWith('driver-1', null));
  });

  it('does not call the endpoint when the number is unchanged', async () => {
    renderPage();
    const dialog = await openEditFor('Beto');

    fireEvent.click(within(dialog).getByRole('button', { name: /Guardar/ }));

    await waitFor(() => expect(usersApiMock.update).toHaveBeenCalled());
    expect(usersApiMock.setWhatsappPhone).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and shows the server message when the number is taken', async () => {
    usersApiMock.setWhatsappPhone.mockRejectedValue(
      new Error('Ese número ya está vinculado a otro usuario del negocio')
    );
    renderPage();
    const dialog = await openEditFor('Beto');

    fireEvent.change(within(dialog).getByLabelText(/Número de WhatsApp/), {
      target: { value: '+54 9 2622 500001' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Guardar/ }));

    expect(await within(dialog).findByText(/ya está vinculado a otro usuario/)).toBeTruthy();
    expect(screen.getByRole('dialog', { name: /Editar rol/ })).toBeTruthy();
  });
});
