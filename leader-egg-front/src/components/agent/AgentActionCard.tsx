import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Link from '@mui/material/Link';
import { Link as RouterLink } from 'react-router-dom';
import { MuiButton } from '../ui/index.ts';
import {
  IconShoppingCart,
  IconMoney,
  IconUsers,
  IconRoute,
} from '../ui/icons.tsx';
import type {
  AgentAction,
  AgentActionStatus,
  AgentActionType,
} from '../../types/index.ts';

/* ── Metadata ───────────────────────────────── */

const TYPE_META: Record<AgentActionType, { label: string; icon: ReactNode }> = {
  create_order: { label: 'Pedido', icon: <IconShoppingCart size={18} /> },
  register_payment: { label: 'Pago', icon: <IconMoney size={18} /> },
  create_customer: { label: 'Cliente', icon: <IconUsers size={18} /> },
  change_order_status: { label: 'Estado del pedido', icon: <IconRoute size={18} /> },
};

const STATUS_LABELS: Record<AgentActionStatus, string> = {
  pending: 'Pendiente',
  executing: 'Procesando',
  confirmed: 'Confirmada',
  cancelled: 'Cancelada',
  failed: 'Falló',
  expired: 'Venció',
};

interface StatusTone {
  border: string;
  background: string;
  foreground: string;
}

/** Tonal container pairs keep the card legible in both color schemes. */
const STATUS_TONES: Record<AgentActionStatus, StatusTone> = {
  pending: {
    border: 'outline',
    background: 'surfaceContainerLowest',
    foreground: 'onSurface',
  },
  executing: {
    border: 'primary.main',
    background: 'surfaceContainerHigh',
    foreground: 'onSurface',
  },
  confirmed: {
    border: 'success.main',
    background: 'successContainer',
    foreground: 'onSuccessContainer',
  },
  failed: {
    border: 'error.main',
    background: 'errorContainer',
    foreground: 'onErrorContainer',
  },
  cancelled: {
    border: 'outlineVariant',
    background: 'surfaceContainerHigh',
    foreground: 'onSurfaceVariant',
  },
  expired: {
    border: 'outlineVariant',
    background: 'surfaceContainerHigh',
    foreground: 'onSurfaceVariant',
  },
};

/* ── Helpers ────────────────────────────────── */

const pad = (n: number) => String(n).padStart(2, '0');

/** `HH:mm` when the deadline is today, otherwise `dd/mm HH:mm`. */
function formatExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay ? time : `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${time}`;
}

function resultLink(action: AgentAction): { to: string; label: string } | null {
  const ref = action.resultRef;
  if (!ref) return null;
  if (ref.entity === 'order') {
    return { to: `/orders/${ref.id}`, label: ref.label ?? 'Ver pedido' };
  }
  if (ref.entity === 'customer') {
    return { to: `/customers/${ref.id}`, label: ref.label ?? 'Ver cliente' };
  }
  return null;
}

/* ── Component ──────────────────────────────── */

interface AgentActionCardProps {
  action: AgentAction;
  onConfirm: (action: AgentAction) => void;
  onCancel: (action: AgentAction) => void;
  /** This card's confirm request is in flight. */
  confirming?: boolean;
  /** This card's cancel request is in flight. */
  cancelling?: boolean;
}

/**
 * AgentActionCard — one AI-proposed write and its human gate.
 *
 * The assistant never executes a write on its own: a pending action is shown
 * with an explicit "Requiere tu confirmación" caption plus Confirmar/Cancelar
 * actions. Terminal states keep the card in the transcript so the user can see
 * what happened.
 */
