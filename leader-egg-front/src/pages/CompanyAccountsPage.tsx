import { type ReactNode } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { alpha, type Theme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import Link from '@mui/material/Link';
import { useCashSummary, usePuntoCero } from '../hooks/queries/index.ts';
import { useAuthStore } from '../stores/authStore.ts';
import {
  PageHeader,
  MuiButton,
  LoadingState,
} from '../components/ui/index.ts';
import {
  IconWallet,
  IconMoney,
  IconQrCode,
  IconBank,
  IconInfo,
  IconRefresh,
  IconTune,
  IconChart,
  IconCalendar,
  IconCircleCheck,
  IconChevronRight,
  IconLock,
  IconSettings,
} from '../components/ui/icons.tsx';
import { m3Shape } from '../theme/index.ts';
import { AccountsTabs } from '../components/accounts/AccountsTabs.tsx';
import type { MoneyAccount } from '../types/index.ts';

/* ── Helpers ─────────────────────────────────── */

const fmtMoney = (n: number) => `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

/**
 * Compact formatter for the consolidated mini tiles only.
 * The full amount would not fit three columns on mobile:
 * 1_950_000 → "$ 1,95M" · 509_000 → "$ 509K" · 0 → "$ 0,00".
 */
const fmtCompactMoney = (n: number): string => {
  if (n === 0) return '$ 0,00';

  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const compact = (value: number, suffix: string) =>
    `$ ${sign}${value.toLocaleString('es-AR', { maximumFractionDigits: 2 })}${suffix}`;

  if (abs >= 1_000_000) return compact(abs / 1_000_000, 'M');
  if (abs >= 1_000) return compact(Math.round(abs / 1_000), 'K');
  return fmtMoney(n);
};

/** ISO timestamp → DD/MM/YYYY for the "Cargado el ..." caption. */
const fmtLockedDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
};

type AccountTone = 'success' | 'info' | 'warning';

interface AccountMeta {
  key: MoneyAccount;
  label: string;
  subtitle: string;
  icon: ReactNode;
  chipBg: string;
  chipFg: string;
  /** Accent used by the SALDO ACTUAL label and the card hover border. */
  tone: AccountTone;
}

/** The three company money accounts shown on this page, in display order. */
const ACCOUNT_META: AccountMeta[] = [
  {
    key: 'cash',
    label: 'Efectivo',
    subtitle: 'Caja principal y cobranzas',
    icon: <IconMoney size={22} />,
    chipBg: 'successContainer',
    chipFg: 'onSuccessContainer',
    tone: 'success',
  },
  {
    key: 'mp',
    label: 'Mercado Pago',
    subtitle: 'Cobros QR y transferencias',
    icon: <IconQrCode size={22} />,
    chipBg: 'infoContainer',
    chipFg: 'onInfoContainer',
    tone: 'info',
  },
  {
    key: 'bank',
    label: 'Banco',
    subtitle: 'Cuenta corriente bancaria',
    icon: <IconBank size={22} />,
    chipBg: 'warningContainer',
    chipFg: 'onWarningContainer',
    tone: 'warning',
  },
];

const toneColor = (theme: Theme, tone: AccountTone): string =>
  tone === 'success'
    ? theme.palette.success.main
    : tone === 'info'
      ? theme.palette.info.main
      : theme.palette.warning.main;

/* ── Mini balance tile ─────────────────────────
   Compact amount inside the consolidated card. Labels are intentionally
   terse so the three columns survive a 360px viewport. */

function MiniBalance({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'success' | 'info' | 'neutral';
}) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        variant="caption"
        component="div"
        noWrap
        sx={{
          color: 'onSurfaceVariant',
          fontSize: '0.6875rem',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          lineHeight: 1.4,
        }}
      >
        {label}
      </Typography>
      <Typography
        component="div"
        noWrap
        sx={(theme) => ({
          mt: 0.25,
          fontFamily: 'var(--font-mono)',
          fontWeight: 800,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.01em',
          fontSize: { xs: '0.9rem', sm: '0.975rem' },
          color:
            tone === 'success'
              ? theme.palette.success.main
              : tone === 'info'
                ? theme.palette.info.main
                : theme.palette.onSurface,
        })}
      >
        {fmtCompactMoney(value)}
      </Typography>
    </Box>
  );
}

/* ── Consolidated balance card ─────────────────
   The page's single hero number: total across every account, with a
   quiet per-account breakdown underneath. */

function ConsolidatedBalance({
  accounts,
}: {
  accounts: { cash: number; mp: number; bank: number; total: number };
}) {
  return (
    <Box
      component="section"
      aria-label="Saldo consolidado total"
      sx={(theme) => ({
        p: { xs: 2, sm: 2.5 },
        mb: 3,
        borderRadius: '20px',
        border: '1px solid',
        borderColor: alpha(theme.palette.outlineVariant, 0.65),
        background: `linear-gradient(135deg, ${theme.palette.surfaceContainer} 0%, ${theme.palette.surfaceContainerHigh} 100%)`,
      })}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          flexWrap: 'wrap',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', color: 'onSurfaceVariant', flexShrink: 0 }}>
            <IconChart size={18} />
          </Box>
          <Typography
            variant="caption"
            component="span"
            sx={{
              fontSize: '0.6875rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'onSurfaceVariant',
            }}
          >
            Saldo Consolidado Total
          </Typography>
        </Box>

        <Box
          component="span"
          sx={(theme) => ({
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            px: 1.25,
            py: 0.4,
            borderRadius: m3Shape.full,
            bgcolor: alpha(theme.palette.success.main, 0.12),
            color: theme.palette.success.main,
            fontSize: '0.6875rem',
            fontWeight: 700,
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          })}
        >
          <Box
            component="span"
            aria-hidden="true"
            sx={(theme) => ({
              width: 7,
              height: 7,
              borderRadius: '50%',
              bgcolor: 'success.main',
              '@keyframes consolidatedPulse': {
                '0%': { boxShadow: `0 0 0 0 ${alpha(theme.palette.success.main, 0.5)}` },
                '70%': { boxShadow: `0 0 0 5px ${alpha(theme.palette.success.main, 0)}` },
                '100%': { boxShadow: `0 0 0 0 ${alpha(theme.palette.success.main, 0)}` },
              },
              animation: 'consolidatedPulse 2s ease-out infinite',
              '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
            })}
          />
          En línea
        </Box>
      </Box>

      <Typography
        component="div"
        sx={{
          mt: 1.5,
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
        {fmtMoney(accounts.total)}
      </Typography>

      <Divider sx={{ my: 2, borderColor: 'outlineVariant' }} />

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: { xs: 1, sm: 2 },
        }}
      >
        <MiniBalance label="Efectivo" value={accounts.cash} tone="success" />
        <MiniBalance label="Mercado Pago" value={accounts.mp} tone="info" />
        <MiniBalance label="Banco" value={accounts.bank} tone="neutral" />
      </Box>
    </Box>
  );
}

/* ── Status badge ────────────────────────────── */

type AccountStatus = 'locked' | 'digital' | 'empty' | 'active';

function AccountStatusBadge({ status }: { status: AccountStatus }) {
  const isActive = status === 'active';

  return (
    <Box
      component="span"
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        py: 0.4,
        borderRadius: m3Shape.full,
        fontSize: '0.6875rem',
        fontWeight: 700,
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        ...(status === 'digital' && {
          bgcolor: 'infoContainer',
          color: 'onInfoContainer',
        }),
        ...(isActive && {
          bgcolor: alpha(theme.palette.success.main, 0.14),
          color: theme.palette.success.main,
        }),
        ...((status === 'locked' || status === 'empty') && {
          bgcolor: 'surfaceContainerHigh',
          color: 'onSurfaceVariant',
        }),
      })}
    >
      {status === 'locked' && <IconLock size={12} />}
      {isActive && (
        <Box
          component="span"
          aria-hidden="true"
          sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'success.main' }}
        />
      )}
      {status === 'locked' && 'Bloqueado'}
      {status === 'digital' && 'Digital'}
      {status === 'empty' && 'Sin saldo'}
      {status === 'active' && 'Operativa'}
    </Box>
  );
}

/* ── Account card ──────────────────────────────
   Current balance leads; the one-time opening balance is a read-only
   detail, visible only to users who can read the setup endpoint. Editing
   lives in Settings → Empresa. */

function AccountCard({
  meta,
  current,
  opening,
  lockedAt,
  showOpening,
  onViewMovements,
}: {
  meta: AccountMeta;
  current: number;
  opening: number | null;
  /** Non-null once the opening balance was loaded — the account is read-only. */
  lockedAt: string | null;
  /** False for accounts.view users, who cannot read the setup endpoint. */
  showOpening: boolean;
  onViewMovements: () => void;
}) {
  const status: AccountStatus = lockedAt
    ? 'locked'
    : meta.key === 'mp'
      ? 'digital'
      : current === 0
        ? 'empty'
        : 'active';

  return (
    <Box
      component="section"
      aria-label={meta.label}
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        p: 2,
        height: '100%',
        minWidth: 0,
        borderRadius: '20px',
        bgcolor: 'surfaceContainer',
        border: '1px solid',
        borderColor: alpha(theme.palette.outlineVariant, 0.7),
        transition: 'border-color 180ms cubic-bezier(0.2, 0, 0, 1)',
        '&:hover': {
          borderColor: alpha(toneColor(theme, meta.tone), 0.5),
        },
      })}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 44,
              height: 44,
              borderRadius: '14px',
              bgcolor: meta.chipBg,
              color: meta.chipFg,
              flexShrink: 0,
            }}
          >
            {meta.icon}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="titleMedium"
              component="div"
              sx={{ fontWeight: 700, color: 'onSurface', lineHeight: 1.25 }}
            >
              {meta.label}
            </Typography>
            <Typography
              variant="caption"
              component="div"
              noWrap
              sx={{
                color: 'onSurfaceVariant',
                fontSize: '0.6875rem',
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              {meta.subtitle}
            </Typography>
          </Box>
        </Box>
        <AccountStatusBadge status={status} />
      </Box>

      <Box sx={{ minWidth: 0 }}>
        <Typography
          variant="caption"
          component="div"
          sx={(theme) => ({
            fontSize: '0.6875rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: toneColor(theme, meta.tone),
          })}
        >
          Saldo actual
        </Typography>
        <Typography
          component="div"
          noWrap
          sx={(theme) => ({
            fontFamily: 'var(--font-mono)',
            fontWeight: 800,
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '-0.02em',
            lineHeight: 1.15,
            fontSize: { xs: '1.5rem', sm: '1.75rem' },
            color: current === 0 ? theme.palette.onSurfaceVariant : theme.palette.onSurface,
            opacity: current === 0 ? 0.7 : 1,
          })}
        >
          {fmtMoney(current)}
        </Typography>
      </Box>

      {showOpening && (
        <>
          <Divider sx={{ borderColor: 'outlineVariant' }} />

          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="caption"
              component="div"
              sx={{ color: 'onSurfaceVariant', fontWeight: 600 }}
            >
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
            {lockedAt && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                  flexWrap: 'wrap',
                  mt: 0.5,
                }}
              >
                <Box sx={{ display: 'flex', color: 'onSurfaceVariant', flexShrink: 0 }}>
                  <IconCalendar size={12} />
                </Box>
                <Typography variant="caption" color="onSurfaceVariant">
                  Cargado el {fmtLockedDate(lockedAt)}
                </Typography>
                <Box
                  component="span"
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.25,
                    color: 'success.main',
                    fontWeight: 700,
                    fontSize: '0.6875rem',
                    letterSpacing: '0.02em',
                  }}
                >
                  <IconCircleCheck size={12} />
                  Conciliado
                </Box>
              </Box>
            )}
          </Box>
        </>
      )}

      <Box
        sx={{
          mt: 'auto',
          pt: 1.5,
          borderTop: 1,
          borderColor: 'outlineVariant',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          flexWrap: 'wrap',
        }}
      >
        <MuiButton
          variant="ghost"
          size="sm"
          endIcon={<IconChevronRight size={16} />}
          onClick={onViewMovements}
          sx={{
            px: 0.5,
            color: 'onSurfaceVariant',
            '&:hover': { color: 'onSurface', bgcolor: 'surfaceContainerHigh' },
          }}
        >
          Ver movimientos
        </MuiButton>
      </Box>
    </Box>
  );
}

/* ── One-time lock notice ──────────────────────
   Keeps the existing explanation and turns "Ajustar caja" into a real
   route to the cash screen instead of plain text. */

function NoticeCard() {
  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1,
        p: 1.5,
        borderRadius: '16px',
        bgcolor: 'surfaceContainerLow',
        border: '1px solid',
        borderColor: alpha(theme.palette.outlineVariant, 0.7),
      })}
    >
      <Box sx={{ display: 'flex', color: 'onSurfaceVariant', mt: '1px', flexShrink: 0 }}>
        <IconInfo size={16} />
      </Box>
      <Typography
        variant="caption"
        component="p"
        sx={{ color: 'onSurfaceVariant', lineHeight: 1.5, m: 0 }}
      >
        El saldo inicial se carga una sola vez: una vez guardado, la cuenta queda bloqueada. Para
        correcciones del día a día usá{' '}
        <Link
          component={RouterLink}
          to="/cuentas/movimientos"
          underline="always"
          sx={{
            color: 'primary.main',
            fontWeight: 700,
            textUnderlineOffset: '2px',
            '&:hover': { color: 'primary.dark' },
          }}
        >
          Ajustar caja
        </Link>{' '}
        en la pantalla de Caja, que deja registro.
      </Typography>
    </Box>
  );
}

/* ── CompanyAccountsPage ─────────────────────── */

export function CompanyAccountsPage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((state) => state.hasPermission);
  // The setup endpoint requires `config.manage`. Users with only `accounts.view`
  // must not call it: the 403 would surface as an unactionable error banner.
  const canManageConfig = hasPermission('config.manage');

  const summaryQuery = useCashSummary();
  const accounts = summaryQuery.data?.accounts ?? { cash: 0, mp: 0, bank: 0, total: 0 };

  const puntoCeroQuery = usePuntoCero(canManageConfig);
  const openingBalances = canManageConfig ? puntoCeroQuery.data?.openingBalances ?? null : null;
  const setAt = canManageConfig ? puntoCeroQuery.data?.openingBalancesSetAt ?? null : null;

  const readError = summaryQuery.error
    ? summaryQuery.error instanceof Error
      ? summaryQuery.error.message
      : 'Error al cargar los saldos'
    : canManageConfig && puntoCeroQuery.error
      ? puntoCeroQuery.error instanceof Error
        ? puntoCeroQuery.error.message
        : 'Error al cargar los saldos iniciales'
      : null;

  const refresh = () => {
    void summaryQuery.refetch();
    if (canManageConfig) void puntoCeroQuery.refetch();
  };

  if (summaryQuery.isLoading) {
    return (
      <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
        <AccountsTabs />
        <LoadingState label="Cargando cuentas…" />
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
      <AccountsTabs />

      <PageHeader
        title="Cuentas de la Empresa"
        subtitle="Efectivo, Mercado Pago y saldos bancarios"
        icon={<IconWallet size={24} />}
      />

      {/* Quick actions */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 3 }}>
        <MuiButton
          variant="secondary"
          size="sm"
          startIcon={<IconRefresh size={16} />}
          onClick={refresh}
          sx={{ borderRadius: m3Shape.full }}
        >
          Actualizar
        </MuiButton>
        <MuiButton
          variant="secondary"
          size="sm"
          startIcon={<IconTune size={16} />}
          onClick={() => navigate('/cuentas/movimientos')}
          sx={{ borderRadius: m3Shape.full }}
        >
          Ajustar Caja
        </MuiButton>
        {canManageConfig && (
          <MuiButton
            variant="secondary"
            size="sm"
            startIcon={<IconSettings size={16} />}
            onClick={() => navigate('/settings')}
            sx={{ borderRadius: m3Shape.full }}
          >
            Configurar en Ajustes
          </MuiButton>
        )}
      </Box>

      {readError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {readError}
        </Alert>
      )}

      <ConsolidatedBalance accounts={accounts} />

      {/* Per-account cards — current balance + read-only opening balance */}
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            sm: 'repeat(2, minmax(0, 1fr))',
            md: 'repeat(3, minmax(0, 1fr))',
          },
          mb: 3,
        }}
      >
        {ACCOUNT_META.map((meta) => (
          <AccountCard
            key={meta.key}
            meta={meta}
            current={accounts[meta.key]}
            opening={openingBalances ? openingBalances[meta.key] : null}
            lockedAt={setAt?.[meta.key] ?? null}
            showOpening={canManageConfig}
            onViewMovements={() => navigate(`/cuentas/${meta.key}`)}
          />
        ))}
      </Box>

      <NoticeCard />
    </Box>
  );
}
