import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import { useAgentChat } from '../hooks/queries/index.ts';
import {
  useCancelAgentAction,
  useClearAgentChat,
  useConfirmAgentAction,
  useSendAgentMessage,
} from '../hooks/mutations/index.ts';
import { ApiError } from '../api/client.ts';
import {
  MuiButton,
  MuiDialog,
  MuiSnackbar,
  MuiTextField,
  PageHeader,
} from '../components/ui/index.ts';
import { AgentActionCard } from '../components/agent/AgentActionCard.tsx';
import {
  IconArrowForward,
  IconInfo,
  IconSparkles,
} from '../components/ui/icons.tsx';
import { m3Shape } from '../theme/index.ts';
import type {
  AgentAction,
  AgentActionType,
  AgentChatMessage,
  AgentToolCallSummary,
} from '../types/index.ts';

/* ── Copy ───────────────────────────────────── */

const SUGGESTED_PROMPTS = [
  '¿Cómo viene el día?',
  '¿Qué stock está bajo?',
  '¿Quién me debe más?',
  'Ventas de esta semana',
];

/** Human labels for the read-only tools the assistant can call. */
const TOOL_LABELS: Record<string, string> = {
  get_dashboard_overview: 'Consultó el resumen',
  get_sales_report: 'Consultó ventas',
  get_profit_report: 'Consultó ganancias',
  get_receivables: 'Consultó deudas',
  list_orders: 'Consultó pedidos',
  get_order: 'Consultó un pedido',
  list_stock: 'Consultó stock',
  find_customers: 'Consultó clientes',
  get_customer_account: 'Consultó una cuenta',
  get_company_accounts: 'Consultó cuentas',
  prepare_order: 'Preparó pedido',
  prepare_payment: 'Preparó pago',
  prepare_customer: 'Preparó cliente',
  prepare_order_status: 'Preparó cambio de estado',
};

const NOT_CONFIGURED_COPY =
  'El asistente todavía no está configurado. Un administrador tiene que cargar la clave de IA.';

/** Dialog title per action kind. */
const CONFIRM_TITLES: Record<AgentActionType, string> = {
  create_order: '¿Confirmar pedido?',
  register_payment: '¿Confirmar pago?',
  create_customer: '¿Confirmar cliente?',
  change_order_status: '¿Cambiar el estado del pedido?',
};

/* ── Helpers ────────────────────────────────── */

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? 'Consultó datos';
}

/** `dd/mm HH:mm` in the user's local timezone. */
function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function resolveSendError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return 'Alcanzaste el límite de consultas por hora. Probá de nuevo en un rato.';
    }
    if (error.status === 503) {
      return 'El asistente no está disponible en este momento.';
    }
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'Necesitás conexión para usar el asistente.';
  }
  if (error instanceof TypeError) {
    return 'Necesitás conexión para usar el asistente.';
  }
  return 'No se pudo enviar el mensaje. Probá de nuevo.';
}

/** Action errors are user-facing Spanish from the API — show them untouched. */
function resolveActionError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'No se pudo completar la acción.';
}

/* ── Message pieces ─────────────────────────── */

function ToolCallChip({ call }: { call: AgentToolCallSummary }) {
  const denied = !call.ok;
  const label = denied ? `${toolLabel(call.name)} · sin permiso` : toolLabel(call.name);

  return (
    <Box
      component="span"
      title={call.summary}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        maxWidth: '100%',
        minWidth: 0,
        px: 1,
        py: 0.25,
        borderRadius: m3Shape.full,
        bgcolor: denied ? 'errorContainer' : 'surfaceContainerHighest',
        color: denied ? 'onErrorContainer' : 'onSurfaceVariant',
        fontSize: '0.6875rem',
        fontWeight: 600,
        lineHeight: 1.5,
      }}
    >
      <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </Box>
    </Box>
  );
}

