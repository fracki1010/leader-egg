import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import { usePuntoCero } from '../../hooks/queries/index.ts';
import { useUpdateOpeningBalances } from '../../hooks/mutations/index.ts';
import { ApiError } from '../../api/client.ts';
import {
  MuiButton,
  MuiDialog,
  MuiSnackbar,
  MuiTextField,
} from '../ui/index.ts';
import {
  IconMoney,
  IconQrCode,
  IconBank,
  IconEdit,
  IconLock,
  IconCalendar,
} from '../ui/icons.tsx';
import { m3Shape } from '../../theme/index.ts';
import type { MoneyAccount } from '../../types/index.ts';

/* ── Config ─────────────────────────────────── */

const ACCOUNT_META: {
  key: MoneyAccount;
  label: string;
  icon: ReactNode;
  tileBg: string;
  tileFg: string;
}[] = [
  { key: 'cash', label: 'Efectivo', icon: <IconMoney size={20} />, tileBg: 'successContainer', tileFg: 'onSuccessContainer' },
  { key: 'mp', label: 'Mercado Pago', icon: <IconQrCode size={20} />, tileBg: 'infoContainer', tileFg: 'onInfoContainer' },
  { key: 'bank', label: 'Banco', icon: <IconBank size={20} />, tileBg: 'warningContainer', tileFg: 'onWarningContainer' },
];

