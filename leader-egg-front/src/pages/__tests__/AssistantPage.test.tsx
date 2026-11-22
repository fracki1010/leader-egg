import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { AssistantPage } from '../AssistantPage.tsx';
import { ApiError } from '../../api/client.ts';
import type {
  AgentAction,
  AgentChatMessage,
  AgentChatState,
} from '../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { agentApiMock } = vi.hoisted(() => ({
  agentApiMock: {
    getChat: vi.fn(),
    sendMessage: vi.fn(),
    clearChat: vi.fn(),
    confirmAction: vi.fn(),
    cancelAction: vi.fn(),
  },
}));

vi.mock('../../api/agent.ts', () => ({ agentApi: agentApiMock }));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const NOT_CONFIGURED_COPY =
  'El asistente todavía no está configurado. Un administrador tiene que cargar la clave de IA.';

const chatState = (overrides: Partial<AgentChatState> = {}): AgentChatState => ({
  enabled: true,
  messages: [],
  actions: [],
  rateLimitPerHour: 20,
  ...overrides,
});

const chatMessage = (overrides: Partial<AgentChatMessage>): AgentChatMessage => ({
  role: 'assistant',
  content: '',
  createdAt: '2026-03-10T14:15:00.000Z',
  ...overrides,
});

const agentAction = (overrides: Partial<AgentAction> = {}): AgentAction => ({
  id: 'a1',
  messageId: 'm2',
  type: 'create_order',
  preview: '2 maples de huevos para Juana',
  status: 'pending',
  createdAt: '2026-03-10T14:15:05.000Z',
  expiresAt: '2026-03-10T14:30:05.000Z',
  ...overrides,
});

