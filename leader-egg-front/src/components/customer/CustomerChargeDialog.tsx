import { useEffect, useState } from 'react';
import type {
  CustomerChargeReason,
  CustomerChargeType,
} from '../../types/index.ts';
import { CUSTOMER_CHARGE_REASON_LABELS } from '../../types/index.ts';
import { useCreateCustomerCharge } from '../../hooks/mutations/index.ts';
import { todayLocalDate } from '../../lib/date.ts';
import { MuiButton, MuiDialog, MuiTextField } from '../ui/index.ts';
import { m3Shape } from '../../theme/index.ts';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';

/* ── Helpers ────────────────────────────────── */

const fmtMoney = (val: number) =>
  `$ ${val.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

const today = () => todayLocalDate();

/* ── CustomerChargeDialog ───────────────────── */

export interface CustomerChargeDialogProps {
  open: boolean;
  customerId: string;
  /** Current outstanding balance, shown inside the dialog for context. */
  currentBalance: number;
  onClose: () => void;
  /** Called after a successful charge/credit; the page owns the confirmation copy. */
  onSuccess?: (type: CustomerChargeType) => void;
}

/**
 * Manual "Crear deuda" / "Acreditar" dialog for the customer account.
 * Shared by the statement page and the customer detail hub.
 */
export function CustomerChargeDialog({
  open,
  customerId,
  currentBalance,
  onClose,
  onSuccess,
}: CustomerChargeDialogProps) {
  const [type, setType] = useState<CustomerChargeType>('charge');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<CustomerChargeReason>('manual_debt');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createCharge = useCreateCustomerCharge();
  const submitting = createCharge.isPending;

  // Reset the form every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setType('charge');
    setReason('manual_debt');
    setAmount('');
    setDate(today());
    setNote('');
    setError(null);
  }, [open, customerId]);

  // Switching debt ↔ credit also flips the default reason to the natural one.
  const handleTypeChange = (next: CustomerChargeType) => {
    setType(next);
    setReason(next === 'charge' ? 'manual_debt' : 'forgiveness');
  };

  const handleCreateCharge = () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Ingresá un monto mayor a cero.');
      return;
    }

    setError(null);
    createCharge.mutate(
      {
        customerId,
        data: {
          type,
          amount: value,
          reason,
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(date ? { date } : {}),
        },
      },
      {
        onSuccess: () => {
          onClose();
          onSuccess?.(type);
        },
        onError: (err) => {
          setError(err instanceof Error ? err.message : 'Error al registrar el movimiento');
        },
      },
    );
  };

  const hasDebt = currentBalance > 0;

  return (
    <MuiDialog
      open={open}
      onClose={onClose}
      title="Crear deuda"
      actions={
        <>
          <MuiButton variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </MuiButton>
          <MuiButton
            variant="primary"
            isLoading={submitting}
            disabled={submitting}
            onClick={handleCreateCharge}
          >
            {submitting ? 'Guardando...' : type === 'charge' ? 'Crear deuda' : 'Acreditar'}
          </MuiButton>
        </>
      }
    >
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Box component="form" onSubmit={(e) => { e.preventDefault(); handleCreateCharge(); }} sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <MuiTextField
          select
          label="Tipo"
          value={type}
          onChange={(e) => handleTypeChange(e.target.value as CustomerChargeType)}
          fullWidth
        >
          <MenuItem value="charge">Deuda (aumenta el saldo)</MenuItem>
          <MenuItem value="credit">Crédito (reduce el saldo)</MenuItem>
        </MuiTextField>

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
          label="Motivo"
          value={reason}
          onChange={(e) => setReason(e.target.value as CustomerChargeReason)}
          fullWidth
        >
          {(Object.keys(CUSTOMER_CHARGE_REASON_LABELS) as CustomerChargeReason[]).map((key) => (
            <MenuItem key={key} value={key}>
              {CUSTOMER_CHARGE_REASON_LABELS[key]}
            </MenuItem>
          ))}
        </MuiTextField>

        <MuiTextField
          label="Fecha"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          fullWidth
          slotProps={{ inputLabel: { shrink: true } }}
        />

        <MuiTextField
          label="Nota (opcional)"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 300))}
          fullWidth
          multiline
          rows={2}
        />

        <Box sx={{ p: 1.5, bgcolor: 'surfaceContainerLow', borderRadius: m3Shape.medium }}>
          <Typography variant="caption" color="onSurfaceVariant">Saldo actual del cliente</Typography>
          <Typography
            variant="body2"
            sx={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              color: hasDebt ? 'error.main' : 'onSurface',
            }}
          >
            {fmtMoney(currentBalance)}
          </Typography>
          <Typography variant="caption" color="onSurfaceVariant">
            {type === 'charge' ? 'Este cargo se sumará al saldo.' : 'Este crédito reducirá el saldo.'}
          </Typography>
        </Box>
      </Box>
    </MuiDialog>
  );
}
