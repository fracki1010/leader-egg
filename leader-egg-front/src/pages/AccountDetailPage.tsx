import { useState, type ReactElement } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { alpha, type Theme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import {
  useCashMovements,
  useCashSummary,
  usePuntoCero,
} from '../hooks/queries/index.ts';
import { useSmartBack } from '../hooks/useSmartBack.ts';
import { useAuthStore } from '../stores/authStore.ts';
import {
  MuiButton,
  MuiCard,
  MuiChip,
  LoadingState,
  EmptyState,
} from '../components/ui/index.ts';
import {
  IconArrowBack,
  IconArrowLeft,
  IconBank,
  IconCalendar,
  IconChevronRight,
  IconCircleCheck,
  IconExpense,
  IconInbox,
  IconMoney,
  IconPayments,
  IconQrCode,
  IconShoppingCart,
  IconTune,
  IconUndo,
} from '../components/ui/icons.tsx';
import { toLocalDate } from '../lib/date.ts';
import type { CashMovement, CashMovementType, MoneyAccount } from '../types/index.ts';

/* ── Constants ───────────────────────────────── */

const PAGE_SIZE = 25;

const PRESETS = [
  { key: 'all', label: 'Todo' },
  { key: 'today', label: 'Hoy' },
  { key: '7d', label: '7 días' },
  { key: 'month', label: 'Mes' },
  { key: '90d', label: '90 días' },
] as const;

type Preset = (typeof PRESETS)[number]['key'];

type Tone = 'success' | 'error' | 'warning' | 'info' | 'secondary';

interface AccountMeta {
  label: string;
  subtitle: string;
  icon: ReactElement;
  tileBg: string;
  tileFg: string;
  tone: Extract<Tone, 'success' | 'info' | 'warning'>;
}

/** Per-account identity used by the header and the balance card. */
const ACCOUNT_META: Record<MoneyAccount, AccountMeta> = {
  cash: {
    label: 'Efectivo',
    subtitle: 'Caja principal y cobranzas',
    icon: <IconMoney size={22} />,
    tileBg: 'successContainer',
    tileFg: 'onSuccessContainer',
    tone: 'success',
  },
  mp: {
    label: 'Mercado Pago',
    subtitle: 'Cobros QR y transferencias',
    icon: <IconQrCode size={22} />,
    tileBg: 'infoContainer',
    tileFg: 'onInfoContainer',
    tone: 'info',
  },
  bank: {
    label: 'Banco',
    subtitle: 'Cuenta corriente bancaria',
    icon: <IconBank size={22} />,
    tileBg: 'warningContainer',
    tileFg: 'onWarningContainer',
    tone: 'warning',
  },
};

interface MovementTypeMeta {
  label: string;
  icon: ReactElement;
  tone: Tone;
}

const MOVEMENT_TYPE_META: Record<CashMovementType, MovementTypeMeta> = {
  payment: { label: 'Pago', icon: <IconPayments size={18} />, tone: 'success' },
  expense: { label: 'Gasto', icon: <IconExpense size={18} />, tone: 'error' },
  adjustment: { label: 'Ajuste', icon: <IconTune size={18} />, tone: 'warning' },
  purchase_payment: { label: 'Pago a proveedor', icon: <IconShoppingCart size={18} />, tone: 'info' },
  refund: { label: 'Devolución', icon: <IconUndo size={18} />, tone: 'secondary' },
};

/* ── Helpers ─────────────────────────────────── */

const isMoneyAccount = (value: string | undefined): value is MoneyAccount =>
  value === 'cash' || value === 'mp' || value === 'bank';

const fmtMoney = (n: number) => `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

/** Signed money: "+ $ 1.000,00" for money in, "− $ 500,00" for money out. */
const fmtSignedMoney = (n: number) => `${n >= 0 ? '+' : '−'} ${fmtMoney(Math.abs(n))}`;

/** ISO timestamp → DD/MM/YYYY for the "Cargado el ..." caption. */
const fmtLockedDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
};

/** Local HH:mm — built from local components so ART never drifts a day. */
const fmtTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

/** `YYYY-MM-DD` → `DD/MM/YYYY` (the key already carries the local day). */
const fmtDayKey = (key: string): string => key.split('-').reverse().join('/');

const toneMain = (theme: Theme, tone: Tone): string => theme.palette[tone].main;

/** Local date key N days before today. */
const daysAgoKey = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return toLocalDate(date);
};

/** Preset → API range. `all` sends no bounds at all. */
const rangeForPreset = (preset: Preset): { from?: string; to?: string } => {
  const today = toLocalDate(new Date());

  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case '7d':
      return { from: daysAgoKey(6), to: today };
    case 'month': {
      const now = new Date();
      return { from: toLocalDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    }
    case '90d':
      return { from: daysAgoKey(89), to: today };
    case 'all':
      return {};
  }
};

interface DayGroup {
  key: string;
  movements: CashMovement[];
  net: number;
}

/** Groups the ledger by LOCAL calendar day, newest day first, newest row first. */
const groupMovementsByDay = (movements: CashMovement[]): DayGroup[] => {
  const byDay = new Map<string, CashMovement[]>();

  for (const movement of movements) {
    const date = new Date(movement.date);
    if (Number.isNaN(date.getTime())) continue;
    const key = toLocalDate(date);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(movement);
    else byDay.set(key, [movement]);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([key, bucket]) => ({
      key,
      movements: [...bucket].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      ),
      net: bucket.reduce((sum, movement) => sum + movement.amount, 0),
    }));
};

/* ── Page ────────────────────────────────────── */

export function AccountDetailPage() {
  const { account } = useParams<{ account: string }>();

  // Unknown :account goes back to the accounts list. The guard lives in the
  // outer component so the inner one can call hooks unconditionally.
  if (!isMoneyAccount(account)) {
    return <Navigate to="/cuentas" replace />;
  }

  return <AccountDetail key={account} account={account} />;
}

/* ── AccountDetail ───────────────────────────── */

function AccountDetail({ account }: { account: MoneyAccount }) {
  const meta = ACCOUNT_META[account];
  const goBack = useSmartBack('/cuentas');

  const [preset, setPreset] = useState<Preset>('all');
  const [page, setPage] = useState(1);

  const summaryQuery = useCashSummary();
  // Setup is `config.manage`-only; accounts.view users must never call it.
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const canManageConfig = hasPermission('config.manage');
  const puntoCeroQuery = usePuntoCero(canManageConfig);
  const { from, to } = rangeForPreset(preset);
  const movementsQuery = useCashMovements({ account, from, to, page, limit: PAGE_SIZE });

  const current = summaryQuery.data?.accounts[account] ?? 0;
  const opening = canManageConfig ? puntoCeroQuery.data?.openingBalances[account] ?? null : null;
  const lockedAt = canManageConfig ? puntoCeroQuery.data?.openingBalancesSetAt[account] ?? null : null;

  const movements = movementsQuery.data?.movements ?? [];
  const total = movementsQuery.data?.total ?? 0;
  const totals = movementsQuery.data?.totals ?? { in: 0, out: 0, net: 0 };
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const todayKey = toLocalDate(new Date());
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayKey = toLocalDate(yesterdayDate);

  const groups = groupMovementsByDay(movements);

  const dayLabel = (key: string): string => {
    if (key === todayKey) return 'Hoy';
    if (key === yesterdayKey) return 'Ayer';
    return fmtDayKey(key);
  };

  const selectPreset = (next: Preset) => {
    setPreset(next);
    setPage(1);
  };

  const readError = movementsQuery.error
    ? movementsQuery.error instanceof Error
      ? movementsQuery.error.message
      : 'Error al cargar los movimientos'
    : summaryQuery.error
      ? summaryQuery.error instanceof Error
        ? summaryQuery.error.message
        : 'Error al cargar el saldo'
      : canManageConfig && puntoCeroQuery.error
        ? puntoCeroQuery.error instanceof Error
          ? puntoCeroQuery.error.message
          : 'Error al cargar el saldo inicial'
        : null;

  if (summaryQuery.isLoading || puntoCeroQuery.isLoading) {
    return (
      <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
        <MuiButton variant="ghost" onClick={goBack} startIcon={<IconArrowBack />} sx={{ mb: 2 }}>
          Volver a Cuentas
        </MuiButton>
        <LoadingState label={`Cargando ${meta.label.toLowerCase()}…`} />
      </Box>
    );
  }

  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
      {/* ── Header ───────────────────────────────── */}
      <Box component="header" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3, minWidth: 0 }}>
        {/* The app bar already renders the back affordance on detail routes. */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 44,
            height: 44,
            borderRadius: '14px',
            bgcolor: meta.tileBg,
            color: meta.tileFg,
            flexShrink: 0,
          }}
        >
          {meta.icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="titleLarge"
            component="h1"
            sx={{ fontWeight: 700, color: 'onSurface', lineHeight: 1.25 }}
          >
            {meta.label}
          </Typography>
          <Typography
            variant="body2"
            component="p"
            sx={{ color: 'onSurfaceVariant', lineHeight: 1.35, m: 0, mt: 0.25 }}
          >
            {meta.subtitle}
          </Typography>
        </Box>
      </Box>

      {readError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {readError}
        </Alert>
      )}

      {/* ── Balance card ─────────────────────────── */}
      <Box
        component="section"
        aria-label={`Saldo de ${meta.label}`}
        sx={(theme) => ({
          p: { xs: 2, sm: 2.5 },
          mb: 3,
          borderRadius: '20px',
          border: '1px solid',
          borderColor: alpha(theme.palette.outlineVariant, 0.65),
          background: `linear-gradient(135deg, ${theme.palette.surfaceContainer} 0%, ${theme.palette.surfaceContainerHigh} 100%)`,
        })}
      >
        <Typography
          variant="caption"
          component="div"
          sx={(theme) => ({
            fontSize: '0.6875rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: toneMain(theme, meta.tone),
          })}
        >
          Saldo actual
        </Typography>
        <Typography
          component="div"
          sx={{
            mt: 0.5,
            fontFamily: 'var(--font-mono)',
            fontWeight: 800,
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '-0.03em',
            lineHeight: 1.05,
            fontSize: { xs: '1.75rem', sm: '2rem' },
            color: 'onSurface',
            overflowWrap: 'anywhere',
          }}
        >
          {fmtMoney(current)}
        </Typography>

        {canManageConfig && (
          <>
            <Divider sx={{ my: 2, borderColor: 'outlineVariant' }} />

            <Box>
              <Typography variant="caption" component="div" sx={{ color: 'onSurfaceVariant', fontWeight: 600 }}>
                Saldo inicial
              </Typography>
              <Typography
                variant="titleSmall"
                component="div"
                sx={{
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                  color: 'onSurfaceVariant',
                }}
              >
                {opening == null ? '—' : fmtMoney(opening)}
              </Typography>

              {lockedAt ? (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    mt: 0.5,
                    color: 'success.main',
                  }}
                >
                  <IconCircleCheck size={12} />
                  <Typography variant="caption" component="span" sx={{ color: 'inherit', fontWeight: 600 }}>
                    Cargado el {fmtLockedDate(lockedAt)} · Conciliado
                  </Typography>
                </Box>
              ) : (
                puntoCeroQuery.data && (
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      mt: 0.5,
                      color: 'onSurfaceVariant',
                    }}
                  >
                    <IconCalendar size={12} />
                    <Typography variant="caption" component="span" sx={{ color: 'inherit' }}>
                      Sin cargar
                    </Typography>
                  </Box>
                )
              )}
            </Box>
          </>
        )}
      </Box>

      {/* ── Period presets ───────────────────────── */}
      <Box
        role="group"
        aria-label="Período"
        sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}
      >
        {PRESETS.map((option) => {
          const active = option.key === preset;
          return (
            <MuiChip
              key={option.key}
              label={option.label}
              color="primary"
              variant={active ? 'filled' : 'outlined'}
              onClick={() => selectPreset(option.key)}
              sx={{ fontWeight: 600 }}
            />
          );
        })}
      </Box>

      {/* ── Period totals ────────────────────────── */}
      <Box
        component="section"
        aria-label="Totales del período"
        sx={(theme) => ({
          p: 1.5,
          mb: 3,
          borderRadius: '16px',
          bgcolor: 'surfaceContainerLow',
          border: '1px solid',
          borderColor: alpha(theme.palette.outlineVariant, 0.7),
        })}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(3, minmax(0, 1fr))' },
            gap: { xs: 1.25, sm: 2 },
          }}
        >
          <PeriodTotal label="Ingresos" value={fmtMoney(totals.in)} color="success.main" />
          <PeriodTotal label="Egresos" value={fmtMoney(totals.out)} color="error.main" />
          <PeriodTotal
            label="Neto"
            value={fmtSignedMoney(totals.net)}
            color={totals.net >= 0 ? 'success.main' : 'error.main'}
          />
        </Box>
      </Box>

      {/* ── Movements ────────────────────────────── */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 1,
          mb: 1.5,
          px: 0.5,
        }}
      >
        <Typography variant="overline" component="h2" sx={{ color: 'onSurfaceVariant' }}>
          Movimientos
        </Typography>
        <Typography
          variant="caption"
          component="span"
          sx={{ color: 'onSurfaceVariant', fontFamily: 'var(--font-mono)', fontWeight: 700 }}
        >
          {total} en total
        </Typography>
      </Box>

      {movementsQuery.isLoading ? (
        <LoadingState label="Cargando movimientos…" minHeight={240} />
      ) : movements.length === 0 ? (
        <EmptyState
          icon={<IconInbox size={30} />}
          title="Sin movimientos en este período."
          subtitle="Probá con otro rango de fechas."
        />
      ) : (
        groups.map((group) => (
          <Box key={group.key} component="section" aria-label={dayLabel(group.key)} sx={{ mb: 2.5 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1,
                mb: 1,
                px: 0.5,
              }}
            >
              <Typography
                variant="caption"
                component="div"
                sx={{
                  color: 'onSurfaceVariant',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                {dayLabel(group.key)}
              </Typography>
              <Typography
                variant="caption"
                component="span"
                sx={{
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                  color: group.net >= 0 ? 'success.main' : 'error.main',
                  whiteSpace: 'nowrap',
                }}
              >
                {fmtSignedMoney(group.net)}
              </Typography>
            </Box>

            <MuiCard
              variant="outlined"
              sx={{
                p: 0,
                '& .MuiCardContent-root': { p: 0, '&:last-child': { pb: 0 } },
              }}
            >
              {group.movements.map((movement, index) => (
                <MovementRow
                  key={movement.id}
                  movement={movement}
                  divided={index < group.movements.length - 1}
                />
              ))}
            </MuiCard>
          </Box>
        ))
      )}

      {/* ── Pagination ───────────────────────────── */}
      {!movementsQuery.isLoading && total > PAGE_SIZE && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1.5,
            flexWrap: 'wrap',
            mt: 3,
          }}
        >
          <MuiButton
            variant="secondary"
            size="sm"
            startIcon={<IconArrowLeft size={16} />}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={page <= 1}
          >
            Anterior
          </MuiButton>
          <Typography
            variant="caption"
            component="span"
            sx={{
              color: 'onSurfaceVariant',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              textAlign: 'center',
              flexGrow: 1,
            }}
          >
            Mostrando {rangeStart}–{rangeEnd} de {total}
          </Typography>
          <MuiButton
            variant="secondary"
            size="sm"
            endIcon={<IconChevronRight size={16} />}
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={page >= totalPages}
          >
            Siguiente
          </MuiButton>
        </Box>
      )}
    </Box>
  );
}

/* ── Sub-components ──────────────────────────── */

function PeriodTotal({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        variant="caption"
        component="div"
        sx={{
          color: 'onSurfaceVariant',
          fontSize: '0.6875rem',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Typography>
      <Typography
        variant="titleSmall"
        component="div"
        sx={{
          mt: 0.25,
          fontFamily: 'var(--font-mono)',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color,
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

function MovementRow({ movement, divided }: { movement: CashMovement; divided: boolean }) {
  const meta = MOVEMENT_TYPE_META[movement.type];
  const isIn = movement.amount >= 0;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        px: { xs: 1.5, sm: 2 },
        py: 1.5,
        minWidth: 0,
        borderBottom: divided ? '1px solid' : 'none',
        borderColor: 'divider',
      }}
    >
      <Box
        sx={(theme) => ({
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: '12px',
          flexShrink: 0,
          bgcolor: alpha(toneMain(theme, meta.tone), 0.14),
          color: toneMain(theme, meta.tone),
        })}
      >
        {meta.icon}
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          variant="body2"
          component="div"
          noWrap
          sx={{ fontWeight: 600, color: 'onSurface', lineHeight: 1.35 }}
        >
          {movement.description}
        </Typography>
        <Typography
          variant="caption"
          component="div"
          noWrap
          sx={{ color: 'onSurfaceVariant', lineHeight: 1.4 }}
        >
          {fmtTime(movement.date)} · {meta.label}
        </Typography>
      </Box>

      <Typography
        variant="body2"
        component="div"
        sx={{
          fontFamily: 'var(--font-mono)',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: isIn ? 'success.main' : 'error.main',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {fmtSignedMoney(movement.amount)}
      </Typography>
    </Box>
  );
}