function MessageBubble({
  message,
  actions,
}: {
  message: AgentChatMessage;
  actions?: ReactNode;
}) {
  const isUser = message.role === 'user';

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        minWidth: 0,
        maxWidth: '100%',
      }}
    >
      <Box
        sx={{
          maxWidth: { xs: '90%', sm: '78%' },
          minWidth: 0,
          px: 1.75,
          py: 1.25,
          borderRadius: '18px',
          borderTopRightRadius: isUser ? '6px' : '18px',
          borderTopLeftRadius: isUser ? '18px' : '6px',
          bgcolor: isUser ? 'primaryContainer' : 'surfaceContainerHigh',
          color: isUser ? 'onPrimaryContainer' : 'onSurface',
          fontSize: '0.9375rem',
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
        }}
      >
        {message.content}
      </Box>

      {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0.75,
            mt: 0.75,
            maxWidth: '100%',
            minWidth: 0,
          }}
        >
          {message.toolCalls.map((call, index) => (
            <ToolCallChip key={`${call.name}-${index}`} call={call} />
          ))}
        </Box>
      )}

      {actions && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            mt: 1,
            width: '100%',
            maxWidth: { xs: '90%', sm: '78%' },
            minWidth: 0,
          }}
        >
          {actions}
        </Box>
      )}

      <Typography
        component="div"
        variant="caption"
        color="onSurfaceVariant"
        sx={{ mt: 0.5, fontSize: '0.6875rem', lineHeight: 1.4 }}
      >
        {formatTimestamp(message.createdAt)}
      </Typography>
    </Box>
  );
}

function PendingBubble() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 1,
          px: 1.75,
          py: 1.25,
          borderRadius: '18px',
          borderTopLeftRadius: '6px',
          bgcolor: 'surfaceContainerHigh',
          color: 'onSurfaceVariant',
        }}
      >
        <CircularProgress size={14} thickness={5} />
        <Typography component="span" variant="body2">
          Pensando…
        </Typography>
      </Box>
    </Box>
  );
}

/* ── Page ───────────────────────────────────── */

