import { useState, type FormEvent } from 'react';
import { useCreateExpense } from '../../hooks/mutations/index.ts';
import { todayLocalDate } from '../../lib/date.ts';
import { useVehicles } from '../../hooks/queries/index.ts';
import { isOfflineQueuedError } from '../../hooks/use-offline-mutation.ts';
import {
  MuiButton,
  MuiTextField,
  MuiDialog,
} from '../ui/index.ts';
import {
  IconCar,
  IconMoney,
  IconQrCode,
  IconBank,
} from '../ui/icons.tsx';
import type { ExpenseCategory, MoneyAccount } from '../../types/index.ts';
import Box from '@mui/material/Box';
import MuiAlert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import InputAdornment from '@mui/material/InputAdornment';
import Typography from '@mui/material/Typography';

/* ── Constants ───────────────────────────────── */

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  fuel: 'Combustible',
  salary: 'Sueldo',
  maintenance: 'Mantenimiento',
  supplies: 'Insumos',
  other: 'Otros',
  repair: 'Reparaciones',
  insurance: 'Seguro',
};

/** Categories that can be tagged to a vehicle (mirrors the detail aggregation). */
const VEHICLE_CATEGORIES: ExpenseCategory[] = ['fuel', 'repair', 'insurance', 'maintenance'];

const ACCOUNT_LABELS: Record<MoneyAccount, string> = {
  cash: 'Efectivo',
  mp: 'Mercado Pago',
  bank: 'Banco',
};

/* ── Types ───────────────────────────────────── */

interface FormData {
  amount: string;
  category: ExpenseCategory;
  date: string;
  description: string;
  reference: string;
  vehicleId: string;
  account: MoneyAccount;
}

const emptyForm = (): FormData => ({
  amount: '',
  category: 'fuel',
  date: todayLocalDate(),
  description: '',
  reference: '',
  vehicleId: '',
  account: 'cash',
});

export interface ExpenseDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful create (online or queued offline). */
  onCreated?: (queuedOffline: boolean) => void;
}

/**
 * ExpenseDialog — reusable "Registrar gasto" form.
 *
 * Extracted verbatim from the former ExpensesPage so the unified Caja screen
 * (and any other caller) can create expenses without duplicating the payload
 * building, validation or offline-queue handling.
 */
export function ExpenseDialog({ open, onClose, onCreated }: ExpenseDialogProps) {
  const [form, setForm] = useState<FormData>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  const vehiclesQuery = useVehicles();
  const vehicles = vehiclesQuery.data ?? [];

  const createExpense = useCreateExpense();
  const submitting = createExpense.isPending;

  const closeDialog = () => {
    setForm(emptyForm());
    setFormError(null);
    onClose();
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const amount = parseFloat(form.amount);
    if (isNaN(amount) || amount <= 0) {
      setFormError('El monto debe ser un número positivo');
      return;
    }

    createExpense.mutate(
      {
        amount,
        category: form.category,
        date: form.date,
        description: form.description.trim(),
        reference: form.reference.trim() || undefined,
        vehicleId: form.vehicleId || undefined,
        account: form.account,
      },
      {
        onSuccess: () => {
          setForm(emptyForm());
          setFormError(null);
          onCreated?.(false);
        },
        onError: (err) => {
          // Offline queued write: normal outcome, the OfflineBanner already confirmed it.
          if (isOfflineQueuedError(err)) {
            setForm(emptyForm());
            setFormError(null);
            onCreated?.(true);
            return;
          }
          setFormError(err instanceof Error ? err.message : 'Error al crear gasto');
        },
      },
    );
  };

  return (
    <MuiDialog
      open={open}
      onClose={closeDialog}
      title="Nuevo Gasto"
      actions={
        <>
          <MuiButton variant="ghost" onClick={closeDialog} disabled={submitting}>Cancelar</MuiButton>
          <MuiButton
            variant="primary"
            isLoading={submitting}
            disabled={submitting}
            onClick={() => {
              const formEl = document.getElementById('expense-form') as HTMLFormElement;
              formEl?.requestSubmit();
            }}
          >
            {submitting ? 'Guardando...' : 'Crear Gasto'}
          </MuiButton>
        </>
      }
    >
      <Box id="expense-form" component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {formError && <MuiAlert severity="error">{formError}</MuiAlert>}

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          <MuiTextField
            label="Monto"
            type="number"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            required
            placeholder="0.00"
          />
          <MuiTextField
            label="Categoría"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseCategory })}
            select
            required
          >
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <MenuItem key={value} value={value}>{label}</MenuItem>
            ))}
          </MuiTextField>
          <MuiTextField
            label="Cuenta"
            value={form.account}
            onChange={(e) => setForm({ ...form, account: e.target.value as MoneyAccount })}
            select
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    {form.account === 'cash' ? <IconMoney size={18} /> : form.account === 'mp' ? <IconQrCode size={18} /> : <IconBank size={18} />}
                  </InputAdornment>
                ),
              },
            }}
          >
            <MenuItem value="cash">{ACCOUNT_LABELS.cash}</MenuItem>
            <MenuItem value="mp">{ACCOUNT_LABELS.mp}</MenuItem>
            <MenuItem value="bank">{ACCOUNT_LABELS.bank}</MenuItem>
          </MuiTextField>
        </Box>

        {/* Optional vehicle tag — only for categories that count toward vehicle costs */}
        {VEHICLE_CATEGORIES.includes(form.category) && (
          <MuiTextField
            label="Vehículo (opcional)"
            value={form.vehicleId}
            onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}
            select
            helperText={vehicles.length === 0 ? 'No hay vehículos activos registrados' : 'Asociá el gasto a un vehículo de la flota'}
            slotProps={{
              input: {
                startAdornment: <InputAdornment position="start"><IconCar size={18} /></InputAdornment>,
              },
              select: { displayEmpty: true },
            }}
          >
            <MenuItem value="">
              <Typography variant="body2" color="text.secondary">Sin vehículo</Typography>
            </MenuItem>
            {vehicles.map((vehicle) => (
              <MenuItem key={vehicle._id} value={vehicle._id}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <IconCar size={16} />
                  <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <Typography variant="body2" noWrap>{vehicle.name}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
                      {vehicle.plate}
                    </Typography>
                  </Box>
                </Box>
              </MenuItem>
            ))}
          </MuiTextField>
        )}

        <MuiTextField
          label="Fecha"
          type="date"
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
          required
        />

        <MuiTextField
          label="Descripción"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value.slice(0, 200) })}
          required
          placeholder="Descripción del gasto"
        />

        <MuiTextField
          label="Referencia (opcional)"
          value={form.reference}
          onChange={(e) => setForm({ ...form, reference: e.target.value })}
          placeholder="Nro. factura, recibo, etc."
        />
      </Box>
    </MuiDialog>
  );
}
