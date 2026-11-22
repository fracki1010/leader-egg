import { useNavigate } from 'react-router-dom';
import { keyframes } from '@emotion/react';
import {
  useDashboardSummary,
  useDashboardAlerts,
  useOrders,
  usePuntoCero,
} from '../hooks/queries/index.ts';
import {
  MuiCard,
  MuiChip,
  MuiIconButton,
  MuiButton,
  LoadingState,
} from '../components/ui/index.ts';
import { m3Shape } from '../theme/index.ts';
import { useAuthStore } from '../stores/authStore.ts';
import {
  IconWallet,
  IconCreditCard,
  IconClock,
  IconBox,
  IconRoute,
  IconTruck,
  IconPlus,
  IconCheck,
  IconWarning,
  IconInfo,
  IconEgg,
  IconRefresh,
  IconBell,
  IconShoppingCart,
  IconPointOfSale,
  IconStock,
  IconWarehouse,
  IconPayments,
  IconPlay,
  IconX,
  IconReceiptLong,
  IconInbox,
  IconMoney,
  IconQrCode,
  IconBank,
  IconTune,
  IconBolt,
  IconArrowRight,
} from '../components/ui/icons.tsx';
import type { Alert, DebtRow, Order, StockSummaryItem } from '../types/index.ts';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import MuiAlert from '@mui/material/Alert';
import { alpha, type Theme } from '@mui/material/styles';

/* ── Helpers ─────────────────────────────────── */

function formatDate(): string {
  const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  const now = new Date();
  const dayName = days[now.getDay()];
  const day = now.getDate();
  const month = months[now.getMonth()];

  return `${dayName} ${day} de ${month}`;
}

/** Morning / afternoon / evening greeting — the dashboard speaks to the
 *  owner's moment (6am between deliveries, not a generic "Welcome"). */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

const formatMoney = (n: number) =>
  `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

/** Spanish labels for the sales-channel split (matches OrdersPage/ReportsPage). */
const SALES_CHANNEL_LABELS: Record<string, string> = {
  reparto: 'Reparto',
  puesto: 'Puesto',
  whatsapp: 'WhatsApp',
  otro: 'Otro',
};

/** HH:MM from an ISO timestamp (orders list). */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

/** Two-letter monogram for the debtor avatar (empty names fall back to "?"). */
function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
  return letters || '?';
}

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

/** Soft green breathing glow for the "Jornada activa" live dot. */
const pulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(0, 114, 51, 0.35); }
  70% { box-shadow: 0 0 0 8px rgba(0, 114, 51, 0); }
  100% { box-shadow: 0 0 0 0 rgba(0, 114, 51, 0); }
`;

/* ── Shared M3 pieces ───────────────────────────

   Elevation in M3 is tonal surface color first, shadow second. The
   page keeps that hierarchy: canvas = background.default (a step
   below), cards = surfaceContainerLow with a hairline outlineVariant
   border, hero = primaryContainer. Hover only shifts the surface tone
   one step up (low → container) plus a 2dp lift.

   Every spacing value is a multiple of theme.spacing (8dp system). */

const cardHover = {
  transition:
    'transform 0.18s cubic-bezier(0.2, 0, 0, 1), box-shadow 0.18s cubic-bezier(0.2, 0, 0, 1), background-color 0.18s cubic-bezier(0.2, 0, 0, 1)',
  '&:hover': {
    transform: 'translateY(-2px)',
    boxShadow: 2,
    bgcolor: 'surfaceContainer',
  },
};

/** M3 card shell for hand-built lists (edge-to-edge dividers). */
const listShell = {
  bgcolor: 'surfaceContainerLowest',
  border: 1,
  borderColor: (t: Theme) => alpha(t.palette.outlineVariant, 0.5),
  borderRadius: '24px',
  overflow: 'hidden',
};

// Note: MUI's `sx` sizing turns numeric values <= 1 into percentages
// (`width: 1` => 100%), so a classic sr-only written with bare numbers becomes
// a full-size absolutely-positioned box that silently widens the mobile
// viewport. Use explicit px and anchor it at the origin.
const srOnly = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

/** Big money value with de-emphasised cents. The visible glyphs are
 *  aria-hidden; a visually hidden copy keeps one accessible string
 *  (and one text node for tests/assistive tech). */
function Amount({ value }: { value: string }) {
  const comma = value.lastIndexOf(',');
  if (comma < 0) return <>{value}</>;
  return (
    <>
      <Box component="span" aria-hidden="true">
        {value.slice(0, comma)}
      </Box>
      <Box
        component="span"
        aria-hidden="true"
        sx={{ fontSize: '0.62em', fontWeight: 700, color: 'onSurfaceVariant', letterSpacing: 0 }}
      >
        {value.slice(comma)}
      </Box>
      <Box component="span" sx={srOnly}>
        {value}
      </Box>
    </>
  );
}

/** Tonal pill — small container chip for captions/status (M3 container + on-container pair). */
interface PillChipProps {
  bg: string;
  fg: string;
  children: React.ReactNode;
}

function PillChip({ bg, fg, children }: PillChipProps) {
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1.25,
        py: 0.5,
        borderRadius: m3Shape.full,
        bgcolor: bg,
        color: fg,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {children}
    </Box>
  );
}

/** Section header — uppercase M3 overline with a leading icon and an
 *  optional right-aligned action. One header for the whole dashboard. */
interface SectionHeaderProps {
  icon: React.ReactElement;
  title: string;
  action?: React.ReactNode;
}

function SectionHeader({ icon, title, action }: SectionHeaderProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, minHeight: 24 }}>
      <Box sx={{ display: 'flex', color: 'onSurfaceVariant' }}>{icon}</Box>
      <Typography variant="overline" color="onSurfaceVariant">
        {title}
      </Typography>
      {action && <Box sx={{ ml: 'auto' }}>{action}</Box>}
    </Box>
  );
}

