import { useState, type FormEvent } from 'react';
import { useCreateCashAdjustment } from '../../hooks/mutations/index.ts';
import { todayLocalDate } from '../../lib/date.ts';
import { useDashboardSummary } from '../../hooks/queries/index.ts';
import { isOfflineQueuedError } from '../../hooks/use-offline-mutation.ts';
import {
  MuiButton,
  MuiTextField,
  MuiDialog,
} from '../ui/index.ts';
import {
  CASH_ADJUSTMENT_REASON_LABELS,
  type CashAdjustmentReason,
  type MoneyAccount,
} from '../../types/index.ts';
import Box from '@mui/material/Box';
import MuiAlert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';

/* ── Constants ───────────────────────────────── */

const ACCOUNT_LABELS: Record<MoneyAccount, string> = {
  cash: 'Efectivo',
  mp: 'Mercado Pago',
  bank: 'Banco',
};

const ACCOUNT_ORDER: MoneyAccount[] = ['cash', 'mp', 'bank'];

const REASON_ORDER: CashAdjustmentReason[] = ['correction', 'cash_count', 'missing', 'found', 'other'];

/** Manual movement direction; the sign sent to the API is derived from it. */
type AdjustmentKind = 'add' | 'remove';
type AdjustmentMode = 'delta' | 'target';

const round2 = (value: number): number => Math.round(value * 100) / 100;

/* ── Form ────────────────────────────────────── */

interface FormData {
  account: MoneyAccount;
  kind: AdjustmentKind;
  amount: string;
  target: string;
  reason: CashAdjustmentReason;
  note: string;
  date: string;
}

const emptyForm = (): FormData => ({
  account: 'cash',
  kind: 'add',
  amount: '',
  target: '',
  reason: 'correction',
  note: '',
  date: todayLocalDate(),
});

export interface CashAdjustmentDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful create (online or queued offline). */
  onCreated?: (queuedOffline: boolean) => void;
}

/**
 * CashAdjustmentDialog — reusable "Ajustar caja" form.
 *
 * Extracted verbatim from the former CashAdjustmentsPage. Keeps the delta vs.
 * target-balance logic, validation and offline-queue handling intact so the
 * unified Caja screen reuses the exact same business rules.
 */
