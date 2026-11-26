import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, act, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-with-providers.tsx';
import { whatsappApi, type WhatsappConnection } from '../../../api/whatsapp.ts';
import { ApiError } from '../../../api/client.ts';
import { WhatsappSection } from '../WhatsappSection.tsx';

vi.mock('../../../api/whatsapp.ts', () => ({
  whatsappApi: {
    getConnection: vi.fn(),
    connect: vi.fn(),
  },
}));

const getConnection = vi.mocked(whatsappApi.getConnection);
const connect = vi.mocked(whatsappApi.connect);

const connection = (overrides: Partial<WhatsappConnection>): WhatsappConnection => ({
  state: 'not_created',
  ...overrides,
} as WhatsappConnection);

describe('WhatsappSection', () => {
  beforeEach(() => {
    getConnection.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('offers the first connect action when no line exists yet', async () => {
    getConnection.mockResolvedValue(connection({ state: 'not_created' }));

    renderWithProviders(<WhatsappSection />);

    expect(await screen.findByRole('button', { name: 'Conectar WhatsApp' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Generar nuevo QR' })).toBeNull();
  });

  it('offers to connect again when a failed attempt left the line without a QR', async () => {
    getConnection.mockResolvedValue(connection({ state: 'created' }));

    renderWithProviders(<WhatsappSection />);

    expect(await screen.findByRole('button', { name: 'Conectar WhatsApp' })).toBeTruthy();
  });

  it('shows the QR code with no manual regenerate button while waiting for scan', async () => {
    getConnection.mockResolvedValue(connection({ state: 'created', qrCode: 'QR_PAYLOAD' }));

    renderWithProviders(<WhatsappSection />);

    expect(await screen.findByAltText('Código QR de WhatsApp')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Generar nuevo QR' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Conectar WhatsApp' })).toBeNull();
  });

  it('shows the line as connected with no QR and no action once open', async () => {
    getConnection.mockResolvedValue(connection({ state: 'open' }));

    renderWithProviders(<WhatsappSection />);

    expect(await screen.findByText('Conectado')).toBeTruthy();
    expect(screen.queryByAltText('Código QR de WhatsApp')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('polls for a fresh QR while not open and stops once the line is connected', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getConnection
      .mockResolvedValueOnce(connection({ state: 'created', qrCode: 'QR_1' }))
      .mockResolvedValueOnce(connection({ state: 'created', qrCode: 'QR_2' }))
      .mockResolvedValue(connection({ state: 'open' }));

    renderWithProviders(<WhatsappSection />);

    expect(await screen.findByAltText('Código QR de WhatsApp')).toBeTruthy();
    expect(getConnection).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(getConnection).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(getConnection).toHaveBeenCalledTimes(3);
    expect(await screen.findByText('Conectado')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(getConnection).toHaveBeenCalledTimes(3);
  });

  it('shows only the server message when linking is unavailable, never provider details', async () => {
    getConnection.mockResolvedValue(connection({ state: 'not_created' }));
    connect.mockRejectedValueOnce(
      new ApiError('No se puede vincular WhatsApp ahora. Probá de nuevo en unos minutos.', 503)
    );

    renderWithProviders(<WhatsappSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Conectar WhatsApp' }));

    expect(
      await screen.findByText('No se puede vincular WhatsApp ahora. Probá de nuevo en unos minutos.')
    ).toBeTruthy();
    expect(screen.queryByText(/evolution/i)).toBeNull();
    expect(screen.queryByText(/apikey|api key/i)).toBeNull();
  });

  it('offers no connect action while the connection is still loading', () => {
    getConnection.mockReturnValue(new Promise(() => {}));

    renderWithProviders(<WhatsappSection />);

    expect(screen.queryByRole('button', { name: 'Conectar WhatsApp' })).toBeNull();
  });

  it('stops polling once the admin leaves Settings', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getConnection.mockResolvedValue(connection({ state: 'created', qrCode: 'QR_1' }));

    const { unmount } = renderWithProviders(<WhatsappSection />);
    expect(await screen.findByAltText('Código QR de WhatsApp')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(getConnection.mock.calls.length).toBeGreaterThan(1);
    unmount();
    const callsAtExit = getConnection.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(getConnection).toHaveBeenCalledTimes(callsAtExit);
  });
});