const fmtMoney = (n: number) => `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

/** ISO timestamp → DD/MM/YYYY for the "Cargado el ..." caption. */
const fmtLockedDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
};

/* ── OpeningBalancesSection ─────────────────────
   Read-only summary plus the one-time editor. The editor keeps the original
   lock semantics: only accounts without a lock timestamp are submitted, so a
   loaded balance can never be overwritten from this dialog. A 409 from the
   backend means the account locked while the dialog was open — refetch to
   resync and show the server message. */

export function OpeningBalancesSection() {
  const query = usePuntoCero(true);
  const updateOpeningBalances = useUpdateOpeningBalances();

  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<Record<MoneyAccount, string>>({ cash: '0', mp: '0', bank: '0' });
  const [formError, setFormError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  const openingBalances = query.data?.openingBalances ?? null;
  const setAt = query.data?.openingBalancesSetAt ?? null;
  const submitting = updateOpeningBalances.isPending;

  const isLocked = (account: MoneyAccount): boolean => Boolean(setAt?.[account]);
  const allLocked = ACCOUNT_META.every((meta) => isLocked(meta.key));

  const openEditDialog = () => {
    setForm({
      cash: String(openingBalances?.cash ?? 0),
      mp: String(openingBalances?.mp ?? 0),
      bank: String(openingBalances?.bank ?? 0),
    });
    setFormError(null);
    setEditOpen(true);
  };

  const parseAmount = (raw: string): number | null => {
    if (raw.trim() === '') return 0;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return null;
    return value;
  };

  const handleSubmit = () => {
    // Only unlocked accounts are sent: a locked account is never re-submitted,
    // so its one-time value can never be overwritten by this dialog.
    const payload: { cash?: number; mp?: number; bank?: number } = {};
    for (const meta of ACCOUNT_META) {
      if (isLocked(meta.key)) continue;
      const parsed = parseAmount(form[meta.key]);
      if (parsed === null) {
        setFormError('Los saldos iniciales deben ser números mayores o iguales a cero.');
        return;
      }
      payload[meta.key] = parsed;
    }

    if (Object.keys(payload).length === 0) {
      setEditOpen(false);
      return;
    }

    setFormError(null);
    updateOpeningBalances.mutate(payload, {
      onSuccess: () => {
        setEditOpen(false);
        setSnackbar({ open: true, message: 'Saldos iniciales actualizados', severity: 'success' });
      },
      onError: (err) => {
        const message = err instanceof Error ? err.message : 'Error al actualizar los saldos iniciales';
        setFormError(message);
        // 409 → an account locked between opening the dialog and saving.
        if (err instanceof ApiError && err.status === 409) {
          void query.refetch();
        }
      },
    });
  };

  return (
    <Box component="section" aria-label="Saldos iniciales">
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          flexWrap: 'wrap',
          mb: 1.5,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography component="div" variant="titleSmall" sx={{ fontWeight: 700, color: 'onSurface' }}>
            Saldos iniciales
          </Typography>
          <Typography component="div" variant="caption" color="onSurfaceVariant">
            Se cargan una sola vez; después cada cuenta queda bloqueada.
          </Typography>
        </Box>
        <MuiButton
          variant="secondary"
          size="sm"
          startIcon={<IconEdit size={14} />}
          onClick={openEditDialog}
          disabled={!query.data || allLocked}
          sx={{ borderRadius: m3Shape.full, whiteSpace: 'nowrap' }}
        >
          Editar saldos
        </MuiButton>
      </Box>

      {query.isLoading && (
        <Typography variant="body2" color="onSurfaceVariant">
          Cargando saldos iniciales…
        </Typography>
      )}

      {query.error && !query.isLoading && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {query.error instanceof Error ? query.error.message : 'Error al cargar los saldos iniciales'}
        </Alert>
      )}

      {query.data && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {ACCOUNT_META.map((meta) => {
            const lock = setAt?.[meta.key] ?? null;
            const value = openingBalances?.[meta.key] ?? 0;
            return (
              <Box
                key={meta.key}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  flexWrap: 'wrap',
                  minHeight: 56,
                  px: 1.5,
                  py: 1,
                  borderRadius: '16px',
                  bgcolor: 'surfaceContainerLow',
                  border: 1,
                  borderColor: 'outlineVariant',
                }}
              >
                <Box
                  aria-hidden="true"
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 40,
                    height: 40,
                    borderRadius: '12px',
                    bgcolor: meta.tileBg,
                    color: meta.tileFg,
                    flexShrink: 0,
                  }}
                >
                  {meta.icon}
                </Box>
                <Box sx={{ flex: 1, minWidth: 120 }}>
                  <Typography component="div" variant="body2" sx={{ fontWeight: 600, color: 'onSurface' }}>
                    {meta.label}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25, flexWrap: 'wrap' }}>
                    {lock ? (
                      <>
                        <Box sx={{ display: 'flex', color: 'onSurfaceVariant' }}>
                          <IconLock size={12} />
                        </Box>
                        <Typography component="span" variant="caption" color="onSurfaceVariant">
                          Bloqueado · cargado el {fmtLockedDate(lock)}
                        </Typography>
                      </>
                    ) : (
                      <>
                        <Box sx={{ display: 'flex', color: 'onSurfaceVariant' }}>
                          <IconCalendar size={12} />
                        </Box>
                        <Typography component="span" variant="caption" color="onSurfaceVariant">
                          Editable
                        </Typography>
                      </>
                    )}
                  </Box>
                </Box>
                <Typography
                  component="div"
                  sx={{
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: '0.95rem',
                    color: 'onSurface',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {fmtMoney(value)}
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}

      <MuiDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Editar saldos iniciales"
        actions={
          <>
            <MuiButton variant="ghost" onClick={() => setEditOpen(false)} disabled={submitting}>
              Cancelar
            </MuiButton>
            <MuiButton variant="primary" isLoading={submitting} disabled={submitting} onClick={handleSubmit}>
              {submitting ? 'Guardando...' : 'Guardar'}
            </MuiButton>
          </>
        }
      >
        {formError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {formError}
          </Alert>
        )}
        <Typography variant="body2" color="onSurfaceVariant" sx={{ mb: 2 }}>
          Cargá el saldo de arranque de cada cuenta. Se guarda una sola vez; después queda bloqueado y
          solo puede corregirse con Ajustar caja.
        </Typography>
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}
        >
          {ACCOUNT_META.map((meta) => {
            const lock = setAt?.[meta.key] ?? null;
            return (
              <MuiTextField
                key={meta.key}
                label={meta.label}
                type="number"
                value={form[meta.key]}
                onChange={(e) => setForm((prev) => ({ ...prev, [meta.key]: e.target.value }))}
                fullWidth
                disabled={Boolean(lock)}
                helperText={
                  lock ? `Cargado el ${fmtLockedDate(lock)}. No se puede modificar.` : undefined
                }
                slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
              />
            );
          })}
        </Box>
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
