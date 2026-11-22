import { useEffect, useMemo, useState } from 'react';
import type {
  CustomerPaymentResult,
  MoneyAccount,
  Order,
  PaymentMethod,
} from '../../types/index.ts';
import { useAccountMovements } from '../../hooks/queries/index.ts';
import { useRecordCustomerPayment } from '../../hooks/mutations/index.ts';
import { MuiButton, MuiDialog, MuiTextField } from '../ui/index.ts';
import { m3Shape } from '../../theme/index.ts';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';

/* ── Config ─────────────────────────────────── */

const REFERENCE_LABELS: Record<string, string> = {
  transfer: 'Referencia / CBU',
  check: 'N° de cheque',
};

const fmtMoney = (val: number) =>
  `$ ${val.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

/** Short day/month used in the FIFO allocation preview (e.g. "12/10"). */
const fmtDayMonth = (d: string) =>
  new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });

/* ── CustomerPaymentDialog ──────────────────── */

export interface CustomerPaymentDialogProps {
  open: boolean;
  customerId: string;
  onClose: () => void;
  /** Called after a successful payment; the page owns the confirmation copy. */
  onSuccess?: (result: CustomerPaymentResult) => void;
}

/**
 * Customer-level payment dialog with a live FIFO allocation preview.
 *
 * The ledger is fetched through the accounts query (same cache key as the
 * statement page) only while the dialog is open, so the preview uses the same
 * oldest-first math as the backend allocation.
 */
export function CustomerPaymentDialog({
  open,
  customerId,
  onClose,
  onSuccess,
}: CustomerPaymentDialogProps) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [account, setAccount] = useState<MoneyAccount | ''>('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  const accountQuery = useAccountMovements(open ? customerId : undefined);
  const data = accountQuery.data ?? null;

  const recordPayment = useRecordCustomerPayment();
  const submitting = recordPayment.isPending;

  // Reset the form every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setAmount('');
    setMethod('cash');
    setAccount('');
    setReference('');
    setError(null);
  }, [open, customerId]);

  // Open orders sorted oldest-first — the same FIFO order the API applies, so
  // the dialog preview matches the real allocation exactly.
  const openOrders = useMemo(() => {
    const orders = (data?.orders.items ?? []).filter((order) => order.balance > 0);
    return [...orders].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
        a._id.localeCompare(b._id)
    );
  }, [data]);

  const totalOpen = useMemo(
    () => openOrders.reduce((sum, order) => sum + order.balance, 0),
    [openOrders]
  );

  // TOTAL debt = open order balances + opening debt + net manual charges, as
  // reported by the account summary. Only the order slice is FIFO-allocated;
  // the remainder is settled against the non-order debt (opening + manual).
  const totalDebt = Math.max(0, data?.summary.outstandingBalance ?? 0);
  const nonOrderDebt = Math.max(0, Math.round((totalDebt - totalOpen) * 100) / 100);

  const amountNumber = Number(amount);
  const hasValidAmount = Number.isFinite(amountNumber) && amountNumber > 0;
  const amountExceedsDebt = hasValidAmount && amountNumber > totalDebt;
  const noDebt = accountQuery.isSuccess && totalDebt <= 0;

  // Greedy oldest-first preview: identical math to the backend allocation.
  const allocationPreview = useMemo(() => {
    if (!hasValidAmount) return [] as Array<{ order: Order; applied: number; full: boolean }>;
    let remaining = amountNumber;
    const rows: Array<{ order: Order; applied: number; full: boolean }> = [];
    for (const order of openOrders) {
      if (remaining <= 0) break;
      const applied = Math.round(Math.min(remaining, order.balance) * 100) / 100;
      if (applied <= 0) continue;
      remaining = Math.round((remaining - applied) * 100) / 100;
      rows.push({ order, applied, full: applied >= order.balance });
    }
    return rows;
  }, [openOrders, amountNumber, hasValidAmount]);

  // Remainder that hits the non-order debt (opening debt + manual charges).
  const nonOrderPreview = useMemo(() => {
    if (!hasValidAmount || nonOrderDebt <= 0) return 0;
    const appliedToOrders = allocationPreview.reduce((sum, row) => sum + row.applied, 0);
    return Math.max(0, Math.round((amountNumber - appliedToOrders) * 100) / 100);
  }, [allocationPreview, amountNumber, hasValidAmount, nonOrderDebt]);

  // Excess above the TOTAL debt is rejected server-side, so this is 0 for any
  // submittable amount; kept visible for transparency while typing.
  const unappliedAmount = Math.max(0, Math.round((amountNumber - totalDebt) * 100) / 100);

  const handleRecordPayment = () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Ingresá un monto mayor a cero.');
      return;
    }
    if (totalDebt <= 0) {
      setError('El cliente no tiene deuda pendiente.');
      return;
    }
    if (value > totalDebt) {
      setError(`El monto supera la deuda total (${fmtMoney(totalDebt)})`);
      return;
    }

    setError(null);
    recordPayment.mutate(
      {
        customerId,
        data: {
          amount: value,
          method,
          ...(account ? { account } : {}),
          ...(reference.trim() ? { reference: reference.trim() } : {}),
        },
      },
      {
        onSuccess: (result) => {
          onClose();
          onSuccess?.(result);
        },
        onError: (err) => {
          setError(err instanceof Error ? err.message : 'Error al registrar el pago');
        },
      },
    );
  };

  const canSubmit =
    !submitting && hasValidAmount && !amountExceedsDebt && !noDebt && !accountQuery.isLoading;

  return (
    <MuiDialog
      open={open}
      onClose={onClose}
      title="Registrar pago"
      actions={
        <>
          <MuiButton variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </MuiButton>
          <MuiButton
            variant="primary"
            isLoading={submitting}
            disabled={!canSubmit}
            onClick={handleRecordPayment}
          >
            {submitting ? 'Registrando...' : 'Registrar pago'}
          </MuiButton>
        </>
      }
    >
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {accountQuery.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>Error al cargar las órdenes abiertas.</Alert>
      )}
      {accountQuery.isLoading && <LinearProgress sx={{ mb: 2, borderRadius: 1 }} />}
      {noDebt && (
        <Alert severity="info" sx={{ mb: 2 }}>
          El cliente no tiene deuda pendiente.
        </Alert>
      )}
      {amountExceedsDebt && (
        <Alert severity="error" sx={{ mb: 2 }}>
          El monto supera la deuda total ({fmtMoney(totalDebt)})
        </Alert>
      )}
      <Box component="form" onSubmit={(e) => { e.preventDefault(); handleRecordPayment(); }} sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <MuiTextField
          label="Monto ($)"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          placeholder="0.00"
          fullWidth
          slotProps={{
            htmlInput: { min: 0.01, step: 0.01 },
          }}
        />

        <MuiTextField
          select
          label="Método"
          value={method}
          onChange={(e) => { setMethod(e.target.value as PaymentMethod); setReference(''); }}
          fullWidth
        >
          <MenuItem value="cash">Efectivo</MenuItem>
          <MenuItem value="transfer">Transferencia</MenuItem>
          <MenuItem value="check">Cheque</MenuItem>
        </MuiTextField>

        <MuiTextField
          select
          label="Cuenta"
          value={account}
          onChange={(e) => setAccount(e.target.value as MoneyAccount | '')}
          fullWidth
        >
          <MenuItem value="">Automática (según método)</MenuItem>
          <MenuItem value="cash">Efectivo</MenuItem>
          <MenuItem value="mp">Mercado Pago</MenuItem>
          <MenuItem value="bank">Banco</MenuItem>
        </MuiTextField>

        {method !== 'cash' && (
          <MuiTextField
            label={REFERENCE_LABELS[method]}
            value={reference}
            onChange={(e) => setReference(e.target.value.slice(0, 100))}
            placeholder={REFERENCE_LABELS[method]}
            fullWidth
          />
        )}

        <Box sx={{ p: 1.5, bgcolor: 'surfaceContainerLow', borderRadius: m3Shape.medium }}>
          <Typography variant="caption" color="onSurfaceVariant" sx={{ display: 'block', mb: 1 }}>
            Se aplicará a las órdenes más antiguas primero y luego a la deuda manual / inicial
          </Typography>
          {!hasValidAmount ? (
            <Typography variant="body2" color="onSurfaceVariant">
              Ingresá un monto para ver cómo se distribuye.
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {allocationPreview.map(({ order, applied, full }) => (
                <Box
                  key={order._id}
                  sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1.5 }}
                >
                  <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', color: 'onSurface' }}>
                    → #{order.orderNumber} ({fmtDayMonth(order.createdAt)})
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, whiteSpace: 'nowrap' }}>
                    <Typography
                      variant="body2"
                      sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                    >
                      {fmtMoney(applied)}
                    </Typography>
                    <Typography variant="caption" color="onSurfaceVariant">
                      {full ? '(saldo completo)' : '(parcial)'}
                    </Typography>
                  </Box>
                </Box>
              ))}
              {nonOrderPreview > 0 && (
                <Box
                  sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1.5 }}
                >
                  <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', color: 'onSurface' }}>
                    → Deuda manual / inicial
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, whiteSpace: 'nowrap' }}>
                    <Typography
                      variant="body2"
                      sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                    >
                      {fmtMoney(nonOrderPreview)}
                    </Typography>
                    <Typography variant="caption" color="onSurfaceVariant">
                      {nonOrderPreview >= nonOrderDebt ? '(saldo completo)' : '(parcial)'}
                    </Typography>
                  </Box>
                </Box>
              )}
              {allocationPreview.length === 0 && nonOrderPreview === 0 && (
                <Typography variant="body2" color="onSurfaceVariant">
                  No hay deuda pendiente para aplicar el pago.
                </Typography>
              )}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 1.5,
                  pt: 1,
                  mt: 0.5,
                  borderTop: '1px solid',
                  borderColor: 'outlineVariant',
                }}
              >
                <Typography variant="caption" color="onSurfaceVariant">Sin asignar</Typography>
                <Typography
                  variant="body2"
                  sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                >
                  {fmtMoney(unappliedAmount)}
                </Typography>
              </Box>
            </Box>
          )}
        </Box>
      </Box>
    </MuiDialog>
  );
}
