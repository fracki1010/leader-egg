import type { CancelMoneyAction, OrderStatus } from '../../types/index.ts';
import { MuiButton, MuiDialog } from '../ui/index.ts';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';

/* ── Stock consequence model ─────────────────── */

export type TransitionTone = 'warning' | 'info' | 'neutral';

/** What a status transition will do to inventory — shown in the confirm dialog. */
export interface TransitionConsequence {
  tone: TransitionTone;
  /** Emphasized lead phrase for stock effects (rendered bold). */
  lead?: string;
  /** Remainder of the stock sentence. */
  detail?: string;
  /** Full sentence for transitions with no stock effect. */
  text?: string;
}

/**
 * Mirrors the backend `transitionOrderStatus` stock logic exactly:
 *  - `delivered` + `!stockDeducted`      → deduct the ordered stock
 *  - `stockDeducted` + (undo | cancel)   → restore the stock to inventory
 *  - anything else                       → no inventory movement
 *
 * `targetLabel` is used only for the neutral sentence ("El pedido pasará a X").
 */
export function getTransitionConsequence(
  currentStatus: OrderStatus,
  targetStatus: OrderStatus,
  stockDeducted: boolean | undefined,
  targetLabel: string,
): TransitionConsequence {
  if (targetStatus === 'delivered' && !stockDeducted) {
    return {
      tone: 'warning',
      lead: 'Se descontará el stock',
      detail: 'de los productos del pedido.',
    };
  }

  const undoDelivery = targetStatus === 'in_transit' && currentStatus === 'delivered';
  if (stockDeducted && (undoDelivery || targetStatus === 'cancelled')) {
    return {
      tone: 'info',
      lead: 'Se repondrá el stock',
      detail: 'al inventario.',
    };
  }

  return { tone: 'neutral', text: `El pedido pasará a ${targetLabel}.` };
}

/* ── Money decision model ────────────────────── */

/** Latin-American money formatting used across the order screens. */
const fmtMoney = (value: number): string =>
  `$ ${value.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

interface CancelMoneyOption {
  value: CancelMoneyAction;
  label: string;
  helper: string;
}

/** The four outcomes offered when a paid order is cancelled. */
const CANCEL_MONEY_OPTIONS: CancelMoneyOption[] = [
  { value: 'refund_cash', label: 'Efectivo', helper: 'Devolver en efectivo' },
  {
    value: 'refund_transfer',
    label: 'Transferencia',
    helper: 'Devolver por transferencia (Mercado Pago)',
  },
  {
    value: 'customer_credit',
    label: 'A favor del cliente',
    helper: 'Dejar el saldo a favor para el próximo pedido',
  },
  { value: 'none', label: 'No mover', helper: 'No mover la plata (lo resuelvo aparte)' },
];

/* ── Dialog ──────────────────────────────────── */

interface OrderStatusConfirmDialogProps {
  open: boolean;
  /** Dialog heading — the action being confirmed, e.g. "Marcar como Entregada". */
  title: string;
  /** Confirm button copy, e.g. "Sí, marcar Entregada". */
  confirmLabel: string;
  /** Stock/payment consequence for the pending transition. */
  consequence: TransitionConsequence | null;
  /**
   * Optional money decision. Only callers that need it (cancelling a paid
   * order) pass it; when present, the user MUST pick an outcome before the
   * confirm button enables.
   */
  moneyChoice?: {
    amount: number;
    value: CancelMoneyAction | null;
    onChange: (value: CancelMoneyAction) => void;
  };
  /** Error tone for the confirm button (cancel / destructive / undo actions). */
  destructive?: boolean;
  /** Inline submit error — the dialog stays open on failure. */
  error?: string | null;
  /** Disables both buttons and shows a spinner while the request runs. */
  submitting?: boolean;
  /** Order reference shown under the consequence. */
  orderNumber?: string;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * OrderStatusConfirmDialog — single confirmation gate for EVERY status change.
 *
 * No order transition fires immediately: the page sets the pending action and
 * this dialog states what will happen (above all, the stock consequence) before
 * the user commits. Forward actions confirm in primary; cancel/undo confirm in
 * the M3 error tone.
 */
export function OrderStatusConfirmDialog({
  open,
  title,
  confirmLabel,
  consequence,
  moneyChoice,
  destructive = false,
  error = null,
  submitting = false,
  orderNumber,
  onClose,
  onConfirm,
}: OrderStatusConfirmDialogProps) {
  const moneyMissing = moneyChoice !== undefined && moneyChoice.value === null;

  return (
    <MuiDialog
      open={open}
      onClose={onClose}
      title={title}
      maxWidth="xs"
      actions={
        <>
          <MuiButton variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </MuiButton>
          <MuiButton
            variant={destructive ? 'secondary' : 'primary'}
            isLoading={submitting}
            disabled={submitting || moneyMissing}
            onClick={onConfirm}
            sx={
              destructive
                ? {
                    bgcolor: 'errorContainer',
                    color: 'onErrorContainer',
                    '&:hover': { bgcolor: 'errorContainer', filter: 'brightness(0.96)' },
                  }
                : undefined
            }
          >
            {confirmLabel}
          </MuiButton>
        </>
      }
    >
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {consequence && consequence.tone === 'neutral' && (
        <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'surfaceContainer', color: 'onSurfaceVariant' }}>
          <Typography variant="body2">{consequence.text}</Typography>
        </Box>
      )}

      {consequence && consequence.tone !== 'neutral' && (
        <Alert severity={consequence.tone}>
          <Typography variant="body2">
            <Box component="span" sx={{ fontWeight: 700 }}>
              {consequence.lead}
            </Box>{' '}
            {consequence.detail}
          </Typography>
        </Alert>
      )}

      {moneyChoice && (
        <Box
          sx={{
            mt: 2,
            p: 2,
            borderRadius: 2,
            bgcolor: 'surfaceContainer',
            border: 1,
            borderColor: 'outlineVariant',
          }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, display: 'block' }}
          >
            Cobrado
          </Typography>
          <Typography
            variant="titleMedium"
            sx={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'onSurface', display: 'block', mb: 1 }}
          >
            {fmtMoney(moneyChoice.amount)}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            ¿Qué hacemos con la plata cobrada?
          </Typography>

          <RadioGroup
            aria-label="Qué hacer con el dinero cobrado"
            value={moneyChoice.value ?? ''}
            onChange={(event) => moneyChoice.onChange(event.target.value as CancelMoneyAction)}
          >
            {CANCEL_MONEY_OPTIONS.map((option) => (
              <FormControlLabel
                key={option.value}
                value={option.value}
                control={<Radio size="small" />}
                sx={{ alignItems: 'flex-start', mb: 0.5, '& .MuiRadio-root': { pt: 0.25 } }}
                label={
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: 'onSurface' }}>
                      {option.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {option.helper}
                    </Typography>
                  </Box>
                }
              />
            ))}
          </RadioGroup>
        </Box>
      )}

      {orderNumber && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          Orden #{orderNumber}
        </Typography>
      )}
    </MuiDialog>
  );
}