export function AgentActionCard({
  action,
  onConfirm,
  onCancel,
  confirming = false,
  cancelling = false,
}: AgentActionCardProps) {
  const meta = TYPE_META[action.type];
  const tone = STATUS_TONES[action.status];
  const busy = confirming || cancelling;
  const canAct = action.status === 'pending';
  const showActions = action.status === 'pending' || action.status === 'executing';

  const expiry = formatExpiry(action.expiresAt);
  const link = action.resultRef ? resultLink(action) : null;

  return (
    <Box
      role="group"
      aria-label={`Acción: ${meta.label} — ${STATUS_LABELS[action.status]}`}
      sx={{
        minWidth: 0,
        maxWidth: '100%',
        p: 1.5,
        borderRadius: '16px',
        border: 1,
        borderColor: tone.border,
        bgcolor: tone.background,
        color: tone.foreground,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Box
          aria-hidden="true"
          sx={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: '10px',
            bgcolor: 'color-mix(in srgb, currentColor 12%, transparent)',
          }}
        >
          {meta.icon}
        </Box>

        <Typography
          component="div"
          variant="labelLarge"
          sx={{ flex: 1, minWidth: 0, fontWeight: 700, color: 'inherit' }}
        >
          {meta.label}
        </Typography>

        <Box
          component="span"
          sx={{
            flexShrink: 0,
            px: 0.875,
            py: 0.25,
            borderRadius: '999px',
            border: 1,
            borderColor: 'currentColor',
            fontSize: '0.6875rem',
            fontWeight: 700,
            lineHeight: 1.5,
            whiteSpace: 'nowrap',
            opacity: 0.9,
          }}
        >
          {STATUS_LABELS[action.status]}
        </Box>
      </Box>

      <Typography
        component="p"
        variant="body2"
        sx={{
          mt: 1,
          mb: 0,
          minWidth: 0,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
          color: 'inherit',
        }}
      >
        {action.preview}
      </Typography>

      {action.status === 'pending' && (
        <Typography
          component="div"
          variant="caption"
          sx={{ display: 'block', mt: 0.75, fontWeight: 600, opacity: 0.85, color: 'inherit' }}
        >
          Requiere tu confirmación
          {expiry ? ` · Vence ${expiry}` : ''}
        </Typography>
      )}

      {action.status === 'executing' && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, minWidth: 0 }}>
          <CircularProgress size={16} thickness={5} color="inherit" />
          <Typography component="span" variant="caption" sx={{ fontWeight: 600, color: 'inherit' }}>
            Procesando…
          </Typography>
        </Box>
      )}

      {action.status === 'confirmed' && (
        <Box sx={{ mt: 1, minWidth: 0 }}>
          <Typography
            component="p"
            variant="body2"
            sx={{ m: 0, fontWeight: 600, color: 'inherit', overflowWrap: 'anywhere' }}
          >
            {action.resultSummary ?? 'Acción confirmada'}
          </Typography>

          {link && (
            <Link
              component={RouterLink}
              to={link.to}
              underline="always"
              sx={{
                display: 'inline-block',
                mt: 0.5,
                maxWidth: '100%',
                color: 'inherit',
                fontWeight: 700,
                overflowWrap: 'anywhere',
              }}
            >
              {link.label}
            </Link>
          )}

          {action.resultRef?.entity === 'payment' && (
            <Typography
              component="div"
              variant="caption"
              sx={{ display: 'block', mt: 0.5, fontWeight: 600, color: 'inherit' }}
            >
              {action.resultRef.label ?? 'Pago registrado'}
            </Typography>
          )}
        </Box>
      )}

      {action.status === 'failed' && (
        <Typography
          component="p"
          variant="body2"
          sx={{ mt: 1, mb: 0, fontWeight: 600, color: 'inherit', overflowWrap: 'anywhere' }}
        >
          {action.error ?? 'No se pudo completar la acción.'}
        </Typography>
      )}

      {action.status === 'cancelled' && (
        <Typography
          component="p"
          variant="caption"
          sx={{ display: 'block', mt: 0.75, color: 'inherit' }}
        >
          Esta acción fue cancelada y no se ejecutó.
        </Typography>
      )}

      {action.status === 'expired' && (
        <Typography
          component="p"
          variant="caption"
          sx={{ display: 'block', mt: 0.75, color: 'inherit' }}
        >
          Esta acción venció. Volvé a pedírsela al asistente si todavía la necesitás.
        </Typography>
      )}

      {showActions && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5, minWidth: 0 }}>
          <MuiButton
            variant="primary"
            size="sm"
            onClick={() => onConfirm(action)}
            isLoading={confirming}
            disabled={!canAct || busy}
          >
            Confirmar
          </MuiButton>
          <MuiButton
            variant="ghost"
            size="sm"
            onClick={() => onCancel(action)}
            isLoading={cancelling}
            disabled={!canAct || busy}
          >
            Cancelar
          </MuiButton>
        </Box>
      )}
    </Box>
  );
}
