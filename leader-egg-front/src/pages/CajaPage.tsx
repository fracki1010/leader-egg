import { useState, type ReactElement } from 'react';
import { useCashMovements, useCashSummary } from '../hooks/queries/index.ts';
import {
  MuiButton,
  MuiCard,
  MuiChip,
  MuiTextField,
  MuiSnackbar,
  PageHeader,
  LoadingState,
  EmptyState,
  MuiIconButton,
} from '../components/ui/index.ts';
import {
  IconWallet,
  IconPayments,
  IconExpense,
  IconTune,
  IconShoppingCart,
  IconUndo,
  IconPlus,
  IconTrendingUp,
  IconMinus,
  IconChevronRight,
  IconArrowLeft,
} from '../components/ui/icons.tsx';
import { AccountsTabs } from '../components/accounts/AccountsTabs.tsx';
import { ExpenseDialog } from '../components/cash/ExpenseDialog.tsx';
import { CashAdjustmentDialog } from '../components/cash/CashAdjustmentDialog.tsx';
import type { CashMovement, CashMovementType, MoneyAccount } from '../types/index.ts';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiAlert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import { alpha } from '@mui/material/styles';

/* ── Constants ───────────────────────────────── */

const ACCOUNT_LABELS: Record<MoneyAccount, string> = {
  cash: 'Efectivo',
  mp: 'Mercado Pago',
  bank: 'Banco',
};

const ACCOUNT_ORDER: MoneyAccount[] = ['cash', 'mp', 'bank'];

const TYPE_ORDER: CashMovementType[] = ['payment', 'expense', 'adjustment', 'purchase_payment', 'refund'];

interface MovementTypeMeta {
  label: string;
  icon: ReactElement;
  color: 'success' | 'error' | 'warning' | 'info' | 'secondary' | 'default';
}

const MOVEMENT_TYPE_META: Record<CashMovementType, MovementTypeMeta> = {
  payment: { label: 'Pago', icon: <IconPayments size={16} />, color: 'success' },
  expense: { label: 'Gasto', icon: <IconExpense size={16} />, color: 'error' },
  adjustment: { label: 'Ajuste', icon: <IconTune size={16} />, color: 'warning' },
  purchase_payment: { label: 'Pago a proveedor', icon: <IconShoppingCart size={16} />, color: 'info' },
  refund: { label: 'Devolución', icon: <IconUndo size={16} />, color: 'secondary' },
};

const LIMIT_OPTIONS = [10, 20, 50];

type DatePreset = 'all' | 'today' | '7d' | 'month' | '90d' | 'custom';

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'all', label: 'Todo' },
  { value: 'today', label: 'Hoy' },
  { value: '7d', label: '7 días' },
  { value: 'month', label: 'Mes' },
  { value: '90d', label: '90 días' },
  { value: 'custom', label: 'Personalizado' },
];

/* ── Helpers ─────────────────────────────────── */