const input = () => screen.getByLabelText('Mensaje para el asistente') as HTMLTextAreaElement;
const sendButton = () => screen.getByRole('button', { name: 'Enviar mensaje' }) as HTMLButtonElement;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('AssistantPage — read-only AI chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentApiMock.getChat.mockResolvedValue(chatState());
    agentApiMock.clearChat.mockResolvedValue(undefined);
    agentApiMock.confirmAction.mockReset();
    agentApiMock.cancelAction.mockReset();
  });

  it('renders the empty state and the four suggested prompts', async () => {
    renderWithProviders(<AssistantPage />);

    expect(await screen.findByText('¿En qué te puedo ayudar?')).toBeDefined();
    expect(
      screen.getByText(
        'Preguntame por las ventas, el stock, los clientes o las cuentas de la empresa.',
      ),
    ).toBeDefined();

    for (const prompt of [
      '¿Cómo viene el día?',
      '¿Qué stock está bajo?',
      '¿Quién me debe más?',
      'Ventas de esta semana',
    ]) {
      expect(screen.getByRole('button', { name: prompt })).toBeDefined();
    }
  });

  it('shows the not-configured card and disables the composer when disabled', async () => {
    agentApiMock.getChat.mockResolvedValue(chatState({ enabled: false }));

    renderWithProviders(<AssistantPage />);

    expect(await screen.findByText(NOT_CONFIGURED_COPY)).toBeDefined();
    expect(input().disabled).toBe(true);
    expect(sendButton().disabled).toBe(true);
  });

  it('renders the user message and the assistant reply after sending', async () => {
    const transcript: AgentChatMessage[] = [];
    agentApiMock.getChat.mockImplementation(async () =>
      chatState({ messages: [...transcript] }),
    );
    agentApiMock.sendMessage.mockImplementation(async (body: string) => {
      transcript.push(
        chatMessage({ role: 'user', content: body, createdAt: '2026-03-10T14:16:00.000Z' }),
      );
      transcript.push(
        chatMessage({
          role: 'assistant',
          content: 'Hoy vendiste $12.000.',
          createdAt: '2026-03-10T14:16:05.000Z',
        }),
      );
      return { reply: 'Hoy vendiste $12.000.', toolCalls: [] };
    });

    renderWithProviders(<AssistantPage />);
    expect(await screen.findByText('¿En qué te puedo ayudar?')).toBeDefined();

    fireEvent.change(input(), { target: { value: '¿Cómo viene el día?' } });
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(await screen.findByText('Hoy vendiste $12.000.')).toBeDefined();
    expect(screen.getByText('¿Cómo viene el día?')).toBeDefined();
    await waitFor(() => expect(screen.queryByText('Pensando…')).toBeNull());
  });

  it('shows the rate-limit message on a 429 error and rolls back the optimistic turn', async () => {
    agentApiMock.sendMessage.mockRejectedValue(
      new ApiError('Alcanzaste el límite de consultas por hora', 429),
    );

    renderWithProviders(<AssistantPage />);
    expect(await screen.findByText('¿En qué te puedo ayudar?')).toBeDefined();

    fireEvent.change(input(), { target: { value: 'Hola asistente' } });
    fireEvent.click(sendButton());

    expect(
      await screen.findByText(
        'Alcanzaste el límite de consultas por hora. Probá de nuevo en un rato.',
      ),
    ).toBeDefined();
    await waitFor(() => expect(screen.queryByText('Hola asistente')).toBeNull());
  });

  it('renders tool-call chips under the assistant reply', async () => {
    agentApiMock.getChat.mockResolvedValue(
      chatState({
        messages: [
          chatMessage({
            _id: 'm1',
            role: 'user',
            content: 'Ventas de hoy',
            createdAt: '2026-03-10T14:00:00.000Z',
          }),
          chatMessage({
            _id: 'm2',
            role: 'assistant',
            content: 'Vendiste $5.000.',
            createdAt: '2026-03-10T14:00:05.000Z',
            toolCalls: [
              { name: 'get_sales_report', ok: true, summary: 'Ventas del día' },
              { name: 'get_receivables', ok: false, summary: 'Sin permiso' },
            ],
          }),
        ],
      }),
    );

    renderWithProviders(<AssistantPage />);

    expect(await screen.findByText('Vendiste $5.000.')).toBeDefined();
    expect(screen.getByText('Consultó ventas')).toBeDefined();
    expect(screen.getByText('Consultó deudas · sin permiso')).toBeDefined();
  });

  it('renders a pending action card under its assistant message', async () => {
    agentApiMock.getChat.mockResolvedValue(
      chatState({
        messages: [
          chatMessage({
            id: 'm1',
            role: 'user',
            content: 'Armá un pedido',
            createdAt: '2026-03-10T14:15:00.000Z',
          }),
          chatMessage({
            id: 'm2',
            role: 'assistant',
            content: 'Preparé este pedido:',
            createdAt: '2026-03-10T14:15:05.000Z',
          }),
        ],
        actions: [agentAction()],
      }),
    );

    renderWithProviders(<AssistantPage />);

    expect(await screen.findByText('Preparé este pedido:')).toBeDefined();
    expect(screen.getByText('2 maples de huevos para Juana')).toBeDefined();
    expect(screen.getByText(/Requiere tu confirmación/)).toBeDefined();
    expect(screen.getByRole('group', { name: /Acción: Pedido/ })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDefined();
  });

  it('renders orphan actions in a fallback "Acciones pendientes" group', async () => {
    agentApiMock.getChat.mockResolvedValue(
      chatState({
        messages: [chatMessage({ id: 'm1', content: 'Listo.' })],
        actions: [
          agentAction({ messageId: 'm-old', preview: 'Un pedido que ya no está en la ventana' }),
        ],
      }),
    );

    renderWithProviders(<AssistantPage />);

    expect(await screen.findByText('Acciones pendientes')).toBeDefined();
    expect(screen.getByText('Un pedido que ya no está en la ventana')).toBeDefined();
  });

  it('confirms a pending action through the dialog and shows the result summary', async () => {
    const action = agentAction();
    agentApiMock.getChat.mockResolvedValue(
      chatState({
        messages: [chatMessage({ id: 'm2', content: 'Preparé este pedido:' })],
        actions: [action],
      }),
    );
    agentApiMock.confirmAction.mockResolvedValue({
      action: {
        ...action,
        status: 'confirmed',
        resultSummary: 'Pedido #42 creado',
        resultRef: { entity: 'order', id: '42' },
      },
    });

    renderWithProviders(<AssistantPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('¿Confirmar pedido?')).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    await waitFor(() =>
      expect(agentApiMock.confirmAction).toHaveBeenCalledWith('a1'),
    );
    expect(await screen.findByText('Pedido #42 creado')).toBeDefined();
  });

  it('shows the API message when confirm returns 409 and refreshes the chat', async () => {
    agentApiMock.getChat.mockResolvedValue(
      chatState({
        messages: [chatMessage({ id: 'm2', content: 'Preparé este pedido:' })],
        actions: [agentAction()],
      }),
    );
    agentApiMock.confirmAction.mockRejectedValue(
      new ApiError('La acción ya fue procesada', 409),
    );

    renderWithProviders(<AssistantPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByText('La acción ya fue procesada')).toBeDefined();
    await waitFor(() =>
      expect(agentApiMock.getChat.mock.calls.length).toBeGreaterThan(1),
    );
  });
});