export function CashAdjustmentDialog({ open, onClose, onCreated }: CashAdjustmentDialogProps) {
  const [mode, setMode] = useState<AdjustmentMode>('delta');
  const [form, setForm] = useState<FormData>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  // Per-account balances drive the "saldo objetivo" helper/difference.
  const summaryQuery = useDashboardSummary();
  const saldos = summaryQuery.data?.saldos;
  const balanceFor = (account: MoneyAccount): number => {
    if (!saldos) return 0;
    return account === 'cash' ? saldos.efectivo : account === 'mp' ? saldos.mercadopago : saldos.banco;
  };

  const createAdjustment = useCreateCashAdjustment();
  const submitting = createAdjustment.isPending;

  const closeDialog = () => {
    setForm(emptyForm());
    setMode('delta');
    setFormError(null);
    onClose();
  };

  // ── Derived signed amount ───────────────────────────────
  const absAmount = Math.abs(parseFloat(form.amount));
  const deltaSigned = form.kind === 'add' ? absAmount : -absAmount;
  const targetValue = parseFloat(form.target);
  const targetSigned = round2(targetValue - balanceFor(form.account));
  const signedAmount = mode === 'delta' ? deltaSigned : targetSigned;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (mode === 'delta') {
      if (!Number.isFinite(absAmount) || absAmount <= 0) {
        setFormError('El monto debe ser un número positivo');
        return;
      }
    } else {
      if (!Number.isFinite(targetValue)) {
        setFormError('Ingresá un saldo objetivo válido');
        return;
      }
      if (targetSigned === 0) {
        setFormError('El saldo objetivo ya coincide con el saldo actual');
        return;
      }
    }

    createAdjustment.mutate(
      {
        account: form.account,
        amount: signedAmount,
        reason: mode === 'target' ? 'correction' : form.reason,
        note: form.note.trim() || undefined,
        date: form.date,
      },
      {
        onSuccess: () => {
          setForm(emptyForm());
          setMode('delta');
          setFormError(null);
          onCreated?.(false);
        },
        onError: (err) => {
          if (isOfflineQueuedError(err)) {
            setForm(emptyForm());
            setMode('delta');
            setFormError(null);
            onCreated?.(true);
            return;
          }
          setFormError(err instanceof Error ? err.message : 'Error al registrar el ajuste');
        },
      },
    );
  };

  const formatCurrency = (n: number) => `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
  const formatSigned = (n: number) => `${n >= 0 ? '+' : '−'} ${formatCurrency(Math.abs(n))}`;

  return (
    <MuiDialog
      open={open}
      onClose={closeDialog}
      title="Nuevo Ajuste de Caja"
      actions={
        <>
          <MuiButton variant="ghost" onClick={closeDialog} disabled={submitting}>
            Cancelar
          </MuiButton>
          <MuiButton
            variant="primary"
            isLoading={submitting}
            disabled={submitting}
            onClick={() => {
              const formEl = document.getElementById('cash-adjustment-form') as HTMLFormElement;
              formEl?.requestSubmit();
            }}
          >
            {submitting ? 'Guardando...' : 'Registrar Ajuste'}
          </MuiButton>
        </>
      }
    >
      <Box
        id="cash-adjustment-form"
        component="form"
        onSubmit={handleSubmit}
        sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}
      >
        {formError && <MuiAlert severity="error">{formError}</MuiAlert>}

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          <MuiTextField
            select
            label="Cuenta"
            value={form.account}
            onChange={(e) => setForm({ ...form, account: e.target.value as MoneyAccount })}
            required
          >
            {ACCOUNT_ORDER.map((account) => (
              <MenuItem key={account} value={account}>
                {ACCOUNT_LABELS[account]}
              </MenuItem>
            ))}
          </MuiTextField>

          {mode === 'delta' ? (
            <MuiTextField
              select
              label="Tipo"
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as AdjustmentKind })}
              required
            >
              <MenuItem value="add">Agregar dinero</MenuItem>
              <MenuItem value="remove">Quitar dinero</MenuItem>
            </MuiTextField>
          ) : (
            <MuiTextField
              label="Saldo objetivo"
              type="number"
              value={form.target}
              onChange={(e) => setForm({ ...form, target: e.target.value })}
              placeholder="0.00"
              helperText={`Saldo actual: ${formatCurrency(balanceFor(form.account))}`}
            />
          )}

          {mode === 'delta' && (
            <MuiTextField
              label="Monto"
              type="number"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              required
              placeholder="0.00"
            />
          )}

          <MuiTextField
            select
            label="Motivo"
            value={mode === 'target' ? 'correction' : form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value as CashAdjustmentReason })}
            disabled={mode === 'target'}
            required
          >
            {REASON_ORDER.map((reason) => (
              <MenuItem key={reason} value={reason}>
                {CASH_ADJUSTMENT_REASON_LABELS[reason]}
              </MenuItem>
            ))}
          </MuiTextField>

          <MuiTextField
            label="Fecha"
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            required
          />
        </Box>

        <FormControlLabel
          control={
            <Checkbox
              checked={mode === 'target'}
              onChange={(e) => setMode(e.target.checked ? 'target' : 'delta')}
            />
          }
          label="Ajustar a un saldo objetivo"
        />

        {mode === 'target' && Number.isFinite(targetSigned) && (
          <MuiAlert severity={targetSigned >= 0 ? 'info' : 'warning'}>
            Diferencia a registrar: {formatSigned(targetSigned)}
          </MuiAlert>
        )}

        <MuiTextField
          label="Nota (opcional)"
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value.slice(0, 300) })}
          placeholder="Detalle del ajuste"
        />
      </Box>
    </MuiDialog>
  );
}
