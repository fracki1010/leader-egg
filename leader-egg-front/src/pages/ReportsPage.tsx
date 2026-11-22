import { useState } from 'react';
import type { ReactNode } from 'react';
import { useRevenueReport, useProfitReport } from '../hooks/queries/index.ts';
import type { SalesChannel } from '../types/index.ts';
import { MuiTextField, PageHeader, LoadingState } from '../components/ui/index.ts';
import { toLocalDate } from '../lib/date.ts';
import {
  IconReport,
  IconFilter,
  IconExpandMore,
  IconPayments,
  IconTrendingUp,
  IconCheck,
  IconCalendar,
  IconReceiptLong,
  IconTruck,
  IconWhatsapp,
  IconStorefront,
  IconBox,
  IconEgg,
  IconCreditCard,
  IconUsers,
  IconInbox,
  IconMoney,
  IconQrCode,
} from '../components/ui/icons.tsx';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import ToggleButton from '@mui/material/ToggleButton';
import Collapse from '@mui/material/Collapse';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';

/* ── Types ───────────────────────────────────── */

type ReportTab = 'revenue' | 'profit';
type RangeMode = 'range' | 'day';
/** Profit accounting basis: accrual (billed) or cash (actually collected). */
type ProfitBasis = 'accrual' | 'cash';

/* ── Shared style fragments ──────────────────── */

/** Numbers/data: mono + tabular so columns never jitter. */
const MONO = {
  fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums',
} as const;

/** Small uppercase metadata label (KPI labels, section meta, table heads). */
const LABEL = {
  fontSize: '0.6875rem',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  lineHeight: 1.2,
} as const;

const HEAD_CELL = {
  ...LABEL,
  color: 'onSurfaceVariant',
  whiteSpace: 'nowrap',
  py: 1,
  px: 1,
} as const;

const NUM_CELL = {
  ...MONO,
  whiteSpace: 'nowrap',
} as const;

/* ── Helpers ─────────────────────────────────── */