/* ── KPI card ────────────────────────────────────
   surfaceContainerLow shell, 24dp radius, 11px uppercase label + 40dp
   tinted icon square, big tabular number (cents muted), hairline
   divider, then a footer row: muted stat on the left, status pill on
   the right. Urgency lives in the icon/pill tones, never in the
   number itself. */

type KpiTone = 'primary' | 'tertiary' | 'success' | 'error';

interface KpiCardProps {
  label: string;
  value: string;
  icon: React.ReactElement;
  tone: KpiTone;
  footer: React.ReactNode;
  pill: React.ReactNode;
  onClick: () => void;
}

function KpiCard({ label, value, icon, tone, footer, pill, onClick }: KpiCardProps) {
  return (
    <MuiCard
      onClick={onClick}
      sx={{
        height: '100%',
        bgcolor: 'surfaceContainerLow',
        borderRadius: '24px',
        borderColor: (t: Theme) => alpha(t.palette.outlineVariant, 0.5),
        p: 0,
        ...cardHover,
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
        <Typography
          variant="overline"
          color="onSurfaceVariant"
          sx={{ fontSize: '0.6875rem', lineHeight: 1.3, pt: 0.75 }}
        >
          {label}
        </Typography>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 40,
            height: 40,
            borderRadius: m3Shape.medium,
            bgcolor: (t: Theme) => alpha(t.palette[tone].main, 0.14),
            color: `${tone}.main`,
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
      </Box>

      <Typography
        component="p"
        sx={{
          fontFamily: 'var(--font-mono)',
          fontWeight: 800,
          fontSize: '1.75rem',
          lineHeight: 1.1,
          letterSpacing: '-0.03em',
          fontVariantNumeric: 'tabular-nums',
          color: 'onSurface',
          mt: 0.5,
          mb: 1.5,
          wordBreak: 'break-word',
        }}
      >
        <Amount value={value} />
      </Typography>

      <Divider sx={{ borderColor: (t: Theme) => alpha(t.palette.outlineVariant, 0.5), mb: 1.5 }} />

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Typography
          variant="body2"
          color="onSurfaceVariant"
          sx={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 600, minWidth: 0 }}
        >
          {footer}
        </Typography>
        {pill}
      </Box>
    </MuiCard>
  );
}

/* ── Account tile ───────────────────────────────
   Per-account saldo (Efectivo / Mercado Pago / Banco): tinted icon
   square, tiny account code chip, label and a mono amount. A zero
   bank balance stays visible but muted instead of disappearing. */

type AccountTone = 'success' | 'info' | 'neutral';

interface AccountTileProps {
  code: string;
  label: string;
  value: string;
  icon: React.ReactElement;
  tone: AccountTone;
  muted?: boolean;
}

function AccountTile({ code, label, value, icon, tone, muted = false }: AccountTileProps) {
  return (
    <MuiCard
      sx={{
        height: '100%',
        bgcolor: 'surfaceContainerLow',
        borderRadius: '20px',
        borderColor: (t: Theme) => alpha(t.palette.outlineVariant, 0.5),
        p: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 40,
            height: 40,
            borderRadius: m3Shape.medium,
            flexShrink: 0,
            bgcolor: (t: Theme) =>
              tone === 'neutral' ? t.palette.surfaceContainerHigh : alpha(t.palette[tone].main, 0.14),
            color: tone === 'neutral' ? 'onSurfaceVariant' : `${tone}.main`,
          }}
        >
          {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Box
            component="span"
            sx={{
              display: 'inline-flex',
              px: 0.75,
              py: 0.125,
              mb: 0.25,
              borderRadius: m3Shape.small,
              bgcolor: 'surfaceContainerHigh',
              color: 'onSurfaceVariant',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.5625rem',
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              lineHeight: 1.4,
            }}
          >
            {code}
          </Box>
          <Typography variant="body2" color="onSurfaceVariant" sx={{ display: 'block', lineHeight: 1.2 }}>
            {label}
          </Typography>
        </Box>
      </Box>
      <Typography
        variant="titleMedium"
        sx={{
          mt: 1,
          fontFamily: 'var(--font-mono)',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: muted ? 'onSurfaceVariant' : 'onSurface',
          opacity: muted ? 0.6 : 1,
        }}
      >
        {value}
      </Typography>
    </MuiCard>
  );
}

/* ── Quick action ───────────────────────────────
   Square tile: the primary "Nuevo Pedido" is filled with the brand
   color; the rest are tonal cards with a circular tinted icon. */

interface QuickActionProps {
  icon: React.ReactElement;
  label: string;
  variant?: 'primary' | 'tonal';
  tone?: 'primary' | 'secondary' | 'tertiary';
  onClick: () => void;
}

function QuickAction({ icon, label, variant = 'tonal', tone = 'primary', onClick }: QuickActionProps) {
  const isPrimary = variant === 'primary';
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        p: 1,
        minHeight: { xs: 96, sm: 0 },
        aspectRatio: { xs: 'auto', sm: '1 / 1' },
        width: '100%',
        cursor: 'pointer',
        borderRadius: '24px',
        border: 1,
        borderColor: isPrimary ? 'transparent' : (t: Theme) => alpha(t.palette.outlineVariant, 0.5),
        bgcolor: isPrimary ? 'primary.main' : 'surfaceContainerLow',
        color: isPrimary ? 'onPrimary' : 'onSurface',
        transition:
          'transform 0.16s cubic-bezier(0.2, 0, 0, 1), box-shadow 0.16s cubic-bezier(0.2, 0, 0, 1), background-color 0.16s',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: 2,
          bgcolor: isPrimary ? 'primary.main' : 'surfaceContainer',
        },
        '&:active': { transform: 'scale(0.97)' },
        '&:focus-visible': {
          outline: (t: Theme) => `2px solid ${t.palette.primary.main}`,
          outlineOffset: 2,
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          borderRadius: '50%',
          flexShrink: 0,
          bgcolor: isPrimary
            ? (t: Theme) => alpha(t.palette.primary.contrastText, 0.18)
            : (t: Theme) => alpha(t.palette[tone].main, 0.14),
          color: isPrimary ? 'onPrimary' : `${tone}.main`,
        }}
      >
        {icon}
      </Box>
      <Typography
        component="span"
        sx={{
          fontSize: '0.6875rem',
          fontWeight: 700,
          lineHeight: 1.2,
          letterSpacing: '0.02em',
          textAlign: 'center',
          maxWidth: '100%',
          overflowWrap: 'anywhere',
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}

/* ── Alerts ───────────────────────────────────── */

/** Stock tone bands (shared with the whole stock UI):
 *  qty ≥ threshold×2 → success (green), ≥ threshold → warning (yellow),
 *  < threshold → error (red). */
function getStockTone(qty: number, threshold: number): 'success' | 'warning' | 'error' {
  if (qty < threshold) return 'error';
  if (qty < threshold * 2) return 'warning';
  return 'success';
}

const alertTone = (severity: Alert['severity']) => {
  if (severity === 'critical') {
    return {
      icon: <IconWarning size={18} />,
      iconBg: 'errorContainer',
      iconColor: 'onErrorContainer',
    };
  }
  if (severity === 'warning') {
    return {
      icon: <IconWarning size={18} />,
      iconBg: 'warningContainer',
      iconColor: 'onWarningContainer',
    };
  }
  return {
    icon: <IconInfo size={18} />,
    iconBg: 'infoContainer',
    iconColor: 'onInfoContainer',
  };
};

const alertTitle = (type: Alert['type']) =>
  type === 'overdue_debts' ? 'Deudas Vencidas' : type === 'low_stock' ? 'Stock Bajo' : 'Órdenes Pendientes';

const alertChipColor = (severity: Alert['severity']) =>
  severity === 'critical' ? 'error' : severity === 'warning' ? 'warning' : 'info';

/* ── Low stock row ──────────────────────────────
   Product name, a prescription hint and the current quantity badge.
   Only rendered for items under their threshold (qty < min). */

interface LowStockRowProps {
  item: StockSummaryItem;
  onClick: () => void;
}

function LowStockRow({ item, onClick }: LowStockRowProps) {
  // Threshold may be unset on the product — fall back to the seed default
  // (same convention as StockPage) so the tone bands stay meaningful.
  const threshold = item.threshold ?? 20;
  const quantity = item.quantity ?? 0;
  const tone = getStockTone(quantity, threshold);
  const hint = quantity === 0 ? 'Reposición inmediata' : `Mínimo sugerido: ${threshold}`;

  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        width: '100%',
        p: 1.5,
        textAlign: 'left',
        cursor: 'pointer',
        borderRadius: '16px',
        border: 1,
        borderColor: (t: Theme) => alpha(t.palette.outlineVariant, 0.4),
        bgcolor: 'surfaceContainerLowest',
        transition: 'background-color 0.16s, border-color 0.16s',
        '&:hover': { bgcolor: 'surfaceContainer', borderColor: 'transparent' },
        '&:focus-visible': {
          outline: (t: Theme) => `2px solid ${t.palette.primary.main}`,
          outlineOffset: 2,
        },
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography component="div" variant="titleSmall" sx={{ fontWeight: 600, color: 'onSurface' }} noWrap>
          {item.name}
        </Typography>
        <Typography component="div" variant="labelMedium" color="onSurfaceVariant" noWrap>
          {hint}
        </Typography>
      </Box>
      <Box
        sx={{
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 44,
          px: 1,
          py: 0.5,
          flexShrink: 0,
          borderRadius: m3Shape.medium,
          bgcolor: (t: Theme) => alpha(t.palette[tone].main, 0.14),
          color: `${tone}.main`,
        }}
      >
        <Typography
          sx={{
            fontFamily: 'var(--font-mono)',
            fontWeight: 800,
            fontSize: '0.9375rem',
            lineHeight: 1.1,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {quantity}
        </Typography>
        <Typography sx={{ fontSize: '0.5625rem', fontWeight: 700, letterSpacing: '0.04em', lineHeight: 1.2 }}>
          maples
        </Typography>
      </Box>
    </Box>
  );
}

/* ── Debtor row ─────────────────────────────────
   Two-line row inside the "Cuentas por cobrar" card: monogram avatar,
   customer name + activity subline, amount in the brand color. */

interface DebtorRowProps {
  deuda: DebtRow;
  onClick: () => void;
}

function DebtorRow({ deuda, onClick }: DebtorRowProps) {
  const overdue = deuda.maxDaysOverdue > 0;
  const ordersLabel = `${deuda.ordersCount} ${deuda.ordersCount === 1 ? 'orden activa' : 'órdenes activas'}`;
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        width: '100%',
        p: 2,
        textAlign: 'left',
        cursor: 'pointer',
        border: 0,
        bgcolor: 'transparent',
        transition: 'background-color 0.16s',
        '&:hover': { bgcolor: 'surfaceContainerLow' },
        '&:focus-visible': {
          outline: (t: Theme) => `2px solid ${t.palette.primary.main}`,
          outlineOffset: -2,
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          borderRadius: m3Shape.medium,
          flexShrink: 0,
          bgcolor: overdue ? 'errorContainer' : 'secondaryContainer',
          color: overdue ? 'onErrorContainer' : 'onSecondaryContainer',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.75rem',
          fontWeight: 800,
          letterSpacing: '0.02em',
        }}
      >
        {initials(deuda.customerName)}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography component="div" variant="titleSmall" sx={{ fontWeight: 600, color: 'onSurface' }} noWrap>
          {deuda.customerName}
        </Typography>
        <Typography
          component="div"
          variant="labelMedium"
          color={overdue ? 'error.main' : 'onSurfaceVariant'}
          noWrap
        >
          {ordersLabel} · {overdue ? 'vencida' : 'al día'}
        </Typography>
      </Box>
      <Typography
        variant="titleMedium"
        sx={{
          flexShrink: 0,
          fontFamily: 'var(--font-mono)',
          fontWeight: 800,
          fontVariantNumeric: 'tabular-nums',
          color: 'primary.main',
        }}
      >
        {formatMoney(deuda.totalDebt)}
      </Typography>
    </Box>
  );
}

/* ── Alerts row ─────────────────────────────────
   Compact row inside a single card (kept from the previous dashboard,
   now in the new surface language). */

interface AlertRowProps {
  alert: Alert;
}

function AlertRow({ alert }: AlertRowProps) {
  const tone = alertTone(alert.severity);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: m3Shape.small,
          bgcolor: tone.iconBg,
          color: tone.iconColor,
          flexShrink: 0,
        }}
      >
        {tone.icon}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="titleSmall" sx={{ fontWeight: 600, color: 'onSurface' }}>
          {alertTitle(alert.type)}
        </Typography>
        {alert.totalAmount !== undefined && (
          <Typography variant="labelMedium" color="onSurfaceVariant" sx={{ fontFamily: 'var(--font-mono)' }}>
            {formatMoney(alert.totalAmount)}
          </Typography>
        )}
      </Box>
      <MuiChip label={String(alert.count)} color={alertChipColor(alert.severity)} size="small" />
    </Box>
  );
}