export function AssistantPage() {
  const chat = useAgentChat();
  const send = useSendAgentMessage();
  const clear = useClearAgentChat();
  const confirmAction = useConfirmAgentAction();
  const cancelAction = useCancelAgentAction();

  const [input, setInput] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [actionToConfirm, setActionToConfirm] = useState<AgentAction | null>(null);
  const [actionToCancel, setActionToCancel] = useState<AgentAction | null>(null);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error';
  }>({ open: false, message: '', severity: 'success' });

  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages = chat.data?.messages ?? [];
  const actions = chat.data?.actions ?? [];
  const enabled = chat.data?.enabled ?? true;
  const sending = send.isPending;
  const clearing = clear.isPending;
  const composerDisabled = !enabled || chat.isLoading || sending || clearing;
  const canSend = !composerDisabled && input.trim().length > 0;

  const confirmingId = confirmAction.isPending ? (confirmAction.variables ?? null) : null;
  const cancellingId = cancelAction.isPending ? (cancelAction.variables ?? null) : null;

  // Group actions by the assistant message that proposed them. Actions whose
  // message is outside the 50-message window are still rendered in a fallback
  // group so pending work is never dropped silently.
  const actionsByMessageId = new Map<string, AgentAction[]>();
  const assistantMessageIds = new Set<string>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    if (message.id) assistantMessageIds.add(message.id);
    if (message._id) assistantMessageIds.add(message._id);
  }
  for (const action of actions) {
    const list = actionsByMessageId.get(action.messageId);
    if (list) {
      list.push(action);
    } else {
      actionsByMessageId.set(action.messageId, [action]);
    }
  }
  const orphanActions = actions.filter(
    (action) => !assistantMessageIds.has(action.messageId),
  );

  const actionsForMessage = (message: AgentChatMessage): AgentAction[] => {
    if (message.role !== 'assistant') return [];
    const ids = [message.id, message._id].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    const result: AgentAction[] = [];
    for (const id of ids) {
      const list = actionsByMessageId.get(id);
      if (list) result.push(...list);
    }
    return result;
  };

  const openConfirmDialog = (action: AgentAction) => {
    if (confirmAction.isPending) return;
    setActionToConfirm(action);
  };

  const openCancelDialog = (action: AgentAction) => {
    if (cancelAction.isPending) return;
    setActionToCancel(action);
  };

  const runConfirmAction = () => {
    if (!actionToConfirm || confirmAction.isPending) return;

    confirmAction.mutate(actionToConfirm.id, {
      onSuccess: (data) => {
        setActionToConfirm(null);
        setSnackbar({
          open: true,
          severity: 'success',
          message: data.action.resultSummary ?? 'Acción confirmada',
        });
      },
      onError: (error) => {
        // 409/410/403 mean the server state moved on — refetch so the card
        // stops showing a stale "pending" gate.
        setActionToConfirm(null);
        setSnackbar({
          open: true,
          severity: 'error',
          message: resolveActionError(error),
        });
        void chat.refetch();
      },
    });
  };

  const runCancelAction = () => {
    if (!actionToCancel || cancelAction.isPending) return;

    cancelAction.mutate(actionToCancel.id, {
      onSuccess: () => {
        setActionToCancel(null);
        setSnackbar({ open: true, severity: 'success', message: 'Acción descartada' });
      },
      onError: (error) => {
        setActionToCancel(null);
        setSnackbar({
          open: true,
          severity: 'error',
          message: resolveActionError(error),
        });
        void chat.refetch();
      },
    });
  };

  const renderActionCard = (action: AgentAction) => (
    <AgentActionCard
      key={action.id}
      action={action}
      onConfirm={openConfirmDialog}
      onCancel={openCancelDialog}
      confirming={confirmingId === action.id}
      cancelling={cancellingId === action.id}
    />
  );

  // Keep the newest turn in view as the transcript grows (and while "thinking").
  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
    bottomRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, actions.length, sending]);

  const submit = (raw: string) => {
    const message = raw.trim();
    if (!message || composerDisabled) return;

    setInput('');
    setErrorMessage(null);
    send.mutate(message, {
      onError: (error) => setErrorMessage(resolveSendError(error)),
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit(input);
    }
  };

  const handleSuggestion = (suggestion: string) => {
    submit(suggestion);
  };

  const handleClear = () => {
    clear.mutate(undefined, {
      onSuccess: () => {
        setConfirmClearOpen(false);
        setErrorMessage(null);
      },
      onError: (error) => {
        setConfirmClearOpen(false);
        setErrorMessage(resolveSendError(error));
      },
    });
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        maxHeight: { xs: 'calc(100dvh - 150px)', md: 'calc(100dvh - 64px)' },
        minHeight: 0,
        minWidth: 0,
        maxWidth: 900,
        mx: 'auto',
      }}
    >
      <PageHeader
        title="Asistente"
        subtitle="Consultá ventas, stock, clientes y cuentas"
        icon={<IconSparkles size={24} />}
        actions={
          messages.length > 0 ? (
            <MuiButton
              variant="secondary"
              size="sm"
              onClick={() => setConfirmClearOpen(true)}
              sx={{ borderRadius: m3Shape.full, whiteSpace: 'nowrap' }}
            >
              Nueva conversación
            </MuiButton>
          ) : undefined
        }
      />

      {chat.data && !chat.data.enabled && (
        <Box
          role="status"
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 1.5,
            p: 2,
            mb: 2,
            minWidth: 0,
            borderRadius: '16px',
            bgcolor: 'surfaceContainerHigh',
            border: 1,
            borderColor: 'outlineVariant',
          }}
        >
          <Box aria-hidden="true" sx={{ display: 'flex', color: 'onSurfaceVariant', mt: '2px', flexShrink: 0 }}>
            <IconInfo size={20} />
          </Box>
          <Typography component="p" variant="body2" color="onSurface" sx={{ m: 0, lineHeight: 1.5, minWidth: 0 }}>
            {NOT_CONFIGURED_COPY}
          </Typography>
        </Box>
      )}

      {/* Transcript — owns the scroll so the composer stays pinned. */}
      <Box
        ref={listRef}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          py: 1,
          pr: 0.5,
        }}
      >
        {chat.isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 6 }}>
            <CircularProgress size={32} />
          </Box>
        )}

        {chat.error && !chat.data && !chat.isLoading && (
          <Alert
            severity="error"
            action={
              <MuiButton variant="ghost" size="sm" onClick={() => void chat.refetch()}>
                Reintentar
              </MuiButton>
            }
          >
            No se pudo cargar la conversación.
          </Alert>
        )}

        {!chat.isLoading && messages.length === 0 && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              gap: 1,
              py: { xs: 4, sm: 6 },
              px: 1,
              minWidth: 0,
            }}
          >
            <Box
              aria-hidden="true"
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 72,
                height: 72,
                borderRadius: '50%',
                bgcolor: 'primaryContainer',
                color: 'onPrimaryContainer',
                mb: 1,
                flexShrink: 0,
              }}
            >
              <IconSparkles size={32} />
            </Box>
            <Typography component="h2" variant="titleMedium" sx={{ fontWeight: 700, color: 'onSurface' }}>
              ¿En qué te puedo ayudar?
            </Typography>
            <Typography component="p" variant="body2" color="onSurfaceVariant" sx={{ maxWidth: 420, m: 0 }}>
              Preguntame por las ventas, el stock, los clientes o las cuentas de la empresa.
            </Typography>

            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: 1,
                mt: 2,
                maxWidth: '100%',
                minWidth: 0,
              }}
            >
              {SUGGESTED_PROMPTS.map((prompt) => (
                <Box
                  key={prompt}
                  component="button"
                  type="button"
                  onClick={() => handleSuggestion(prompt)}
                  disabled={composerDisabled}
                  sx={{
                    maxWidth: '100%',
                    minHeight: 36,
                    px: 1.5,
                    py: 0.75,
                    borderRadius: m3Shape.full,
                    border: 1,
                    borderColor: 'outlineVariant',
                    bgcolor: 'surfaceContainerHigh',
                    color: 'onSurface',
                    font: 'inherit',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    lineHeight: 1.4,
                    cursor: composerDisabled ? 'not-allowed' : 'pointer',
                    opacity: composerDisabled ? 0.5 : 1,
                    whiteSpace: 'normal',
                    textAlign: 'left',
                    overflowWrap: 'anywhere',
                    '&:hover': composerDisabled ? undefined : { bgcolor: 'surfaceContainerHighest' },
                    '&:focus-visible': {
                      outline: '2px solid',
                      outlineColor: 'primary.main',
                      outlineOffset: 2,
                    },
                  }}
                >
                  {prompt}
                </Box>
              ))}
            </Box>
          </Box>
        )}

        {messages.map((message, index) => {
          const messageActions = actionsForMessage(message);
          return (
            <MessageBubble
              key={message.id ?? message._id ?? `${message.role}-${index}`}
              message={message}
              actions={
                messageActions.length > 0
                  ? messageActions.map((action) => renderActionCard(action))
                  : undefined
              }
            />
          );
        })}

        {orphanActions.length > 0 && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              minWidth: 0,
              maxWidth: '100%',
            }}
          >
            <Typography
              component="h2"
              variant="titleSmall"
              sx={{ fontWeight: 700, color: 'onSurface', m: 0 }}
            >
              Acciones pendientes
            </Typography>
            {orphanActions.map((action) => renderActionCard(action))}
          </Box>
        )}

        {sending && <PendingBubble />}

        <Box ref={bottomRef} sx={{ height: '1px', flexShrink: 0 }} />
      </Box>

      {/* Composer — pinned to the bottom of the page area, above the mobile nav. */}
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          submit(input);
        }}
        sx={{
          flexShrink: 0,
          pt: 1.5,
          pb: { xs: 1, md: 0.5 },
          mt: 1,
          borderTop: 1,
          borderColor: 'outlineVariant',
          bgcolor: 'background.default',
          minWidth: 0,
        }}
      >
        {errorMessage && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {errorMessage}
          </Alert>
        )}

        <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, minWidth: 0 }}>
          <MuiTextField
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={enabled ? 'Escribí tu consulta…' : 'El asistente no está disponible'}
            multiline
            rows={2}
            disabled={composerDisabled}
            sx={{ flex: 1, minWidth: 0 }}
            slotProps={{
              htmlInput: {
                maxLength: 2000,
                'aria-label': 'Mensaje para el asistente',
                onKeyDown: handleKeyDown,
              },
            }}
          />

          <IconButton
            type="submit"
            aria-label="Enviar mensaje"
            disabled={!canSend}
            sx={{
              flexShrink: 0,
              width: 48,
              height: 48,
              mb: 0.25,
              borderRadius: m3Shape.full,
              bgcolor: 'primary.main',
              color: 'onPrimary',
              '&:hover': { bgcolor: 'primary.dark' },
              '&.Mui-disabled': { bgcolor: 'surfaceContainerHighest', color: 'onSurfaceVariant' },
            }}
          >
            {sending ? <CircularProgress size={20} color="inherit" /> : <IconArrowForward size={22} />}
          </IconButton>
        </Box>
      </Box>

      <MuiDialog
        open={confirmClearOpen}
        onClose={() => setConfirmClearOpen(false)}
        title="Nueva conversación"
        actions={
          <>
            <MuiButton variant="ghost" onClick={() => setConfirmClearOpen(false)}>
              Cancelar
            </MuiButton>
            <MuiButton
              variant="danger"
              onClick={handleClear}
              isLoading={clearing}
              disabled={clearing}
            >
              Borrar conversación
            </MuiButton>
          </>
        }
      >
        <Typography component="p" variant="body2" color="onSurfaceVariant" sx={{ m: 0 }}>
          Se va a borrar todo el historial de esta conversación. Esta acción no se puede deshacer.
        </Typography>
      </MuiDialog>

      {/* Human gate — the action only runs after this explicit confirmation. */}
      <MuiDialog
        open={actionToConfirm !== null}
        onClose={() => {
          if (!confirmAction.isPending) setActionToConfirm(null);
        }}
        title={
          actionToConfirm ? CONFIRM_TITLES[actionToConfirm.type] : '¿Confirmar acción?'
        }
        maxWidth="xs"
        actions={
          <>
            <MuiButton
              variant="ghost"
              onClick={() => setActionToConfirm(null)}
              disabled={confirmAction.isPending}
            >
              Cancelar
            </MuiButton>
            <MuiButton
              variant="primary"
              onClick={runConfirmAction}
              isLoading={confirmAction.isPending}
              disabled={confirmAction.isPending}
            >
              Confirmar
            </MuiButton>
          </>
        }
      >
        {actionToConfirm && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}>
            <Typography
              component="p"
              variant="body2"
              sx={{ m: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
            >
              {actionToConfirm.preview}
            </Typography>
            {actionToConfirm.type === 'register_payment' && (
              <Alert severity="warning">
                Se va a registrar un pago real. Revisá el monto y el pedido.
              </Alert>
            )}
            {actionToConfirm?.type === 'change_order_status' && (
              <Alert severity="warning">
                Se va a cambiar el estado del pedido. Si es una entrega, se descuenta stock del inventario.
              </Alert>
            )}
          </Box>
        )}
      </MuiDialog>

      <MuiDialog
        open={actionToCancel !== null}
        onClose={() => {
          if (!cancelAction.isPending) setActionToCancel(null);
        }}
        title="¿Descartar esta acción?"
        maxWidth="xs"
        actions={
          <>
            <MuiButton
              variant="ghost"
              onClick={() => setActionToCancel(null)}
              disabled={cancelAction.isPending}
            >
              Volver
            </MuiButton>
            <MuiButton
              variant="danger"
              onClick={runCancelAction}
              isLoading={cancelAction.isPending}
              disabled={cancelAction.isPending}
            >
              Descartar
            </MuiButton>
          </>
        }
      >
        <Typography component="p" variant="body2" color="onSurfaceVariant" sx={{ m: 0 }}>
          La acción no se va a ejecutar. Podés volver a pedírsela al asistente cuando quieras.
        </Typography>
      </MuiDialog>

      <MuiSnackbar
        open={snackbar.open}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        message={snackbar.message}
        severity={snackbar.severity}
      />
    </Box>
  );
}