const formatCurrency = (n: number) =>
  `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' (business calendar date, no timezone math). */
const formatReportDate = (date: string) => date.split('-').reverse().join('/');

/** Share of a total, one decimal, safe when the total is zero. */
const percentOf = (amount: number, total: number) => (total > 0 ? (amount / total) * 100 : 0);

const pluralize = (n: number, singular: string, plural: string) =>
  `${n} ${n === 1 ? singular : plural}`;

const SALES_CHANNEL_LABELS: Record<SalesChannel, string> = {
  reparto: 'Reparto',
  puesto: 'Puesto',
  whatsapp: 'WhatsApp',
  otro: 'Otro',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  check: 'Cheque',
};

const getDefaultDateRange = (): { start: string; end: string } => {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    start: toLocalDate(firstDay),
    end: toLocalDate(now),
  };
};

/* ── Quick date presets ──────────────────────── */

type DatePreset = 'today' | 'yesterday' | '7d' | 'month' | '90d';

const DATE_PRESETS: Array<{ id: DatePreset; label: string }> = [
  { id: 'today', label: 'Hoy' },
  { id: 'yesterday', label: 'Ayer' },
  { id: '7d', label: '7 días' },
  { id: 'month', label: 'Mes' },
  { id: '90d', label: '90 días' },
];

/** Local-calendar day shifted by `days` (negative = past). */
const shiftDays = (base: Date, days: number): Date =>
  new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);

/**
 * Resolves a preset to a LOCAL calendar range. Single-day presets (Hoy/Ayer)
 * also tell the caller to switch the profit tab to "Día" mode.
 */
const presetRange = (
  preset: DatePreset,
  now: Date,
): { start: string; end: string; singleDay: boolean } => {
  switch (preset) {
    case 'today': {
      const d = toLocalDate(now);
      return { start: d, end: d, singleDay: true };
    }
    case 'yesterday': {
      const d = toLocalDate(shiftDays(now, -1));
      return { start: d, end: d, singleDay: true };
    }
    case '7d':
      return { start: toLocalDate(shiftDays(now, -6)), end: toLocalDate(now), singleDay: false };
    case 'month': {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: toLocalDate(first), end: toLocalDate(now), singleDay: false };
    }
    case '90d':
      return { start: toLocalDate(shiftDays(now, -89)), end: toLocalDate(now), singleDay: false };
  }
};

/* ── Local presentational components ─────────── */

interface MoneyValueProps {
  value: number;
  /** Integer-part font size in px (cents render smaller). */
  size?: number;
  color?: string;
}

/**
 * MoneyValue — splits "$ 1.234,56" so the cents read as a quiet suffix.
 * WHY: the hero number should carry the magnitude; cents stay legible
 * but never compete with the integer part.
 */
function MoneyValue({ value, size = 30, color }: MoneyValueProps) {
  const [whole = '', cents = '00'] = formatCurrency(value).split(',');
  return (
    <Box component="span" sx={{ ...MONO, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.05 }}>
      <Box component="span" sx={{ fontSize: `${size}px` }}>{whole}</Box>
      <Box
        component="span"
        sx={{
          fontSize: `${Math.max(12, Math.round(size * 0.52))}px`,
          color: color ?? 'onSurfaceVariant',
          opacity: color ? 0.75 : 0.9,
        }}
      >
        ,{cents}
      </Box>
    </Box>
  );
}

interface KpiCardProps {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  caption?: ReactNode;
  captionIcon?: ReactNode;
  captionColor?: string;
  /** Surface override (e.g. success/error container for the net result). */
  bg?: string;
  /** Foreground for label/caption and the default value color. */
  fg?: string;
  valueColor?: string;
  /** Columns spanned on xs (default 12) and sm+. */
  xs?: number;
  sm: number;
}

/** KpiCard — flat tonal stat card on the 12-column grid. */
function KpiCard({
  label,
  value,
  icon,
  caption,
  captionIcon,
  captionColor,
  bg,
  fg,
  valueColor,
  xs = 12,
  sm,
}: KpiCardProps) {
  return (
    <Box
      sx={{
        gridColumn: { xs: `span ${xs}`, sm: `span ${sm}` },
        bgcolor: bg ?? 'surfaceContainer',
        borderRadius: '24px',
        border: 1,
        borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.3),
        p: 2,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          color: fg ?? 'onSurfaceVariant',
        }}
      >
        <Typography component="p" sx={{ ...LABEL, color: 'inherit' }}>{label}</Typography>
        {icon && <Box sx={{ display: 'flex', flexShrink: 0 }}>{icon}</Box>}
      </Box>
      <Box sx={{ color: valueColor ?? fg ?? 'onSurface', lineHeight: 1.1, minWidth: 0 }}>{value}</Box>
      {caption && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            color: captionColor ?? fg ?? 'onSurfaceVariant',
          }}
        >
          {captionIcon}
          <Typography component="p" sx={{ fontSize: '0.6875rem', fontWeight: 600, lineHeight: 1.3 }}>
            {caption}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

interface SectionCardProps {
  icon: ReactNode;
  title: string;
  /** Small right-aligned meta label ("3 canales activos", "Liquidado"…). */
  meta?: ReactNode;
  children: ReactNode;
}

/** SectionCard — one flat 24px card per report section, shared header row. */
function SectionCard({ icon, title, meta, children }: SectionCardProps) {
  return (
    <Box
      component="section"
      sx={{
        bgcolor: 'surfaceContainer',
        borderRadius: '24px',
        border: 1,
        borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.3),
        p: 2,
        minWidth: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, minWidth: 0 }}>
        <Box sx={{ display: 'flex', flexShrink: 0, color: 'primary.main' }}>{icon}</Box>
        <Typography
          component="h2"
          sx={{ ...LABEL, color: 'onSurface', fontSize: '0.75rem', minWidth: 0 }}
        >
          {title}
        </Typography>
        {meta && (
          <Typography
            component="span"
            sx={{
              ml: 'auto',
              flexShrink: 0,
              fontSize: '0.6875rem',
              fontWeight: 600,
              color: 'onSurfaceVariant',
              whiteSpace: 'nowrap',
            }}
          >
            {meta}
          </Typography>
        )}
      </Box>
      {children}
    </Box>
  );
}

/** In-card empty state (keeps the section frame, never a bare line). */
function SectionEmpty({ message = 'Sin datos en este período.' }: { message?: string }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        py: 3,
        px: 2,
        borderRadius: '16px',
        bgcolor: 'surfaceContainerHigh',
        color: 'onSurfaceVariant',
      }}
    >
      <IconInbox size={16} />
      <Typography component="p" sx={{ fontSize: '0.75rem', fontWeight: 600 }}>
        {message}
      </Typography>
    </Box>
  );
}

interface ProgressBarProps {
  /** Percentage 0–100 (clamped). */
  value: number;
  fill: string | ((theme: Theme) => string);
}

/** ProgressBar — 6px pill track, proportional accent fill. */
function ProgressBar({ value, fill }: ProgressBarProps) {
  const width = Math.min(100, Math.max(0, value));
  return (
    <Box
      role="presentation"
      sx={{
        height: 6,
        borderRadius: '999px',
        bgcolor: 'surfaceContainerHighest',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          width: `${width}%`,
          height: '100%',
          borderRadius: '999px',
          bgcolor: fill,
          transition: 'width 300ms ease',
        }}
      />
    </Box>
  );
}

type ChannelVisual = {
  icon: ReactNode;
  tileBg: (theme: Theme) => string;
  tileColor: string;
  bar: (theme: Theme) => string;
};

/** Per-channel accent: reparto blue-ish, whatsapp emerald, puesto/otro neutral. */
const channelVisual = (canal: string): ChannelVisual => {
  switch (canal) {
    case 'reparto':
      return {
        icon: <IconTruck size={16} />,
        tileBg: (theme) => alpha(theme.palette.info.main, 0.16),
        tileColor: 'info.main',
        bar: (theme) => theme.palette.info.main,
      };
    case 'whatsapp':
      return {
        icon: <IconWhatsapp size={16} />,
        tileBg: (theme) => alpha(theme.palette.success.main, 0.16),
        tileColor: 'success.main',
        bar: (theme) => theme.palette.success.main,
      };
    case 'puesto':
      return {
        icon: <IconStorefront size={16} />,
        tileBg: (theme) => alpha(theme.palette.outlineVariant, 0.35),
        tileColor: 'onSurfaceVariant',
        bar: (theme) => theme.palette.outline,
      };
    default:
      return {
        icon: <IconBox size={16} />,
        tileBg: (theme) => alpha(theme.palette.outlineVariant, 0.35),
        tileColor: 'onSurfaceVariant',
        bar: (theme) => theme.palette.outline,
      };
  }
};

interface ChannelRowProps {
  canal: string;
  orders: number;
  amount: number;
  percentage: number;
}

/** ChannelRow — nested surfaceContainerHigh card with a proportional meter. */
function ChannelRow({ canal, orders, amount, percentage }: ChannelRowProps) {
  const visual = channelVisual(canal);
  return (
    <Box
      sx={{
        bgcolor: 'surfaceContainerHigh',
        borderRadius: '16px',
        p: 1.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        minWidth: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: '10px',
            bgcolor: visual.tileBg,
            color: visual.tileColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {visual.icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            component="p"
            sx={{ fontSize: '0.8125rem', fontWeight: 700, color: 'onSurface', lineHeight: 1.25 }}
          >
            {SALES_CHANNEL_LABELS[canal as SalesChannel] ?? canal}
          </Typography>
          <Typography component="p" sx={{ fontSize: '0.6875rem', color: 'onSurfaceVariant' }}>
            {pluralize(orders, 'orden', 'órdenes')}
          </Typography>
        </Box>
        <Box sx={{ ml: 'auto', textAlign: 'right', flexShrink: 0 }}>
          <Typography component="p" sx={{ ...MONO, fontSize: '0.875rem', fontWeight: 700, color: 'onSurface' }}>
            {formatCurrency(amount)}
          </Typography>
          <Typography
            component="p"
            sx={{ ...MONO, fontSize: '0.6875rem', fontWeight: 600, color: 'onSurfaceVariant' }}
          >
            {percentage.toFixed(1)}%
          </Typography>
        </Box>
      </Box>
      <ProgressBar value={percentage} fill={visual.bar} />
    </Box>
  );
}

interface ProductRowProps {
  name: string;
  quantity: number;
  amount: number;
  percentage: number;
}

/** ProductRow — egg-accent row with amount + share, hairline separators. */
function ProductRow({ name, quantity, amount, percentage }: ProductRowProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        py: 1.25,
        minWidth: 0,
        '&:not(:last-of-type)': {
          borderBottom: 1,
          borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.2),
        },
      }}
    >
      <Box
        sx={{
          width: 32,
          height: 32,
          borderRadius: '10px',
          bgcolor: (theme) => alpha(theme.palette.primary.main, 0.14),
          color: 'primary.main',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <IconEgg size={16} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography
          component="p"
          sx={{
            fontSize: '0.8125rem',
            fontWeight: 700,
            color: 'onSurface',
            lineHeight: 1.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </Typography>
        <Typography component="p" sx={{ fontSize: '0.6875rem', color: 'onSurfaceVariant' }}>
          {quantity.toLocaleString('es-AR')} unidades
        </Typography>
      </Box>
      <Box sx={{ ml: 'auto', textAlign: 'right', flexShrink: 0 }}>
        <Typography component="p" sx={{ ...MONO, fontSize: '0.875rem', fontWeight: 700, color: 'onSurface' }}>
          {formatCurrency(amount)}
        </Typography>
        <Typography
          component="p"
          sx={{ ...MONO, fontSize: '0.6875rem', fontWeight: 600, color: 'onSurfaceVariant' }}
        >
          {percentage.toFixed(1)}%
        </Typography>
      </Box>
    </Box>
  );
}

/** Initials for the customer avatar ("María López" → "ML"). */
const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? parts[1]?.[0] ?? '' : '';
  return (first + second).toUpperCase() || '?';
};

interface CustomerRowProps {
  name: string;
  orderCount: number;
  amount: number;
}

/** CustomerRow — compact row with a 28px initials avatar. */
function CustomerRow({ name, orderCount, amount }: CustomerRowProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 1, minWidth: 0 }}>
      <Box
        aria-hidden="true"
        sx={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          bgcolor: 'primaryContainer',
          color: 'onPrimaryContainer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.625rem',
          fontWeight: 700,
          letterSpacing: '0.02em',
          flexShrink: 0,
        }}
      >
        {initialsOf(name)}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography
          component="p"
          sx={{
            fontSize: '0.8125rem',
            fontWeight: 600,
            color: 'onSurface',
            lineHeight: 1.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </Typography>
        <Typography component="p" sx={{ fontSize: '0.6875rem', color: 'onSurfaceVariant' }}>
          {pluralize(orderCount, 'orden', 'órdenes')}
        </Typography>
      </Box>
      <Typography
        component="p"
        sx={{ ...MONO, ml: 'auto', flexShrink: 0, fontSize: '0.8125rem', fontWeight: 700, color: 'onSurface' }}
      >
        {formatCurrency(amount)}
      </Typography>
    </Box>
  );
}

const paymentMethodIcon = (method: string): ReactNode => {
  switch (method) {
    case 'cash':
      return <IconMoney size={16} />;
    case 'transfer':
      return <IconQrCode size={16} />;
    default:
      return <IconReceiptLong size={16} />;
  }
};

interface PaymentMethodCardProps {
  method: string;
  amount: number;
  percentage: number;
}

/** PaymentMethodCard — small nested card: icon, method, amount, share. */
function PaymentMethodCard({ method, amount, percentage }: PaymentMethodCardProps) {
  return (
    <Box
      sx={{
        bgcolor: 'surfaceContainerHigh',
        borderRadius: '16px',
        p: 1.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
        minWidth: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', flexShrink: 0, color: 'primary.main' }}>{paymentMethodIcon(method)}</Box>
        <Typography
          component="p"
          sx={{ ...LABEL, color: 'onSurfaceVariant', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {PAYMENT_METHOD_LABELS[method] ?? method}
        </Typography>
      </Box>
      <Typography component="p" sx={{ ...MONO, fontSize: '0.9375rem', fontWeight: 700, color: 'onSurface' }}>
        {formatCurrency(amount)}
      </Typography>
      <Typography component="p" sx={{ fontSize: '0.6875rem', fontWeight: 600, color: 'onSurfaceVariant' }}>
        {percentage.toFixed(1)}% del total
      </Typography>
    </Box>
  );
}

/** Compact label/value pair used by the "Por cobrar" summary block. */
function ReceivableMetric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography component="p" sx={{ ...LABEL, fontSize: '0.625rem', color: 'onSurfaceVariant', mb: 0.5 }}>
        {label}
      </Typography>
      <Typography
        component="p"
        sx={{ ...MONO, fontSize: '0.8125rem', fontWeight: 700, color: color ?? 'onSurface' }}
      >
        {value}
      </Typography>
    </Box>
  );
}

/** MarginCard — wide card with the big margin percentage and a meter. */
function MarginCard({ margin }: { margin: number }) {
  const tone = margin >= 20 ? 'success.main' : margin >= 10 ? 'warning.main' : 'error.main';
  return (
    <Box
      sx={{
        bgcolor: 'surfaceContainer',
        borderRadius: '24px',
        border: 1,
        borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.3),
        p: 2,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2, mb: 1.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography component="p" sx={{ ...LABEL, color: 'onSurfaceVariant' }}>
            Margen de ganancia
          </Typography>
          <Typography component="p" sx={{ fontSize: '0.75rem', color: 'onSurfaceVariant', mt: 0.5 }}>
            Ganancia sobre los ingresos del período
          </Typography>
        </Box>
        <Typography
          component="p"
          sx={{ ...MONO, fontSize: '34px', fontWeight: 700, lineHeight: 1, color: tone, flexShrink: 0 }}
        >
          {margin.toFixed(1)}%
        </Typography>
      </Box>
      <ProgressBar value={margin} fill={tone} />
    </Box>
  );
}

/* ── ReportsPage ─────────────────────────────── */

export function ReportsPage() {
  const defaults = getDefaultDateRange();
  const [tab, setTab] = useState<ReportTab>('revenue');
  const [rangeMode, setRangeMode] = useState<RangeMode>('range');
  // Accrual stays the default: the cash view is an additive lens on the same
  // period and switching it never refetches.
  const [profitBasis, setProfitBasis] = useState<ProfitBasis>('accrual');
  // Manual date controls live behind "Más filtros": the presets cover the
  // common cases, the raw range is an advanced option.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  // Customer list starts collapsed to the top 7; the toggle reveals the rest.
  const [allCustomersShown, setAllCustomersShown] = useState(false);

  // Only the active tab's report is enabled — the same single request the
  // imperative version issued per tab/date change.
  const isRevenue = tab === 'revenue';
  // The range-mode switch lives on the profit tab only.
  const showRangeMode = !isRevenue;
  const singleDay = showRangeMode && rangeMode === 'day';

  const handleRangeModeChange = (_event: unknown, value: RangeMode | null) => {
    if (!value) return;
    setRangeMode(value);
    if (value === 'day') setEndDate(startDate);
  };

  const handleProfitBasisChange = (_event: unknown, value: ProfitBasis | null) => {
    if (value) setProfitBasis(value);
  };

  const handleSingleDayChange = (value: string) => {
    // A single-day query binds startDate and endDate to the same calendar day.
    setStartDate(value);
    setEndDate(value);
  };

  const drillIntoDay = (date: string) => {
    setRangeMode('day');
    setStartDate(date);
    setEndDate(date);
  };

  const applyPreset = (preset: DatePreset) => {
    const range = presetRange(preset, new Date());
    setStartDate(range.start);
    setEndDate(range.end);
    if (!isRevenue) {
      setRangeMode(range.singleDay ? 'day' : 'range');
    }
  };

  // A preset is highlighted only while the current dates still match it, so
  // editing a date manually clears the selection.
  const activePreset: DatePreset | null =
    DATE_PRESETS.find((preset) => {
      const range = presetRange(preset.id, new Date());
      return range.start === startDate && range.end === endDate;
    })?.id ?? null;

  const revenueQuery = useRevenueReport(
    isRevenue ? startDate || undefined : undefined,
    isRevenue ? endDate || undefined : undefined,
  );
  const profitQuery = useProfitReport(
    !isRevenue ? startDate || undefined : undefined,
    !isRevenue ? endDate || undefined : undefined,
  );
  const activeQuery = isRevenue ? revenueQuery : profitQuery;
  const revenue = revenueQuery.data ?? null;
  const profit = profitQuery.data ?? null;
  const loading = activeQuery.isLoading;

  const error = activeQuery.error
    ? activeQuery.error instanceof Error
      ? activeQuery.error.message
      : 'Error al cargar reporte'
    : null;

  const rangeLabel =
    startDate === endDate
      ? formatReportDate(startDate)
      : `${formatReportDate(startDate)} — ${formatReportDate(endDate)}`;

  // Profit basis control sits right under the main tabs; it only exists once
  // the report is available (same gating as the old in-content toggle).
  const showBasisToggle = showRangeMode && !loading && profit !== null;

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto', pb: 2 }}>
      {/* Header — single PageHeader pattern */}
      <PageHeader
        title="Reportes"
        subtitle="Ingresos, ganancias y análisis financiero"
        icon={<IconReport size={22} />}
      />

      {/* Report switcher — full-width segmented control */}
      <Tabs
        value={tab}
        onChange={(_, value: ReportTab) => setTab(value)}
        variant="fullWidth"
        aria-label="Sección de reporte"
        sx={{
          minHeight: 0,
          p: '3px',
          mb: 2,
          bgcolor: 'surfaceContainerLow',
          borderRadius: '999px',
          border: 1,
          borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.4),
          '& .MuiTabs-indicator': { display: 'none' },
          '& .MuiTabs-flexContainer': { gap: '3px' },
          '& .MuiTabs-scroller': { overflow: 'visible !important' },
          '& .MuiTab-root': {
            minHeight: 38,
            minWidth: 0,
            px: 2,
            gap: 0.75,
            borderRadius: '999px',
            color: 'onSurfaceVariant',
            fontWeight: 700,
            fontSize: '0.8125rem',
            textTransform: 'none',
            transition: 'background-color 180ms ease, color 180ms ease',
          },
          '& .MuiTab-root .MuiTab-iconWrapper': { margin: 0 },
          '& .MuiTab-root.Mui-selected': {
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            boxShadow: 1,
          },
        }}
      >
        <Tab value="revenue" label="Ingresos" icon={<IconPayments size={16} />} iconPosition="start" />
        <Tab value="profit" label="Ganancias" icon={<IconTrendingUp size={16} />} iconPosition="start" />
      </Tabs>

      {/* Profit basis — secondary segmented control, right under the tabs */}
      {showBasisToggle && (
        <ToggleButtonGroup
          exclusive
          value={profitBasis}
          onChange={handleProfitBasisChange}
          aria-label="Base contable de la ganancia"
          sx={{
            mb: 2,
            width: '100%',
            display: 'flex',
            p: '3px',
            bgcolor: 'surfaceContainerLow',
            borderRadius: '999px',
            border: 1,
            borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.4),
            '& .MuiToggleButton-root': {
              flex: 1,
              border: 0,
              borderRadius: '999px',
              px: 2,
              py: 0.75,
              minHeight: 34,
              color: 'onSurfaceVariant',
              fontWeight: 700,
              fontSize: '0.8125rem',
              textTransform: 'none',
              '&.Mui-selected': {
                bgcolor: 'secondaryContainer',
                color: 'onSecondaryContainer',
                '&:hover': { bgcolor: 'secondaryContainer' },
              },
            },
          }}
        >
          <ToggleButton value="accrual">Devengado</ToggleButton>
          <ToggleButton value="cash">Cobrado</ToggleButton>
        </ToggleButtonGroup>
      )}

      {/* Quick presets — scrollable chip rail, no scrollbar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          mb: 1.5,
          flexWrap: 'wrap',
          pb: 0.5,
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {DATE_PRESETS.map((preset) => {
          const active = activePreset === preset.id;
          return (
            <ButtonBase
              key={preset.id}
              onClick={() => applyPreset(preset.id)}
              aria-pressed={active}
              sx={{
                height: 32,
                flexShrink: 0,
                gap: 0.5,
                px: 1.5,
                borderRadius: '10px',
                border: 1,
                borderColor: active
                  ? (theme) => alpha(theme.palette.onSecondaryContainer, 0.18)
                  : (theme) => alpha(theme.palette.outlineVariant, 0.5),
                bgcolor: active ? 'secondaryContainer' : 'transparent',
                color: active ? 'onSecondaryContainer' : 'onSurfaceVariant',
                fontSize: '0.75rem',
                fontWeight: active ? 700 : 600,
                whiteSpace: 'nowrap',
                transition: 'background-color 160ms ease, border-color 160ms ease, color 160ms ease',
                '&:hover': {
                  bgcolor: active ? 'secondaryContainer' : 'surfaceContainer',
                },
              }}
            >
              {active && <IconCheck size={14} />}
              {preset.label}
            </ButtonBase>
          );
        })}
      </Box>

      {/* Filters row — disclosure on the left, active range pill on the right */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          mb: 2,
          flexWrap: 'wrap',
        }}
      >
        <Button
          variant="text"
          size="small"
          onClick={() => setFiltersOpen((open) => !open)}
          startIcon={<IconFilter size={16} />}
          endIcon={
            <Box
              component="span"
              sx={{
                display: 'inline-flex',
                transition: 'transform 180ms ease',
                transform: filtersOpen ? 'rotate(180deg)' : 'none',
              }}
            >
              <IconExpandMore size={16} />
            </Box>
          }
          aria-expanded={filtersOpen}
          aria-controls="report-date-filters"
          sx={{
            minHeight: 36,
            px: 1,
            borderRadius: '10px',
            textTransform: 'none',
            fontWeight: 700,
            fontSize: '0.8125rem',
            color: 'onSurfaceVariant',
          }}
        >
          {filtersOpen ? 'Menos filtros' : 'Más filtros'}
        </Button>
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            px: 1.25,
            py: 0.5,
            borderRadius: '999px',
            bgcolor: 'surfaceContainer',
            border: 1,
            borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.4),
            color: 'onSurfaceVariant',
            flexShrink: 0,
          }}
        >
          <IconCalendar size={13} />
          <Typography
            component="span"
            sx={{ ...MONO, fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap', lineHeight: 1.4 }}
          >
            {rangeLabel}
          </Typography>
        </Box>
      </Box>

      <Collapse in={filtersOpen} id="report-date-filters" timeout={200}>
        <Box
          sx={{
            display: 'flex',
            gap: 2,
            mb: 2.5,
            p: 2,
            alignItems: 'flex-end',
            flexDirection: { xs: 'column', sm: 'row' },
            flexWrap: 'wrap',
            bgcolor: 'surfaceContainerLow',
            borderRadius: '16px',
            border: 1,
            borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.3),
          }}
        >
          {showRangeMode && (
            <ToggleButtonGroup
              exclusive
              size="small"
              value={rangeMode}
              onChange={handleRangeModeChange}
              aria-label="Modo de rango de fechas"
              sx={{
                p: '2px',
                bgcolor: 'surfaceContainer',
                borderRadius: '999px',
                '& .MuiToggleButton-root': {
                  border: 0,
                  borderRadius: '999px',
                  px: 2,
                  py: 0.75,
                  minHeight: 34,
                  color: 'onSurfaceVariant',
                  fontWeight: 700,
                  fontSize: '0.8125rem',
                  textTransform: 'none',
                  '&.Mui-selected': {
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    '&:hover': { bgcolor: 'primary.main' },
                  },
                },
              }}
            >
              <ToggleButton value="range">Rango</ToggleButton>
              <ToggleButton value="day">Día</ToggleButton>
            </ToggleButtonGroup>
          )}
          {singleDay ? (
            <MuiTextField
              label="Día"
              type="date"
              value={startDate}
              onChange={(e) => handleSingleDayChange(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ maxWidth: 200 }}
            />
          ) : (
            <>
              <MuiTextField
                label="Desde"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ maxWidth: 200 }}
              />
              <MuiTextField
                label="Hasta"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ maxWidth: 200 }}
              />
            </>
          )}
        </Box>
      </Collapse>

      {error && (
        <Alert severity="error" sx={{ mb: 2.5, borderRadius: '16px' }}>
          {error}
        </Alert>
      )}

      {loading && <LoadingState label="Calculando reporte…" minHeight={240} />}

      {/* Revenue Report */}
      {!loading && tab === 'revenue' && revenue && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {/* KPIs — 8/4 split, stacked on xs */}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '12px' }}>
            <KpiCard
              label="Ingreso Total"
              xs={12}
              sm={8}
              value={<MoneyValue value={revenue.totalRevenue} size={30} />}
              caption={`Ticket promedio ${formatCurrency(
                revenue.orderCount > 0 ? revenue.totalRevenue / revenue.orderCount : 0,
              )}`}
              captionIcon={
                <Box sx={{ display: 'flex', color: 'tertiary', flexShrink: 0 }}>
                  <IconTrendingUp size={13} />
                </Box>
              }
            />
            <KpiCard
              label="Órdenes"
              xs={12}
              sm={4}
              icon={<Box sx={{ display: 'flex' }}><IconReceiptLong size={16} /></Box>}
              value={<Typography sx={{ ...MONO, fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em' }}>{revenue.orderCount}</Typography>}
              caption="Entregadas"
            />
          </Box>

          {/* Ventas por Canal */}
          <SectionCard
            icon={<IconTruck size={16} />}
            title="Ventas por Canal"
            meta={pluralize(revenue.breakdown.byChannel.length, 'canal activo', 'canales activos')}
          >
            {revenue.breakdown.byChannel.length === 0 ? (
              <SectionEmpty />
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                {revenue.breakdown.byChannel.map((channel) => (
                  <ChannelRow
                    key={channel.canal}
                    canal={channel.canal}
                    orders={channel.ordenes}
                    amount={channel.monto}
                    percentage={percentOf(channel.monto, revenue.totalRevenue)}
                  />
                ))}
              </Box>
            )}
          </SectionCard>

          {/* Por Producto */}
          <SectionCard
            icon={<IconEgg size={16} />}
            title="Por Producto"
            meta={pluralize(revenue.breakdown.byProduct.length, 'producto', 'productos')}
          >
            {revenue.breakdown.byProduct.length === 0 ? (
              <SectionEmpty />
            ) : (
              <Box>
                {revenue.breakdown.byProduct.map((product) => (
                  <ProductRow
                    key={product.productId}
                    name={product.productName}
                    quantity={product.quantity}
                    amount={product.total}
                    percentage={percentOf(product.total, revenue.totalRevenue)}
                  />
                ))}
              </Box>
            )}
          </SectionCard>

          {/* Por Cliente — 7 preview rows + expandable remainder */}
          <SectionCard
            icon={<IconUsers size={16} />}
            title="Por Cliente"
            meta={pluralize(revenue.breakdown.byCustomer.length, 'cliente', 'clientes')}
          >
            {revenue.breakdown.byCustomer.length === 0 ? (
              <SectionEmpty />
            ) : (
              <Box>
                <Box id="report-customers-list">
                  {(allCustomersShown
                    ? revenue.breakdown.byCustomer
                    : revenue.breakdown.byCustomer.slice(0, 7)
                  ).map((customer) => (
                    <CustomerRow
                      key={customer.customerId}
                      name={customer.customerName}
                      orderCount={customer.orderCount}
                      amount={customer.total}
                    />
                  ))}
                  {!allCustomersShown && revenue.breakdown.byCustomer.length > 7 && (
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        py: 1.25,
                        borderTop: 1,
                        borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.2),
                        color: 'onSurfaceVariant',
                      }}
                    >
                      <Typography component="p" sx={{ fontSize: '0.75rem', fontWeight: 600 }}>
                        {pluralize(
                          revenue.breakdown.byCustomer.length - 7,
                          'cliente adicional',
                          'clientes adicionales',
                        )}
                      </Typography>
                      <Typography
                        component="p"
                        sx={{ ...MONO, ml: 'auto', fontSize: '0.75rem', fontWeight: 700 }}
                      >
                        {formatCurrency(
                          revenue.breakdown.byCustomer
                            .slice(7)
                            .reduce((sum, customer) => sum + customer.total, 0),
                        )}
                      </Typography>
                    </Box>
                  )}
                </Box>
                {revenue.breakdown.byCustomer.length > 7 && (
                  <Button
                    fullWidth
                    variant="text"
                    size="small"
                    onClick={() => setAllCustomersShown((shown) => !shown)}
                    aria-expanded={allCustomersShown}
                    aria-controls="report-customers-list"
                    sx={{
                      mt: 1,
                      minHeight: 36,
                      borderRadius: '12px',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      color: 'primary.main',
                    }}
                  >
                    {allCustomersShown
                      ? 'Ver menos'
                      : `Ver todos los ${revenue.breakdown.byCustomer.length} clientes`}
                  </Button>
                )}
              </Box>
            )}
          </SectionCard>

          {/* Por Método de Pago */}
          <SectionCard
            icon={<IconPayments size={16} />}
            title="Por Método de Pago"
            meta={pluralize(revenue.breakdown.byPaymentMethod.length, 'método', 'métodos')}
          >
            {revenue.breakdown.byPaymentMethod.length === 0 ? (
              <SectionEmpty />
            ) : (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                  gap: 1.25,
                }}
              >
                {revenue.breakdown.byPaymentMethod.map((method) => (
                  <PaymentMethodCard
                    key={method.method}
                    method={method.method}
                    amount={method.total}
                    percentage={percentOf(method.total, revenue.totalRevenue)}
                  />
                ))}
              </Box>
            )}
          </SectionCard>
        </Box>
      )}

      {/* Profit Report */}
      {!loading && tab === 'profit' && profit && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {profitBasis === 'accrual' ? (
            <>
              {/* Accrual KPIs */}
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '12px' }}>
                <KpiCard
                  label="Ingresos"
                  xs={6}
                  sm={3}
                  value={<MoneyValue value={profit.revenue} size={24} color="primary.main" />}
                />
                <KpiCard
                  label="COGS"
                  xs={6}
                  sm={3}
                  value={<MoneyValue value={profit.cogs} size={24} color="error.main" />}
                />
                <KpiCard
                  label="Gastos"
                  xs={6}
                  sm={3}
                  value={<MoneyValue value={profit.expenses} size={24} color="warning.main" />}
                />
                <KpiCard
                  label="Pendiente de cobro"
                  xs={6}
                  sm={3}
                  value={<MoneyValue value={profit.pendingCollection} size={24} color="warning.main" />}
                />
                <KpiCard
                  label="Ganancia"
                  xs={12}
                  sm={12}
                  bg={profit.profit >= 0 ? 'successContainer' : 'errorContainer'}
                  fg={profit.profit >= 0 ? 'onSuccessContainer' : 'onErrorContainer'}
                  icon={<IconTrendingUp size={16} />}
                  value={
                    <MoneyValue
                      value={profit.profit}
                      size={30}
                      color={profit.profit >= 0 ? 'onSuccessContainer' : 'onErrorContainer'}
                    />
                  }
                  caption={profit.profit >= 0 ? 'Resultado positivo del período' : 'Resultado negativo del período'}
                />
              </Box>

              {/* Margin — own wide card */}
              <MarginCard margin={profit.margin} />

              {profit.partialCOGS && profit.disclaimer && (
                <Alert severity="warning" sx={{ borderRadius: '16px' }}>
                  {profit.disclaimer}
                </Alert>
              )}
            </>
          ) : (
            <>
              {/* Cash-basis KPIs */}
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '12px' }}>
                <KpiCard
                  label="Cobrado"
                  xs={6}
                  sm={4}
                  value={<MoneyValue value={profit.cashBasis.collected} size={24} color="primary.main" />}
                />
                <KpiCard
                  label="Costo de lo cobrado"
                  xs={6}
                  sm={4}
                  value={<MoneyValue value={profit.cashBasis.cogs} size={24} color="error.main" />}
                />
                <KpiCard
                  label="Reintegros"
                  xs={6}
                  sm={4}
                  value={<MoneyValue value={profit.cashBasis.refunded} size={24} color="warning.main" />}
                />
                <KpiCard
                  label="Ganancia cobrada"
                  xs={12}
                  sm={7}
                  bg={profit.cashBasis.profit >= 0 ? 'successContainer' : 'errorContainer'}
                  fg={profit.cashBasis.profit >= 0 ? 'onSuccessContainer' : 'onErrorContainer'}
                  value={
                    <MoneyValue
                      value={profit.cashBasis.profit}
                      size={30}
                      color={profit.cashBasis.profit >= 0 ? 'onSuccessContainer' : 'onErrorContainer'}
                    />
                  }
                />
                <KpiCard
                  label="Margen"
                  xs={12}
                  sm={5}
                  value={
                    <Typography
                      sx={{
                        ...MONO,
                        fontSize: 30,
                        fontWeight: 700,
                        letterSpacing: '-0.02em',
                        color:
                          profit.cashBasis.margin >= 20
                            ? 'success.main'
                            : profit.cashBasis.margin >= 10
                              ? 'warning.main'
                              : 'error.main',
                      }}
                    >
                      {profit.cashBasis.margin.toFixed(1)}%
                    </Typography>
                  }
                  caption="Sobre lo cobrado"
                />
              </Box>

              <Typography component="p" sx={{ fontSize: '0.75rem', color: 'onSurfaceVariant' }}>
                Solo cuenta la plata que entró en el período, con el costo proporcional de lo cobrado.
              </Typography>
            </>
          )}

          {/* Por cobrar — global, shown in BOTH views (not period-scoped). */}
          <SectionCard
            icon={<IconCreditCard size={16} />}
            title="Por cobrar"
            meta={pluralize(profit.receivable.customerCount, 'cliente', 'clientes')}
          >
            <Box
              sx={{
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                justifyContent: 'space-between',
                alignItems: { xs: 'flex-start', sm: 'flex-end' },
                gap: 2,
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography component="p" sx={{ ...LABEL, color: 'onSurfaceVariant', mb: 0.5 }}>
                  Total a cobrar
                </Typography>
                <MoneyValue value={profit.receivable.total} size={28} color="warning.main" />
              </Box>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: 'repeat(2, minmax(0, auto))',
                    sm: 'repeat(3, minmax(0, auto))',
                  },
                  gap: 2.5,
                }}
              >
                <ReceivableMetric
                  label="Vencido"
                  value={formatCurrency(profit.receivable.overdue)}
                  color="error.main"
                />
                <ReceivableMetric label="A vencer" value={formatCurrency(profit.receivable.upcoming)} />
                <ReceivableMetric label="Clientes" value={String(profit.receivable.customerCount)} />
              </Box>
            </Box>
          </SectionCard>

          {profitBasis === 'accrual' ? (
            <>
              {/* Desglose */}
              <SectionCard icon={<IconReceiptLong size={16} />} title="Desglose" meta="Devengado">
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small" aria-label="Desglose de ganancias">
                    <TableBody>
                      <TableRow>
                        <TableCell sx={{ py: 1, px: 0.5, fontSize: '0.8125rem', borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.2) }}>
                          Ingresos totales
                        </TableCell>
                        <TableCell sx={{ ...NUM_CELL, py: 1, px: 0.5, fontSize: '0.8125rem', textAlign: 'right', borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.2) }}>
                          {formatCurrency(profit.revenue)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell sx={{ py: 1, px: 0.5, fontSize: '0.8125rem', borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.2) }}>
                          Cobrado
                        </TableCell>
                        <TableCell sx={{ ...NUM_CELL, py: 1, px: 0.5, fontSize: '0.8125rem', textAlign: 'right', borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.2) }}>
                          {formatCurrency(profit.collected)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell sx={{ py: 1, px: 0.5, fontSize: '0.8125rem', borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.2) }}>
                          Pendiente de cobro
                        </TableCell>
                        <TableCell sx={{ ...NUM_CELL, py: 1, px: 0.5, fontSize: '0.8125rem', textAlign: 'right', color: 'warning.main', borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.2) }}>
                          {formatCurrency(profit.pendingCollection)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell sx={{ py: 1, px: 0.5, fontSize: '0.8125rem', borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.2) }}>
                          Costo de los bienes vendidos (COGS)
                        </TableCell>
                        <TableCell sx={{ ...NUM_CELL, py: 1, px: 0.5, fontSize: '0.8125rem', textAlign: 'right', borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.2) }}>
                          - {formatCurrency(profit.cogs)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell sx={{ py: 1, px: 0.5, fontSize: '0.8125rem', borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.2) }}>
                          Gastos operativos
                        </TableCell>
                        <TableCell sx={{ ...NUM_CELL, py: 1, px: 0.5, fontSize: '0.8125rem', textAlign: 'right', borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.2) }}>
                          - {formatCurrency(profit.expenses)}
                        </TableCell>
                      </TableRow>
                      <TableRow sx={{ '& td': { borderBottom: '2px solid', borderColor: 'outline', pt: 1.5 } }}>
                        <TableCell sx={{ px: 0.5, fontSize: '0.8125rem', fontWeight: 700 }}>
                          Ganancia neta
                        </TableCell>
                        <TableCell
                          sx={{
                            ...NUM_CELL,
                            px: 0.5,
                            fontSize: '0.8125rem',
                            fontWeight: 700,
                            textAlign: 'right',
                            color: profit.profit >= 0 ? 'success.main' : 'error.main',
                          }}
                        >
                          {formatCurrency(profit.profit)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </Box>
              </SectionCard>

              {/* Ganancias por día — one row per business calendar day with data */}
              <SectionCard
                icon={<IconCalendar size={16} />}
                title="Ganancias por día"
                meta={pluralize(profit.byDay.length, 'día', 'días')}
              >
                {profit.byDay.length === 0 ? (
                  <SectionEmpty />
                ) : (
                  <Box sx={{ overflowX: 'auto' }}>
                    <Table size="small" aria-label="Ganancias por día" sx={{ minWidth: 720 }}>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={HEAD_CELL}>Fecha</TableCell>
                          <TableCell sx={{ ...HEAD_CELL, textAlign: 'right' }}>Órdenes</TableCell>
                          <TableCell sx={{ ...HEAD_CELL, textAlign: 'right' }}>Ingresos</TableCell>
                          <TableCell sx={{ ...HEAD_CELL, textAlign: 'right' }}>Pendiente</TableCell>
                          <TableCell sx={{ ...HEAD_CELL, textAlign: 'right' }}>COGS</TableCell>
                          <TableCell sx={{ ...HEAD_CELL, textAlign: 'right' }}>Gastos</TableCell>
                          <TableCell sx={{ ...HEAD_CELL, textAlign: 'right' }}>Ganancia</TableCell>
                          <TableCell sx={{ ...HEAD_CELL, textAlign: 'right' }}>Margen</TableCell>
                          <TableCell sx={{ ...HEAD_CELL, textAlign: 'right' }}>Acción</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {profit.byDay.map((day) => (
                          <TableRow key={day.date} hover>
                            <TableCell sx={{ ...MONO, py: 1, px: 1, fontSize: '0.8125rem' }}>
                              {formatReportDate(day.date)}
                            </TableCell>
                            <TableCell sx={{ ...NUM_CELL, py: 1, px: 1, fontSize: '0.8125rem', textAlign: 'right' }}>
                              {day.orderCount}
                            </TableCell>
                            <TableCell sx={{ ...NUM_CELL, py: 1, px: 1, fontSize: '0.8125rem', textAlign: 'right' }}>
                              {formatCurrency(day.revenue)}
                            </TableCell>
                            <TableCell sx={{ ...NUM_CELL, py: 1, px: 1, fontSize: '0.8125rem', textAlign: 'right', color: 'warning.main' }}>
                              {formatCurrency(day.pendingCollection)}
                            </TableCell>
                            <TableCell sx={{ ...NUM_CELL, py: 1, px: 1, fontSize: '0.8125rem', textAlign: 'right' }}>
                              {formatCurrency(day.cogs)}
                            </TableCell>
                            <TableCell sx={{ ...NUM_CELL, py: 1, px: 1, fontSize: '0.8125rem', textAlign: 'right' }}>
                              {formatCurrency(day.expenses)}
                            </TableCell>
                            <TableCell
                              sx={[
                                { ...NUM_CELL, py: 1, px: 1, fontSize: '0.8125rem', textAlign: 'right' },
                                day.profit < 0 && { color: 'error.main' },
                              ]}
                            >
                              {formatCurrency(day.profit)}
                            </TableCell>
                            <TableCell
                              sx={[
                                { ...NUM_CELL, py: 1, px: 1, fontSize: '0.8125rem', textAlign: 'right' },
                                day.margin < 0 && { color: 'error.main' },
                              ]}
                            >
                              {day.margin.toFixed(1)}%
                            </TableCell>
                            <TableCell sx={{ py: 1, px: 1, textAlign: 'right' }}>
                              <Button
                                size="small"
                                variant="text"
                                onClick={() => drillIntoDay(day.date)}
                                aria-label={`Ver día ${formatReportDate(day.date)}`}
                                sx={{
                                  minHeight: 30,
                                  px: 1,
                                  borderRadius: '8px',
                                  fontSize: '0.75rem',
                                  fontWeight: 700,
                                }}
                              >
                                Ver día
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                )}
              </SectionCard>
            </>
          ) : (
            /* Cash-basis daily table — movement dates. */
            <SectionCard
              icon={<IconCalendar size={16} />}
              title="Ganancia cobrada por día"
              meta={pluralize(profit.cashBasis.byDay.length, 'día', 'días')}
            >
              {profit.cashBasis.byDay.length === 0 ? (
                <SectionEmpty message="Sin movimientos de caja en este período." />
              ) : (
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small" aria-label="Ganancia cobrada por día" sx={{ minWidth: 620 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={HEAD_CELL}>Fecha</TableCell>
                        <TableCell sx={{ ...HEAD_CELL, textAlign: 'right' }}>Cobrado</TableCell>
                        <TableCell sx={{ ...HEAD_CELL, textAlign: 'right' }}>Costo</TableCell>
                        <TableCell sx={{ ...HEAD_CELL, textAlign: 'right' }}>Reintegros</TableCell>
                        <TableCell sx={{ ...HEAD_CELL, textAlign: 'right' }}>Ganancia</TableCell>
                        <TableCell sx={{ ...HEAD_CELL, textAlign: 'right' }}>Margen</TableCell>
                        <TableCell sx={{ ...HEAD_CELL, textAlign: 'right' }}>Acción</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {profit.cashBasis.byDay.map((day) => (
                        <TableRow key={day.date} hover>
                          <TableCell sx={{ ...MONO, py: 1, px: 1, fontSize: '0.8125rem' }}>
                            {formatReportDate(day.date)}
                          </TableCell>
                          <TableCell sx={{ ...NUM_CELL, py: 1, px: 1, fontSize: '0.8125rem', textAlign: 'right' }}>
                            {formatCurrency(day.collected)}
                          </TableCell>
                          <TableCell sx={{ ...NUM_CELL, py: 1, px: 1, fontSize: '0.8125rem', textAlign: 'right' }}>
                            {formatCurrency(day.cogs)}
                          </TableCell>
                          <TableCell sx={{ ...NUM_CELL, py: 1, px: 1, fontSize: '0.8125rem', textAlign: 'right', color: 'warning.main' }}>
                            {formatCurrency(day.refunded)}
                          </TableCell>
                          <TableCell
                            sx={[
                              { ...NUM_CELL, py: 1, px: 1, fontSize: '0.8125rem', textAlign: 'right' },
                              day.profit < 0 && { color: 'error.main' },
                            ]}
                          >
                            {formatCurrency(day.profit)}
                          </TableCell>
                          <TableCell
                            sx={[
                              { ...NUM_CELL, py: 1, px: 1, fontSize: '0.8125rem', textAlign: 'right' },
                              day.margin < 0 && { color: 'error.main' },
                            ]}
                          >
                            {day.margin.toFixed(1)}%
                          </TableCell>
                          <TableCell sx={{ py: 1, px: 1, textAlign: 'right' }}>
                            <Button
                              size="small"
                              variant="text"
                              onClick={() => drillIntoDay(day.date)}
                              aria-label={`Ver día ${formatReportDate(day.date)}`}
                              sx={{
                                minHeight: 30,
                                px: 1,
                                borderRadius: '8px',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                              }}
                            >
                              Ver día
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
            </SectionCard>
          )}
        </Box>
      )}
    </Box>
  );
}