/* ── Order row ──────────────────────────────────
   Row inside the "Últimas órdenes" card (existing data, new list look). */

const orderStatusMeta = (status: Order['status']) => {
  switch (status) {
    case 'delivered':
      return { label: 'Entregada', chipColor: 'success' as const, icon: <IconCheck size={16} />, circleBg: 'secondaryContainer', circleFg: 'onSecondaryContainer' };
    case 'pending':
      return { label: 'Pendiente', chipColor: 'warning' as const, icon: <IconClock size={16} />, circleBg: 'primaryContainer', circleFg: 'onPrimaryContainer' };
    case 'assigned':
      return { label: 'Asignada', chipColor: 'info' as const, icon: <IconRoute size={16} />, circleBg: 'tertiaryContainer', circleFg: 'onTertiaryContainer' };
    case 'in_transit':
      return { label: 'En viaje', chipColor: 'warning' as const, icon: <IconTruck size={16} />, circleBg: 'tertiaryContainer', circleFg: 'onTertiaryContainer' };
    case 'cancelled':
      return { label: 'Cancelada', chipColor: 'default' as const, icon: <IconX size={16} />, circleBg: 'surfaceContainerHighest', circleFg: 'onSurfaceVariant' };
  }
};

interface OrderRowProps {
  order: Order;
  onClick: () => void;
}

