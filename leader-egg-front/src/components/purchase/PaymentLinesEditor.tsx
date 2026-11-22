import type { MoneyAccount, PaymentLinePayload, PaymentMethod } from '../../types/index.ts';
import { MuiButton, MuiTextField } from '../ui/index.ts';
import { IconDelete, IconPlus } from '../ui/icons.tsx';
import { formatCurrency } from './PurchaseStatusChips.tsx';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';

/* ── Payment-line draft + helpers ───────────── */

/** Editable form state for one payment line (amount kept as string while typing). */
export interface PaymentLineDraft {
  /** Stable React key. */
  id: string;
  method: PaymentMethod;
  account: MoneyAccount;
  amount: string;
}

/** Money account a payment lands in, defaulted by method (cash→Efectivo, check→Banco). */
export const accountForMethod = (method: PaymentMethod): MoneyAccount =>
  method === 'cash' ? 'cash' : method === 'check' ? 'bank' : 'mp';

let paymentLineSeq = 0;
/** Builds a fresh draft line (default method cash → Efectivo). */
export const newPaymentLine = (): PaymentLineDraft => ({
  id: `pl-${Date.now().toString(36)}-${(paymentLineSeq += 1)}`,
  method: 'cash',
  account: 'cash',
  amount: '',
});

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Σ of the typed line amounts (drafts with blank/non-numeric amounts count as 0). */
export const totalOfLines = (lines: PaymentLineDraft[]): number =>
  round2(lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0));

/** Converts drafts into API lines, dropping rows without a positive amount. */
export const toPaymentLines = (lines: PaymentLineDraft[]): PaymentLinePayload[] =>
  lines
    .filter((line) => Number(line.amount) > 0)
    .map((line) => ({ method: line.method, account: line.account, amount: Number(line.amount) }));

/* ── PaymentLinesEditor ──────────────────────── */

interface PaymentLinesEditorProps {
  lines: PaymentLineDraft[];
  onChange: (lines: PaymentLineDraft[]) => void;
  /**
   * Amount the lines are paid against — the outstanding balance (detail dialog)
   * or the purchase total (create dialog). When null, the summary is hidden.
   */
  cap?: number | null;
  /** Caption for the cap value. Defaults to "Saldo pendiente". */
  capLabel?: string;
}

/**
 * PaymentLinesEditor — dynamic multi-line payment editor.
 *
 * One row per method, each with an overridable money account and a mono amount.
 * Lines always share one server-side groupId; Σ(lines) is shown live against the
 * outstanding cap with a "Restante" that turns green when it reaches 0. A single
 * line is just the degenerate case.
 */
export function PaymentLinesEditor({ lines, onChange, cap = null, capLabel = 'Saldo pendiente' }: PaymentLinesEditorProps) {
  const updateLine = (index: number, patch: Partial<PaymentLineDraft>) => {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const addLine = () => onChange([...lines, newPaymentLine()]);

  const removeLine = (index: number) => {
    if (lines.length <= 1) return;
    onChange(lines.filter((_, i) => i !== index));
  };

  const total = totalOfLines(lines);
  const remaining = cap === null ? null : round2(cap - total);
  const remainingZero = remaining !== null && Math.abs(remaining) < 0.005;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {lines.map((line, index) => (
        <Box
          key={line.id}
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1.2fr 1.2fr 1fr auto' },
            gap: 1.5,
            alignItems: 'center',
          }}
        >
          <MuiTextField
            label="Método"
            value={line.method}
            onChange={(e) => {
              const method = e.target.value as PaymentMethod;
              // Account auto-derives from the method but stays overridable below.
              updateLine(index, { method, account: accountForMethod(method) });
            }}
            select
            required
          >
            <MenuItem value="cash">Efectivo</MenuItem>
            <MenuItem value="transfer">Transferencia</MenuItem>
            <MenuItem value="check">Cheque</MenuItem>
          </MuiTextField>
          <MuiTextField
            label="Cuenta"
            value={line.account}
            onChange={(e) => updateLine(index, { account: e.target.value as MoneyAccount })}
            select
            required
          >
            <MenuItem value="cash">Efectivo</MenuItem>
            <MenuItem value="mp">Mercado Pago</MenuItem>
            <MenuItem value="bank">Banco</MenuItem>
          </MuiTextField>
          <MuiTextField
            label="Monto"
            type="number"
            placeholder="0.00"
            value={line.amount}
            onChange={(e) => updateLine(index, { amount: e.target.value })}
            required
            slotProps={{ htmlInput: { style: { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' } } }}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconButton
              color="error"
              size="small"
              onClick={() => removeLine(index)}
              disabled={lines.length <= 1}
              aria-label="Quitar método"
            >
              <IconDelete size={18} />
            </IconButton>
          </Box>
        </Box>
      ))}

      <MuiButton variant="secondary" size="sm" onClick={addLine} startIcon={<IconPlus />} sx={{ alignSelf: 'flex-start' }}>
        Agregar método
      </MuiButton>

      {/* Live summary: Σ lines + outstanding + remaining (green at 0) */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: cap === null ? '1fr' : '1fr 1fr',
          gap: 2,
          p: 2,
          bgcolor: 'surfaceContainerLow',
          borderRadius: '12px',
        }}
      >
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Total a registrar
          </Typography>
          <Typography variant="body1" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {formatCurrency(total)}
          </Typography>
        </Box>
        {cap !== null && (
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {capLabel}
            </Typography>
            <Typography variant="body1" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {formatCurrency(cap)}
            </Typography>
          </Box>
        )}
        {remaining !== null && (
          <Box sx={{ gridColumn: '1 / -1' }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Restante
            </Typography>
            <Typography
              variant="body1"
              sx={{
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color: remainingZero ? 'success.main' : remaining < 0 ? 'error.main' : 'warning.main',
              }}
            >
              {formatCurrency(remaining)}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