/** Formats a Date as `YYYY-MM-DD` in the local timezone (avoids UTC drift). */
function toLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Resolves a relative preset into an inclusive `{ from, to }` local-date range. */
function resolvePresetRange(preset: Exclude<DatePreset, 'all' | 'custom'>): { from: string; to: string } {
  const now = new Date();
  const daysAgo = (days: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  const to = toLocalDate(now);

  switch (preset) {
    case 'today':
      return { from: to, to };
    case '7d':
      return { from: toLocalDate(daysAgo(6)), to };
    case 'month':
      return { from: toLocalDate(new Date(now.getFullYear(), now.getMonth(), 1)), to };
    case '90d':
      return { from: toLocalDate(daysAgo(89)), to };
  }
}

const formatMoney = (n: number) => `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
/** Signed money: "+ $ 1.000,00" for money in, "− $ 500,00" for money out. */
const formatSignedMoney = (n: number) => `${n >= 0 ? '+' : '−'} ${formatMoney(Math.abs(n))}`;

function formatDate(d: string): string {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* ── Sub-components ──────────────────────────── */

/** Section header — the M3 overline pattern used across the app. */
function SectionHeader({ icon, title, action }: { icon: ReactElement; title: string; action?: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, minHeight: 24, flexWrap: 'wrap', rowGap: 1 }}>
      <Box sx={{ display: 'flex', color: 'onSurfaceVariant' }}>{icon}</Box>
      <Typography variant="overline" color="onSurfaceVariant">
        {title}
      </Typography>
      {action && <Box sx={{ ml: 'auto' }}>{action}</Box>}
    </Box>
  );
}

/** Pill-shaped filter chip shared by the preset, account and type rows. */
function FilterChip({
  label,
  active,
  onClick,
  ariaLabel,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  ariaLabel?: string;
}) {
  return (
    <Box
      component="button"
      type="button"
      aria-pressed={active}
      aria-label={ariaLabel}
      onClick={onClick}
      sx={{
        appearance: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 32,
        px: 1.5,
        borderRadius: '999px',
        border: '1px solid',
        borderColor: active ? 'transparent' : (t) => alpha(t.palette.outlineVariant, 0.6),
        bgcolor: active ? 'primary.main' : 'surfaceContainerHigh',
        color: active ? 'onPrimary' : 'onSurfaceVariant',
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1,
        transition: 'background-color 0.18s, color 0.18s, border-color 0.18s',
        '&:hover': {
          bgcolor: active ? 'primary.main' : (t) => alpha(t.palette.primary.main, 0.08),
          borderColor: active ? 'transparent' : (t) => alpha(t.palette.outlineVariant, 1),
        },
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: 2,
        },
      }}
    >
      {label}
    </Box>
  );
}

/** Compact stat tile for today's in/out/net. */
function StatTile({ label, value, tone, icon }: { label: string; value: string; tone: 'in' | 'out' | 'neutral'; icon: ReactElement }) {
  const color = tone === 'in' ? 'success.main' : tone === 'out' ? 'error.main' : 'onSurface';
  return (
    <MuiCard variant="elevated" sx={{ height: '100%', display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Box sx={{ display: 'flex', color, flexShrink: 0 }}>{icon}</Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="overline" color="onSurfaceVariant" sx={{ display: 'block', lineHeight: 1.2 }}>
          {label}
        </Typography>
        <Typography
          variant="titleMedium"
          data-tone={tone}
          sx={{
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            color,
            lineHeight: 1.3,
          }}
        >
          {value}
        </Typography>
      </Box>
    </MuiCard>
  );
}

/* ── CajaPage ────────────────────────────────── */

export function CajaPage() {
  // Filters
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [account, setAccount] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [preset, setPreset] = useState<DatePreset>('all');

  // Dialogs
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);

  // Snackbar
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  const summaryQuery = useCashSummary();
  const today = summaryQuery.data?.today ?? { in: 0, out: 0, net: 0 };

  const params = {
    from: from || undefined,
    to: to || undefined,
    account: (account || undefined) as MoneyAccount | undefined,
    type: (type || undefined) as CashMovementType | undefined,
    page,
    limit,
  };
  const movementsQuery = useCashMovements(params);
  const movements = movementsQuery.data?.movements ?? [];
  const total = movementsQuery.data?.total ?? 0;
  const totals = movementsQuery.data?.totals ?? { in: 0, out: 0, net: 0 };
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // Any filter change restarts pagination at page 1.
  const resetPage = () => setPage(1);

  const hasActiveFilters = Boolean(from || to || account || type);

  const applyPreset = (next: DatePreset) => {
    setPreset(next);
    if (next === 'all') {
      setFrom('');
      setTo('');
    } else if (next !== 'custom') {
      const range = resolvePresetRange(next);
      setFrom(range.from);
      setTo(range.to);
    }
    resetPage();
  };

  const clearFilters = () => {
    setFrom('');
    setTo('');
    setAccount('');
    setType('');
    setPreset('all');
    resetPage();
  };

  const handleFromChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setFrom(event.target.value);
    setPreset('custom');
    resetPage();
  };

  const handleToChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setTo(event.target.value);
    setPreset('custom');
    resetPage();
  };

  const readError = movementsQuery.error
    ? movementsQuery.error instanceof Error
      ? movementsQuery.error.message
      : 'Error al cargar movimientos'
    : summaryQuery.error
      ? summaryQuery.error instanceof Error
        ? summaryQuery.error.message
        : 'Error al cargar saldos'
      : null;

  const handleCreated = (queuedOffline: boolean, message: string) => {
    setExpenseOpen(false);
    setAdjustmentOpen(false);
    setSnackbar({
      open: true,
      message: queuedOffline ? `${message} (sin conexión)` : message,
      severity: 'success',
    });
    // The create mutations invalidate the `cash` domain → list + summary refresh.
  };

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
      <AccountsTabs />

      <PageHeader
        title="Movimientos"
        subtitle="Cobros, gastos y ajustes de todas las cuentas"
        icon={<IconWallet size={22} />}
      />

      {/* ── Resumen de hoy ────────────────────── */}
      <SectionHeader icon={<IconTrendingUp size={14} />} title="Resumen de hoy" />
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(3, minmax(0, 1fr))' },
          mb: 4,
        }}
      >
        <StatTile label="Entradas" value={formatSignedMoney(today.in)} tone="in" icon={<IconPlus size={18} />} />
        <StatTile label="Salidas" value={`− ${formatMoney(today.out)}`} tone="out" icon={<IconMinus size={18} />} />
        <StatTile label="Neto" value={formatSignedMoney(today.net)} tone="neutral" icon={<IconTrendingUp size={18} />} />
      </Box>

      {/* ── Acciones ──────────────────────────── */}
      <SectionHeader icon={<IconPlus size={14} />} title="Acciones" />
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 4 }}>
        <MuiButton variant="primary" startIcon={<IconExpense size={18} />} onClick={() => setExpenseOpen(true)}>
          Registrar gasto
        </MuiButton>
        <MuiButton variant="secondary" startIcon={<IconTune size={18} />} onClick={() => setAdjustmentOpen(true)}>
          Ajustar caja
        </MuiButton>
      </Box>

      {/* ── Movimientos ───────────────────────── */}
      <SectionHeader
        icon={<IconWallet size={14} />}
        title="Movimientos"
        action={
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap', rowGap: 0.5 }}>
            <Typography variant="labelMedium" color="onSurfaceVariant" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
              {total} total
            </Typography>
            <Typography variant="labelMedium" color="onSurfaceVariant" sx={{ fontSize: 12 }}>
              Por página
            </Typography>
            <Select
              value={String(limit)}
              onChange={(e) => { setLimit(Number(e.target.value)); resetPage(); }}
              size="small"
              inputProps={{ 'aria-label': 'Por página' }}
              MenuProps={{ slotProps: { paper: { sx: { borderRadius: '16px', mt: 0.5 } } } }}
              sx={{
                minWidth: 72,
                height: 32,
                bgcolor: 'surfaceContainer',
                borderRadius: '10px',
                fontSize: '0.8125rem',
                fontWeight: 600,
                '& .MuiSelect-select': {
                  boxSizing: 'border-box',
                  height: 32,
                  py: 0,
                  pl: 1.25,
                  pr: '28px !important',
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '0.8125rem',
                },
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: (t) => alpha(t.palette.outlineVariant, 0.7),
                },
                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'outline' },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderWidth: 1, borderColor: 'primary.main' },
                '& .MuiSelect-icon': { color: 'onSurfaceVariant', right: 6, fontSize: 18 },
              }}
            >
              {LIMIT_OPTIONS.map((n) => (
                <MenuItem key={n} value={String(n)}>{n}</MenuItem>
              ))}
            </Select>
          </Box>
        }
      />

      {/* ── Filters ───────────────────────────── */}
      <Box
        sx={{
          bgcolor: 'surfaceContainer',
          borderRadius: '20px',
          border: '1px solid',
          borderColor: (t) => alpha(t.palette.outlineVariant, 0.7),
          p: 1.75,
          mb: 3,
        }}
      >
        {/* Card header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, minHeight: 32 }}>
          <Box sx={{ display: 'flex', color: 'onSurfaceVariant' }}><IconTune size={16} /></Box>
          <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'onSurfaceVariant' }}>
            FILTROS
          </Typography>
          {hasActiveFilters && (
            <MuiButton variant="ghost" size="sm" onClick={clearFilters} sx={{ ml: 'auto', minHeight: 32, px: 1 }}>
              Limpiar
            </MuiButton>
          )}
        </Box>

        {/* Date presets */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {DATE_PRESETS.map((option) => (
            <FilterChip
              key={option.value}
              label={option.label}
              active={preset === option.value}
              onClick={() => applyPreset(option.value)}
            />
          ))}
        </Box>

        {/* Custom range */}
        {preset === 'custom' && (
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 1.5,
              mt: 1.75,
              pt: 1.75,
              borderTop: '1px solid',
              borderColor: (t) => alpha(t.palette.outlineVariant, 0.5),
            }}
          >
            <MuiTextField
              label="Desde"
              type="date"
              size="small"
              value={from}
              onChange={handleFromChange}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ maxWidth: 180, flex: '1 1 150px' }}
            />
            <MuiTextField
              label="Hasta"
              type="date"
              size="small"
              value={to}
              onChange={handleToChange}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ maxWidth: 180, flex: '1 1 150px' }}
            />
          </Box>
        )}

        {/* Account chips */}
        <Box
          sx={{
            mt: 1.75,
            pt: 1.75,
            borderTop: '1px solid',
            borderColor: (t) => alpha(t.palette.outlineVariant, 0.5),
          }}
        >
          <Typography variant="caption" color="onSurfaceVariant" sx={{ display: 'block', mb: 0.75, fontWeight: 600 }}>
            Cuenta
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <FilterChip
              label="Todos"
              ariaLabel="Cuenta: Todos"
              active={account === ''}
              onClick={() => { setAccount(''); resetPage(); }}
            />
            {ACCOUNT_ORDER.map((a) => (
              <FilterChip
                key={a}
                label={ACCOUNT_LABELS[a]}
                ariaLabel={`Cuenta: ${ACCOUNT_LABELS[a]}`}
                active={account === a}
                onClick={() => { setAccount(a); resetPage(); }}
              />
            ))}
          </Box>
        </Box>

        {/* Type chips */}
        <Box
          sx={{
            mt: 1.75,
            pt: 1.75,
            borderTop: '1px solid',
            borderColor: (t) => alpha(t.palette.outlineVariant, 0.5),
          }}
        >
          <Typography variant="caption" color="onSurfaceVariant" sx={{ display: 'block', mb: 0.75, fontWeight: 600 }}>
            Tipo
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <FilterChip
              label="Todos"
              ariaLabel="Tipo: Todos"
              active={type === ''}
              onClick={() => { setType(''); resetPage(); }}
            />
            {TYPE_ORDER.map((t) => (
              <FilterChip
                key={t}
                label={MOVEMENT_TYPE_META[t].label}
                ariaLabel={`Tipo: ${MOVEMENT_TYPE_META[t].label}`}
                active={type === t}
                onClick={() => { setType(t); resetPage(); }}
              />
            ))}
          </Box>
        </Box>
      </Box>

      {/* Filtered totals */}
      <Box
        sx={{
          display: 'flex',
          gap: 2,
          flexWrap: 'wrap',
          mb: 3,
          px: 2,
          py: 1.5,
          borderRadius: '12px',
          bgcolor: 'surfaceContainerLow',
          border: 1,
          borderColor: 'outlineVariant',
        }}
      >
        <Typography variant="body2" color="onSurfaceVariant">
          Entradas:{' '}
          <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'success.main' }}>
            {formatMoney(totals.in)}
          </Box>
        </Typography>
        <Typography variant="body2" color="onSurfaceVariant">
          Salidas:{' '}
          <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'error.main' }}>
            {formatMoney(totals.out)}
          </Box>
        </Typography>
        <Typography variant="body2" color="onSurfaceVariant">
          Neto:{' '}
          <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: totals.net >= 0 ? 'success.main' : 'error.main' }}>
            {formatSignedMoney(totals.net)}
          </Box>
        </Typography>
      </Box>

      {readError && (
        <MuiAlert severity="error" sx={{ mb: 3 }}>{readError}</MuiAlert>
      )}

      {/* Ledger */}
      {movementsQuery.isLoading ? (
        <LoadingState label="Cargando movimientos…" />
      ) : movements.length === 0 ? (
        <EmptyState
          title="Sin movimientos"
          subtitle="No hay movimientos para los filtros seleccionados."
        />
      ) : (
        <MuiCard variant="elevated" sx={{ p: 0, overflow: 'hidden', '& .MuiCardContent-root': { p: 0, '&:last-child': { pb: 0 } } }}>
          {movements.map((movement: CashMovement) => {
            const meta = MOVEMENT_TYPE_META[movement.type];
            const isIn = movement.amount >= 0;
            return (
              <Box
                key={movement.id}
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: { xs: 'flex-start', sm: 'center' },
                  px: 3,
                  py: 2,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  '&:last-child': { borderBottom: 'none' },
                  flexDirection: { xs: 'column', sm: 'row' },
                  gap: 2,
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.5 }}>
                    <MuiChip label={meta.label} color={meta.color} variant="outlined" size="small" icon={meta.icon} />
                    <Typography variant="caption" color="onSurfaceVariant">
                      {formatDate(movement.date)}
                    </Typography>
                    <Typography variant="caption" color="onSurfaceVariant">
                      · {ACCOUNT_LABELS[movement.account]}
                    </Typography>
                  </Box>
                  <Typography variant="body2" color="onSurfaceVariant" noWrap>
                    {movement.description}
                  </Typography>
                  {movement.reference && (
                    <Typography variant="caption" color="onSurfaceVariant">
                      Ref: {movement.reference}
                    </Typography>
                  )}
                </Box>
                <Typography
                  variant="body1"
                  data-tone={isIn ? 'in' : 'out'}
                  sx={{
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    flexShrink: 0,
                    color: isIn ? 'success.main' : 'error.main',
                  }}
                >
                  {formatSignedMoney(movement.amount)}
                </Typography>
              </Box>
            );
          })}
        </MuiCard>
      )}

      {/* Pagination */}
      {!movementsQuery.isLoading && movements.length > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="labelMedium" color="onSurfaceVariant">
              Página {page} de {totalPages}
            </Typography>
            <MuiIconButton aria-label="Página anterior" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              <IconArrowLeft size={18} />
            </MuiIconButton>
            <MuiIconButton aria-label="Página siguiente" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              <IconChevronRight size={18} />
            </MuiIconButton>
          </Box>
      )}

      {/* Dialogs */}
      <ExpenseDialog
        open={expenseOpen}
        onClose={() => setExpenseOpen(false)}
        onCreated={(queuedOffline) => handleCreated(queuedOffline, 'Gasto creado correctamente')}
      />
      <CashAdjustmentDialog
        open={adjustmentOpen}
        onClose={() => setAdjustmentOpen(false)}
        onCreated={(queuedOffline) => handleCreated(queuedOffline, 'Ajuste registrado correctamente')}
      />

      <MuiSnackbar
        open={snackbar.open}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
        severity={snackbar.severity}
      />
    </Box>
  );
}