function OrderRow({ order, onClick }: OrderRowProps) {
  const meta = orderStatusMeta(order.status);
  const paymentLabel = order.paymentStatus === 'paid' ? 'pagado' : order.paymentStatus === 'partial' ? 'parcial' : 'impago';
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        width: '100%',
        p: 2,
        textAlign: 'left',
        cursor: 'pointer',
        border: 0,
        bgcolor: 'transparent',
        transition: 'background-color 0.16s',
        '&:hover': { bgcolor: 'surfaceContainerLow' },
        '&:focus-visible': {
          outline: (t: Theme) => `2px solid ${t.palette.primary.main}`,
          outlineOffset: -2,
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          borderRadius: '50%',
          flexShrink: 0,
          bgcolor: meta.circleBg,
          color: meta.circleFg,
        }}
      >
        {meta.icon}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography component="div" variant="titleSmall" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'onSurface' }} noWrap>
          {order.orderNumber}
        </Typography>
        <Typography variant="body2" color="onSurfaceVariant" noWrap>
          {order.customerName}
        </Typography>
        <Typography variant="labelMedium" color="onSurfaceVariant" sx={{ fontFamily: 'var(--font-mono)' }}>
          {formatMoney(order.totalAmount)} · {paymentLabel} · {formatTime(order.createdAt)}
        </Typography>
      </Box>
      <MuiChip label={meta.label} color={meta.chipColor} size="small" variant="outlined" sx={{ flexShrink: 0 }} />
    </Box>
  );
}

/* ── Dashboard page ─────────────────────────────
   Mobile-first single column (max 1000px): greeting, delivery hero,
   KPI grid, account balances, quick actions, critical stock, debtors,
   then the supporting cards (alerts, recent orders). The app Layout
   owns the top app bar, theme toggle and bottom navigation. */

export function DashboardPage() {
  const navigate = useNavigate();

  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.role === 'superadmin';

  // Read model — one query per backend source. The API layer keeps its
  // IndexedDB read-through fallback, so these work offline unchanged.
  const summaryQuery = useDashboardSummary();
  const alertsQuery = useDashboardAlerts();
  const recentOrdersQuery = useOrders({ limit: 5 });
  // Punto Cero is superadmin-only on the backend — skip the request (403)
  // for every other role and let the query default keep the banner hidden.
  const puntoCeroQuery = usePuntoCero(isSuperAdmin);

  const summary = summaryQuery.data;
  const alerts = alertsQuery.data ?? [];
  const recentOrders = recentOrdersQuery.data?.items ?? [];
  const recentTotal = recentOrdersQuery.data?.total ?? 0;
  // Defaults to finalized so a failed setup fetch never flashes the banner.
  const setupFinalized = puntoCeroQuery.data?.finalized ?? true;

  const refreshing = summaryQuery.isFetching && !summaryQuery.isLoading;

  const refreshAll = () => {
    void summaryQuery.refetch();
    void alertsQuery.refetch();
    void recentOrdersQuery.refetch();
    if (isSuperAdmin) void puntoCeroQuery.refetch();
  };

  if (summaryQuery.isLoading) {
    return <LoadingState label="Cargando el estado del negocio…" />;
  }

  if (!summary) {
    return (
      <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
        <MuiAlert severity="error" sx={{ m: 2 }}>
          {summaryQuery.error instanceof Error
            ? summaryQuery.error.message
            : 'Error al cargar los datos'}
        </MuiAlert>
      </Box>
    );
  }

  const firstName = user?.name?.trim().split(/\s+/)[0] || 'Admin';
  const vencidasClear = summary.vencidas.count === 0;
  const deudoresClear = summary.clientesDeudores === 0;
  const debtTotal = summary.porCobrar;

  const pendingAlert = alerts.find((a) => a.type === 'pending_orders');

  const entregas = summary.entregasHoy;
  const pendientes = summary.pendientesHoy;
  const repartosTotal = entregas + pendientes;
  const progressPct = repartosTotal > 0 ? Math.round((entregas / repartosTotal) * 100) : 0;

  // Collection rate today = actually collected (gross) / billed today.
  // Guarded so a zero-sales day renders 0% instead of NaN.
  const pctCobrado =
    summary.ventasHoy > 0 ? Math.round((summary.cobradoHoy / summary.ventasHoy) * 100) : 0;
  const cobradoFull = pctCobrado >= 100;

  /** Today's per-channel split — only channels with sales are shown. */
  const ventasPorCanalHoy = (summary.ventasPorCanal ?? []).filter((c) => c.monto > 0);

  /** Per-account balances — defensive fallback keeps the strip valid on a
   *  legacy/partial backend (saldos missing → collapse everything into cash). */
  const saldos = summary.saldos ?? {
    efectivo: summary.caja,
    mercadopago: 0,
    banco: 0,
    total: summary.caja,
  };

  const lowStock = summary.stock
    .filter((s) => s.quantity != null && s.threshold != null && s.quantity < s.threshold)
    .sort((a, b) => (a.quantity ?? 0) - (b.quantity ?? 0));
  const lowStockCount = lowStock.length;
  const topDebtors = summary.deudas.slice(0, 7);

  // Signed day movement for the Caja Total footer.
  const cajaHoySigned = `${summary.cajaHoy >= 0 ? '+' : '−'}${formatMoney(Math.abs(summary.cajaHoy))}`;

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
      {/* ── Punto Cero banner ──────────────────────
          Superadmin-only: the setup is the business baseline and stays
          until finalized. Hidden for other roles (setup is superadmin-only
          on the backend too). */}
      {user?.role === 'superadmin' && !setupFinalized && (
        <MuiCard
          sx={{
            mb: 3,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            bgcolor: 'primaryContainer',
            borderColor: 'transparent',
            borderRadius: '24px',
            flexWrap: 'wrap',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 44,
              height: 44,
              borderRadius: m3Shape.medium,
              bgcolor: 'onPrimaryContainer',
              color: 'primaryContainer',
              flexShrink: 0,
            }}
          >
            <IconPointOfSale size={22} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 200 }}>
            <Typography variant="titleSmall" sx={{ fontWeight: 700, color: 'onPrimaryContainer' }}>
              Configurá el Punto Cero
            </Typography>
            <Typography variant="body2" color="onPrimaryContainer" sx={{ opacity: 0.8 }}>
              Stock inicial, caja y deudas de arranque del negocio.
            </Typography>
          </Box>
          <MuiButton variant="primary" onClick={() => navigate('/setup/punto-cero')}>
            Configurar
          </MuiButton>
        </MuiCard>
      )}

      {/* ── Greeting + status chips ────────────────
          A warm morning briefing: egg in the brand green chip, greeting
          with the owner's first name, role/date line, live chips and the
          refresh control on the right. */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 3 }}>
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 48,
                height: 48,
                borderRadius: '50%',
                bgcolor: 'secondaryContainer',
                color: 'onSecondaryContainer',
                flexShrink: 0,
              }}
            >
              <IconEgg size={24} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="overline" color="onSurfaceVariant" sx={{ display: 'block' }}>
                El Huevo Líder
              </Typography>
              <Typography
                variant="h5"
                sx={{ fontWeight: 800, letterSpacing: '-0.02em', color: 'onSurface', lineHeight: 1.2 }}
              >
                ¡{greeting()}, {firstName}! 👋
              </Typography>
            </Box>
          </Box>
          <Typography variant="body2" color="onSurfaceVariant">
            Administración · {formatDate()}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 1.5 }}>
            <PillChip bg="successContainer" fg="onSuccessContainer">
              <Box
                component="span"
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: 'success.main',
                  display: 'inline-block',
                  flexShrink: 0,
                  animation: `${pulse} 2s infinite`,
                }}
              />
              <Typography variant="labelMedium" sx={{ fontWeight: 600 }}>Jornada activa</Typography>
            </PillChip>
            <PillChip bg="secondaryContainer" fg="onSecondaryContainer">
              <IconTruck size={14} />
              <Typography variant="labelMedium" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                {entregas}
              </Typography>
              <Typography variant="labelMedium" sx={{ fontWeight: 600, opacity: 0.8 }}>
                entregas · {pendientes} pendientes hoy
              </Typography>
            </PillChip>
          </Box>
        </Box>
        <MuiIconButton
          aria-label="Actualizar dashboard"
          onClick={refreshAll}
          disabled={refreshing}
          sx={{ bgcolor: 'surfaceContainerLow', color: 'onSurfaceVariant' }}
        >
          <Box sx={{ display: 'flex', animation: refreshing ? `${spin} 0.9s linear infinite` : undefined }}>
            <IconRefresh size={20} />
          </Box>
        </MuiIconButton>
      </Box>

      {/* ── Repartos de hoy (hero) ─────────────────
          Only when there is delivery activity today. Progress track +
          "próxima parada" callout built from real summary data. */}
      {repartosTotal > 0 && (
        <MuiCard
          sx={{ mb: 4, bgcolor: 'primaryContainer', borderColor: 'transparent', borderRadius: '24px' }}
        >
          <Box
            sx={{
              display: 'grid',
              gap: 3,
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 3fr) minmax(0, 2fr)' },
            }}
          >
            <Box>
              <PillChip bg="surface" fg="primary.main">
                <IconPlay size={14} />
                <Typography variant="labelMedium" sx={{ fontWeight: 700 }}>En Curso · Hoy</Typography>
              </PillChip>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2, mb: 0.5 }}>
                <Box sx={{ display: 'flex', color: 'onPrimaryContainer' }}>
                  <IconTruck size={22} />
                </Box>
                <Typography variant="titleLarge" sx={{ fontWeight: 700, color: 'onPrimaryContainer' }}>
                  Repartos de hoy
                </Typography>
              </Box>
              <Typography variant="body2" color="onPrimaryContainer" sx={{ opacity: 0.8, mb: 2 }}>
                {entregas} entregas · {pendientes} pendientes
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
                <Typography variant="labelMedium" color="onPrimaryContainer" sx={{ fontWeight: 600, opacity: 0.9 }}>
                  {entregas} de {repartosTotal} entregas completadas
                </Typography>
                <Typography variant="labelMedium" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'onPrimaryContainer' }}>
                  {progressPct}%
                </Typography>
              </Box>
              <Box sx={{ height: 10, borderRadius: m3Shape.full, bgcolor: 'surface', overflow: 'hidden' }}>
                <Box
                  sx={{
                    width: `${progressPct}%`,
                    height: '100%',
                    borderRadius: m3Shape.full,
                    bgcolor: 'primary.main',
                    transition: 'width 0.4s ease',
                  }}
                />
              </Box>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ bgcolor: 'surfaceContainerLow', borderRadius: m3Shape.medium, p: 2 }}>
                <Typography variant="overline" color="onSurfaceVariant" sx={{ display: 'block', mb: 0.5 }}>
                  Próxima parada
                </Typography>
                <Typography variant="titleSmall" sx={{ fontWeight: 600, color: 'onSurface' }}>
                  Pendientes por asignar:{' '}
                  <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    {pendingAlert?.count ?? pendientes}
                  </Box>
                </Typography>
                {pendingAlert?.totalAmount !== undefined && (
                  <Typography variant="body2" color="onSurfaceVariant" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 600, mt: 0.5 }}>
                    {formatMoney(pendingAlert.totalAmount)} en órdenes pendientes
                  </Typography>
                )}
              </Box>
              <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                <MuiButton variant="secondary" onClick={() => navigate('/orders/new')} startIcon={<IconPlus size={18} />}>
                  Nuevo Pedido
                </MuiButton>
                <MuiButton variant="primary" onClick={() => navigate('/routes')} startIcon={<IconRoute size={18} />}>
                  Ver Rutas
                </MuiButton>
              </Box>
            </Box>
          </Box>
        </MuiCard>
      )}

      {/* ── KPI grid ────────────────────────────── */}
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' },
          mb: 4,
        }}
      >
        {/* value = billed today (ventasHoy); footer = actually collected
            today, gross (cobradoHoy). The pill is the collection rate. */}
        <KpiCard
          label="Ventas de hoy"
          value={formatMoney(summary.ventasHoy)}
          icon={<IconPayments size={20} />}
          tone="tertiary"
          footer={`Cobrado hoy: ${formatMoney(summary.cobradoHoy)}`}
          pill={
            <PillChip
              bg={cobradoFull ? 'successContainer' : 'warningContainer'}
              fg={cobradoFull ? 'onSuccessContainer' : 'onWarningContainer'}
            >
              <IconCheck size={14} />
              <Typography variant="labelMedium" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                {pctCobrado}%
              </Typography>
              <Typography variant="labelMedium" sx={{ fontWeight: 600, opacity: 0.8 }}>cobrado</Typography>
            </PillChip>
          }
          onClick={() => navigate('/orders')}
        />
        <KpiCard
          label="Por Cobrar"
          value={formatMoney(debtTotal)}
          icon={<IconCreditCard size={20} />}
          tone="primary"
          footer={`${summary.clientesDeudores} ${summary.clientesDeudores === 1 ? 'cliente' : 'clientes'} con saldo`}
          pill={
            vencidasClear ? (
              <PillChip bg="successContainer" fg="onSuccessContainer">
                <Typography variant="labelMedium" sx={{ fontWeight: 600 }}>sin vencidas</Typography>
              </PillChip>
            ) : (
              <PillChip bg="errorContainer" fg="onErrorContainer">
                <Typography variant="labelMedium" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                  {summary.vencidas.count}
                </Typography>
                <Typography variant="labelMedium" sx={{ fontWeight: 600, opacity: 0.8 }}>
                  vencidas · {formatMoney(summary.vencidas.total)}
                </Typography>
              </PillChip>
            )
          }
          onClick={() => navigate('/customers')}
        />
        <KpiCard
          label="Caja Total"
          value={formatMoney(summary.caja)}
          icon={<IconWallet size={20} />}
          tone="success"
          footer={
            <Box
              component="span"
              sx={{ color: summary.cajaHoy >= 0 ? 'success.main' : 'error.main' }}
            >
              Hoy: {cajaHoySigned}
            </Box>
          }
          pill={
            summary.cierreHoy.closed ? (
              <PillChip bg="successContainer" fg="onSuccessContainer">
                <IconCheck size={14} />
                <Typography variant="labelMedium" sx={{ fontWeight: 600 }}>Al día</Typography>
              </PillChip>
            ) : (
              <PillChip bg="warningContainer" fg="onWarningContainer">
                <IconClock size={14} />
                <Typography variant="labelMedium" sx={{ fontWeight: 600 }}>Cierre pendiente</Typography>
              </PillChip>
            )
          }
          onClick={() => navigate('/cuentas/movimientos')}
        />
        <KpiCard
          label="Valor de Depósito"
          value={formatMoney(summary.totalStockValue)}
          icon={<IconBox size={20} />}
          tone="error"
          footer={`${summary.stock.length} ${summary.stock.length === 1 ? 'producto' : 'productos'} en stock`}
          pill={
            lowStockCount > 0 ? (
              <PillChip bg="errorContainer" fg="onErrorContainer">
                <IconWarning size={14} />
                <Typography variant="labelMedium" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                  {lowStockCount}
                </Typography>
                <Typography variant="labelMedium" sx={{ fontWeight: 600, opacity: 0.8 }}>bajos</Typography>
              </PillChip>
            ) : (
              <PillChip bg="successContainer" fg="onSuccessContainer">
                <IconCheck size={14} />
                <Typography variant="labelMedium" sx={{ fontWeight: 600 }}>Stock OK</Typography>
              </PillChip>
            )
          }
          onClick={() => navigate('/products')}
        />
      </Box>

      {/* ── Saldos por cuenta ─────────────────────
          Per-account money balances. The Caja Total KPI above is the sum
          of these three. Admins get the manual adjustment action. */}
      <SectionHeader
        icon={<IconPayments size={14} />}
        title="Saldos por Cuenta"
        action={
          (user?.role === 'admin' || isSuperAdmin) && (
            <MuiButton
              variant="ghost"
              size="sm"
              startIcon={<IconTune size={16} />}
              onClick={() => navigate('/cuentas/movimientos')}
              sx={{ color: 'primary.main', fontWeight: 700 }}
            >
              Ajustar caja
            </MuiButton>
          )
        }
      />
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(3, minmax(0, 1fr))' },
          mb: 4,
        }}
      >
        <AccountTile
          code="Cash"
          label="Efectivo"
          value={formatMoney(saldos.efectivo)}
          icon={<IconMoney size={20} />}
          tone="success"
        />
        <AccountTile
          code="MP"
          label="Mercado Pago"
          value={formatMoney(saldos.mercadopago)}
          icon={<IconQrCode size={20} />}
          tone="info"
        />
        <AccountTile
          code="Bco"
          label="Banco"
          value={formatMoney(saldos.banco)}
          icon={<IconBank size={20} />}
          tone="neutral"
          muted={saldos.banco === 0}
        />
      </Box>

      {/* ── Ventas por canal (hoy) ──────────────
          Compact per-channel split of today's sales. Hidden when there
          are no sales today. */}
      {ventasPorCanalHoy.length > 0 && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            flexWrap: 'wrap',
            mb: 4,
            px: 2,
            py: 1.5,
            borderRadius: '20px',
            bgcolor: 'surfaceContainerLow',
            border: 1,
            borderColor: (t: Theme) => alpha(t.palette.outlineVariant, 0.5),
          }}
        >
          <Typography variant="caption" color="onSurfaceVariant" sx={{ fontWeight: 700, flexShrink: 0 }}>
            Hoy por canal
          </Typography>
          {ventasPorCanalHoy.map((item) => (
            <PillChip key={item.canal} bg="surfaceContainerHigh" fg="onSurfaceVariant">
              <Typography variant="labelMedium" sx={{ fontWeight: 600 }}>
                {SALES_CHANNEL_LABELS[item.canal] ?? item.canal}
              </Typography>
              <Typography variant="labelMedium" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                {formatMoney(item.monto)}
              </Typography>
            </PillChip>
          ))}
        </Box>
      )}

      {/* ── Acciones rápidas ────────────────────── */}
      <Box sx={{ mb: 4 }}>
        <SectionHeader icon={<IconBolt size={14} />} title="Acciones Rápidas" />
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
          <QuickAction
            icon={<IconPlus size={22} />}
            label="Nuevo Pedido"
            variant="primary"
            onClick={() => navigate('/orders/new')}
          />
          <QuickAction
            icon={<IconPointOfSale size={22} />}
            label="Cuentas Cobrar"
            tone="secondary"
            onClick={() => navigate('/customers')}
          />
          <QuickAction
            icon={<IconStock size={22} />}
            label="Stock en Depósito"
            tone="primary"
            onClick={() => navigate('/products')}
          />
          <QuickAction
            icon={<IconShoppingCart size={22} />}
            label="Registro Compras"
            tone="tertiary"
            onClick={() => navigate('/compras')}
          />
        </Box>
      </Box>

      {/* ── Stock crítico ─────────────────────────
          Only when at least one product is under its threshold. Shows
          the lowest items first — the restock list for the next run. */}
      {lowStockCount > 0 && (
        <Box sx={{ mb: 4 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              px: 2,
              py: 1.5,
              borderTopLeftRadius: '24px',
              borderTopRightRadius: '24px',
              bgcolor: (t: Theme) => alpha(t.palette.error.main, 0.08),
              border: 1,
              borderBottom: 0,
              borderColor: (t: Theme) => alpha(t.palette.outlineVariant, 0.5),
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 40,
                height: 40,
                borderRadius: m3Shape.medium,
                flexShrink: 0,
                bgcolor: (t: Theme) => alpha(t.palette.error.main, 0.14),
                color: 'error.main',
              }}
            >
              <IconWarehouse size={20} />
            </Box>
            <Typography variant="titleSmall" sx={{ fontWeight: 700, color: 'onSurface', flex: 1 }}>
              Stock crítico
            </Typography>
            <PillChip bg="errorContainer" fg="onErrorContainer">
              <IconWarning size={14} />
              <Typography variant="labelMedium" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                {lowStockCount}
              </Typography>
              <Typography variant="labelMedium" sx={{ fontWeight: 600, opacity: 0.8 }}>bajos</Typography>
            </PillChip>
          </Box>
          <Box
            sx={{
              p: 2,
              bgcolor: 'surfaceContainerLow',
              border: 1,
              borderColor: (t: Theme) => alpha(t.palette.outlineVariant, 0.5),
              borderBottomLeftRadius: '24px',
              borderBottomRightRadius: '24px',
              display: 'grid',
              gap: 1.5,
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' },
            }}
          >
            {lowStock.slice(0, 6).map((item) => (
              <LowStockRow
                key={item.productId}
                item={item}
                onClick={() => navigate(`/products/${item.productId}`)}
              />
            ))}
          </Box>
        </Box>
      )}

      {/* ── Cuentas por cobrar ────────────────────
          One card, divide-y rows, top 7 debtors, then a full-width
          action into the customers page. */}
      <Box sx={{ mb: 4 }}>
        <SectionHeader
          icon={<IconCreditCard size={14} />}
          title="Cuentas por Cobrar"
          action={
            <PillChip bg="surfaceContainerHigh" fg="onSurfaceVariant">
              <Typography variant="labelMedium" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                {summary.clientesDeudores}
              </Typography>
              <Typography variant="labelMedium" sx={{ fontWeight: 600, opacity: 0.8 }}>
                {summary.clientesDeudores === 1 ? 'deudor' : 'deudores'}
              </Typography>
            </PillChip>
          }
        />
        <Box sx={listShell}>
          {deudoresClear || topDebtors.length === 0 ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2 }}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 40,
                  height: 40,
                  borderRadius: m3Shape.medium,
                  bgcolor: 'successContainer',
                  color: 'onSuccessContainer',
                  flexShrink: 0,
                }}
              >
                <IconCheck size={22} />
              </Box>
              <Box>
                <Typography variant="titleSmall" sx={{ fontWeight: 600, color: 'onSurface' }}>
                  No hay deudas pendientes
                </Typography>
                <Typography variant="body2" color="onSurfaceVariant">
                  Todos los clientes están al día.
                </Typography>
              </Box>
            </Box>
          ) : (
            <>
              {topDebtors.map((deuda, index) => (
                <Box key={deuda.customerId}>
                  {index > 0 && <Divider sx={{ borderColor: (t: Theme) => alpha(t.palette.outlineVariant, 0.5) }} />}
                  <DebtorRow deuda={deuda} onClick={() => navigate(`/customers/${deuda.customerId}`)} />
                </Box>
              ))}
              <Divider sx={{ borderColor: (t: Theme) => alpha(t.palette.outlineVariant, 0.5) }} />
              <MuiButton
                variant="ghost"
                fullWidth
                onClick={() => navigate('/customers')}
                endIcon={<IconArrowRight size={18} />}
                sx={{ color: 'primary.main', fontWeight: 700, borderRadius: 0 }}
              >
                Ver todos los {summary.clientesDeudores} clientes con saldo
              </MuiButton>
            </>
          )}
        </Box>
      </Box>

      {/* ── Alertas (supporting) ──────────────────
          Preserved from the previous dashboard. One card with compact
          rows; hidden when there is nothing to report. */}
      {alerts.length > 0 && (
        <Box sx={{ mb: 4 }}>
          <SectionHeader icon={<IconBell size={14} />} title="Alertas" />
          <Box sx={listShell}>
            {alerts.map((alert, index) => (
              <Box key={alert.type}>
                {index > 0 && <Divider sx={{ borderColor: (t: Theme) => alpha(t.palette.outlineVariant, 0.5) }} />}
                <AlertRow alert={alert} />
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* ── Últimas órdenes ───────────────────────
          Preserved from the previous dashboard, restyled as one card. */}
      <Box sx={{ mb: 4 }}>
        <SectionHeader
          icon={<IconReceiptLong size={14} />}
          title="Últimas Órdenes"
          action={
            <Typography variant="labelMedium" color="onSurfaceVariant" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
              {recentTotal} total
            </Typography>
          }
        />
        <Box sx={listShell}>
          {recentOrders.length === 0 ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2 }}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 40,
                  height: 40,
                  borderRadius: m3Shape.medium,
                  bgcolor: 'surfaceContainerHigh',
                  color: 'onSurfaceVariant',
                  flexShrink: 0,
                }}
              >
                <IconInbox size={22} />
              </Box>
              <Box>
                <Typography variant="titleSmall" sx={{ fontWeight: 600, color: 'onSurface' }}>
                  Sin órdenes todavía
                </Typography>
                <Typography variant="body2" color="onSurfaceVariant">
                  Las órdenes nuevas aparecerán acá.
                </Typography>
              </Box>
            </Box>
          ) : (
            <>
              {recentOrders.map((order, index) => (
                <Box key={order._id}>
                  {index > 0 && <Divider sx={{ borderColor: (t: Theme) => alpha(t.palette.outlineVariant, 0.5) }} />}
                  <OrderRow order={order} onClick={() => navigate(`/orders/${order._id}`)} />
                </Box>
              ))}
              <Divider sx={{ borderColor: (t: Theme) => alpha(t.palette.outlineVariant, 0.5) }} />
              <MuiButton
                variant="ghost"
                fullWidth
                onClick={() => navigate('/orders')}
                endIcon={<IconArrowRight size={18} />}
                sx={{ color: 'primary.main', fontWeight: 700, borderRadius: 0 }}
              >
                Ver todas
              </MuiButton>
            </>
          )}
        </Box>
      </Box>

    </Box>
  );
}
