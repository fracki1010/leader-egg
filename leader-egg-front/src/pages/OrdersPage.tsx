import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keyframes } from '@emotion/react';
import type { OrderListFilters } from '../api/orders.ts';
import { useOrders } from '../hooks/queries/index.ts';
import type { Order, OrderItem, OrderStatus, OrderChannel, SalesChannel } from '../types/index.ts';
import { maplesCountLabel, orderLineLabel, orderMaplesTotal } from '../lib/units.ts';
import { MuiButton, MuiChip, MuiTextField, MuiFab, PageHeader, LoadingState, EmptyState } from '../components/ui/index.ts';
import {
  IconOrder,
  IconPlus,
  IconSync,
  IconSearch,
  IconTune,
  IconClock,
  IconTruck,
  IconCheck,
  IconX,
  IconArrowLeft,
  IconArrowRight,
  IconChevronRight,
  IconCalendar,
  IconHistory,
  IconBox,
  IconPayments,
  IconStock,
  IconLocation,
  IconPhone,
  IconWhatsapp,
  IconStorefront,
  IconDownload,
} from '../components/ui/icons.tsx';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import Badge from '@mui/material/Badge';
import Collapse from '@mui/material/Collapse';
import useMediaQuery from '@mui/material/useMediaQuery';
import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';

/* ── Types ──────────────────────────────────── */

type StatusFilter = 'all' | OrderStatus;

const PAGE_SIZE = 50;

const statusLabelMap: Record<OrderStatus, string> = {
  pending: 'Pendiente',
  assigned: 'Asignada',
  in_transit: 'En Camino',
  delivered: 'Entregada',
  cancelled: 'Cancelada',
};

/* ── Shared style fragments ──────────────────── */

/** Numbers/data: mono + tabular so columns never jitter. */
const MONO = {
  fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums',
} as const;

/** Small uppercase metadata label (10–11px with tracking). */
const LABEL = {
  fontSize: '0.6875rem',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  lineHeight: 1.2,
} as const;

/* Status badge tones — semantic M3 role pairs so light and dark both
   keep AA contrast. The dot carries the status hue; the pill carries
   the container pair. */

interface StatusTone {
  bg: string;
  fg: string;
  dot: string;
}

const statusChipTone: Record<OrderStatus, StatusTone> = {
  pending: { bg: 'warningContainer', fg: 'onWarningContainer', dot: 'warning.main' },
  assigned: { bg: 'primaryContainer', fg: 'onPrimaryContainer', dot: 'primary.main' },
  in_transit: { bg: 'primaryContainer', fg: 'onPrimaryContainer', dot: 'primary.main' },
  delivered: { bg: 'successContainer', fg: 'onSuccessContainer', dot: 'success.main' },
  cancelled: { bg: 'errorContainer', fg: 'onErrorContainer', dot: 'error.main' },
};

/* Quick filter chips — each carries its live count badge in the label. */
const countFilters: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'assigned', label: 'Asignadas' },
  { value: 'in_transit', label: 'En Camino' },
  { value: 'delivered', label: 'Entregadas' },
  { value: 'cancelled', label: 'Canceladas' },
];

/* ── Quick date ranges (local calendar days) ── */

type QuickRange = 'today' | 'yesterday' | 'month' | '90d';

const quickRanges: { value: QuickRange; label: string; icon: React.ReactElement }[] = [
  { value: 'today', label: 'Hoy', icon: <IconClock size={14} /> },
  { value: 'yesterday', label: 'Ayer', icon: <IconArrowLeft size={14} /> },
  { value: 'month', label: 'Este mes', icon: <IconCalendar size={14} /> },
  { value: '90d', label: '90 días', icon: <IconHistory size={14} /> },
];

const toDateStr = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

function rangeForQuick(value: QuickRange): { from: string; to: string } {
  const now = new Date();
  const today = toDateStr(now);

  if (value === 'today') return { from: today, to: today };

  if (value === 'yesterday') {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const str = toDateStr(d);
    return { from: str, to: str };
  }

  if (value === 'month') {
    const from = toDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
    return { from, to: today };
  }

  // 90 days
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return { from: toDateStr(d), to: today };
}

const fmtMoney = (val: number) =>
  `$ ${val.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

const fmtDate = (d: Date) =>
  d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });

const fmtTime = (d: Date) =>
  d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });

/** Business/sale date shown in every date-based view (legacy orders fall back to createdAt). */
const orderDisplayDate = (order: Order): Date => new Date(order.orderDate ?? order.createdAt);

/* ── Global stats (counts + daily summary) ─────
   One unfiltered limit=200 fetch (cheap heuristic, same as the route
   order selector): per-status counts for the quick chips + today's
   daily-summary metrics. The paged list below drives the visible rows. */

interface OrderStats {
  total: number;
  byStatus: Record<OrderStatus, number>;
  todayCount: number;
  forTodayCount: number;
  deliveredToday: number;
  todayMaples: number;
  todayTotal: number;
}

function computeStats(items: Order[], total: number): OrderStats {
  const today = toDateStr(new Date());
  const todayItems = items.filter((o) => toDateStr(orderDisplayDate(o)) === today);
  const byStatus: Record<OrderStatus, number> = { pending: 0, assigned: 0, in_transit: 0, delivered: 0, cancelled: 0 };
  for (const o of items) byStatus[o.status] += 1;
  return {
    total,
    byStatus,
    todayCount: todayItems.length,
    forTodayCount: todayItems.filter((o) => o.status === 'assigned' || o.status === 'in_transit').length,
    deliveredToday: todayItems.filter((o) => o.status === 'delivered').length,
    todayMaples: todayItems.reduce((acc, o) => acc + o.items.reduce((a, i) => a + i.quantity, 0), 0),
    todayTotal: todayItems.reduce((acc, o) => acc + o.totalAmount, 0),
  };
}

/* ── Channel metadata for the card subtitle line ── */

const channelMeta: Record<OrderChannel, { label: string; icon: React.ReactElement }> = {
  phone: { label: 'Pedido por teléfono', icon: <IconPhone size={14} /> },
  whatsapp: { label: 'Pedido por WhatsApp', icon: <IconWhatsapp size={14} /> },
  driver_visit: { label: 'Pedido presencial', icon: <IconTruck size={14} /> },
  walk_in: { label: 'Venta de mostrador', icon: <IconStorefront size={14} /> },
};

/* ── Sales-channel metadata for the card chip ──
   Where the sale was made (distinct from the contact channel). Legacy
   orders without the field fall back to 'reparto'. */

const salesChannelMeta: Record<SalesChannel, { label: string }> = {
  reparto: { label: 'Reparto' },
  puesto: { label: 'Puesto' },
  whatsapp: { label: 'WhatsApp' },
  otro: { label: 'Otro' },
};

/* ── Pulsing live dot (daily summary) ────────── */

const pulseDot = keyframes`
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--mui-palette-success-main) 45%, transparent); }
  70% { box-shadow: 0 0 0 8px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
`;

/* ── Status / channel badges ───────────────────
   Dot + label inside a tonal pill. Status uses the semantic container
   pair; the sales channel stays a quiet neutral pill. */

function StatusBadge({ status }: { status: OrderStatus }) {
  const tone = statusChipTone[status];
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.625,
        px: 1,
        py: 0.375,
        borderRadius: '999px',
        bgcolor: tone.bg,
        color: tone.fg,
        fontSize: '0.6875rem',
        fontWeight: 700,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      <Box
        component="span"
        aria-hidden
        sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: tone.dot, flexShrink: 0 }}
      />
      {statusLabelMap[status]}
    </Box>
  );
}

function SalesChannelBadge({ channel }: { channel?: SalesChannel }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: 1,
        py: 0.375,
        borderRadius: '999px',
        bgcolor: 'surfaceContainerHigh',
        border: 1,
        borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.5),
        color: 'onSurfaceVariant',
        fontSize: '0.6875rem',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {salesChannelMeta[channel ?? 'reparto'].label}
    </Box>
  );
}

/* ── Payment badge ─────────────────────────────
   Settled → green "Pagado" pill. Outstanding → red label + an
   errorContainer amount pill (the amount is the actionable datum). */

function PaymentBadge({ balance }: { balance: number }) {
  if (balance > 0) {
    return (
      <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
        <Typography
          component="p"
          sx={{ fontSize: '0.6875rem', fontWeight: 700, color: 'error.main', lineHeight: 1.2 }}
        >
          Saldo pendiente
        </Typography>
        <Box
          component="span"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            mt: 0.5,
            px: 1,
            py: 0.25,
            borderRadius: '999px',
            bgcolor: 'errorContainer',
            color: 'onErrorContainer',
            ...MONO,
            fontSize: '0.75rem',
            fontWeight: 700,
          }}
        >
          {fmtMoney(balance)}
        </Box>
      </Box>
    );
  }

  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        py: 0.4,
        borderRadius: '999px',
        bgcolor: 'successContainer',
        color: 'onSuccessContainer',
        fontSize: '0.75rem',
        fontWeight: 700,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      <IconCheck size={13} /> Pagado
    </Box>
  );
}

/* ── Items box ─────────────────────────────────
   Inset tonal box: amber-tinted inventory square, the first two item
   lines (truncated with an ellipsis) and a total-maples sub-line. */

function ItemsBox({ items }: { items: OrderItem[] }) {
  const totalMaples = orderMaplesTotal(items);
  const firstLines = items.slice(0, 2).map(orderLineLabel);
  const breakdown = items.length > 2 ? `${firstLines.join(' + ')} + …` : firstLines.join(' + ');

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        px: 1.25,
        py: 1.125,
        borderRadius: '16px',
        bgcolor: (theme) => alpha(theme.palette.surfaceContainerHighest, 0.6),
        minWidth: 0,
      }}
    >
      <Box
        aria-hidden
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: '12px',
          bgcolor: (theme) => alpha(theme.palette.tertiary.main, 0.18),
          color: 'tertiary.main',
          flexShrink: 0,
        }}
      >
        <IconBox size={18} />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          component="p"
          sx={{
            fontSize: '0.8125rem',
            fontWeight: 600,
            color: 'onSurface',
            lineHeight: 1.35,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {items.length ? breakdown : 'Sin productos'}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.625, mt: 0.25, color: 'onSurfaceVariant' }}>
          <Box
            aria-hidden
            sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: 'outline', flexShrink: 0 }}
          />
          <Typography component="p" sx={{ fontSize: '0.6875rem', fontWeight: 600 }}>
            {totalMaples > 0 ? `${maplesCountLabel(totalMaples)} en total` : 'Sin detalle de productos'}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

/* ── Order card ────────────────────────────────
   surfaceContainer card, 24px radius, 1px outlineVariant/60 border,
   soft shadow → hover border shift. Cancelled orders get the 4px
   error-gradient top stripe from the mockup. The whole card is the
   click target → order detail. */

function OrderCard({ order, onClick }: { order: Order; onClick: () => void }) {
  const isCancelled = order.status === 'cancelled';
  const businessDate = orderDisplayDate(order);
  const isToday = toDateStr(businessDate) === toDateStr(new Date());
  // Time only makes sense while the sale and the capture day coincide.
  const timelineLabel = isToday
    ? `Hoy ${fmtDate(businessDate)} · ${fmtTime(new Date(order.createdAt))} hs`
    : fmtDate(businessDate);

  const hasAddress = !!order.deliveryAddress;
  const subtitleIcon = hasAddress ? <IconLocation size={14} /> : channelMeta[order.channel].icon;
  const subtitleText = hasAddress ? order.deliveryAddress : channelMeta[order.channel].label;

  return (
    <Box
      component="button"
      onClick={onClick}
      aria-label={`Ver orden ${order.orderNumber}`}
      sx={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        color: 'inherit',
        font: 'inherit',
        bgcolor: 'surfaceContainer',
        border: 1,
        borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.6),
        borderRadius: '24px',
        boxShadow: 1,
        p: 2,
        pt: isCancelled ? 2.5 : 2,
        overflow: 'hidden',
        transition:
          'border-color 0.2s cubic-bezier(0.2, 0, 0, 1), box-shadow 0.2s cubic-bezier(0.2, 0, 0, 1), transform 0.12s',
        '&:hover': {
          borderColor: (theme) => alpha(theme.palette.primary.main, 0.45),
          boxShadow: 3,
        },
        '&:active': { transform: 'scale(0.995)' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
      }}
    >
      {isCancelled && (
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 4,
            background: (theme) =>
              `linear-gradient(90deg, ${theme.palette.error.main} 0%, ${alpha(theme.palette.error.main, 0.16)} 100%)`,
          }}
        />
      )}

      {/* Header — order number + status + sales channel */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          flexWrap: 'wrap',
        }}
      >
        <Typography
          component="span"
          sx={{
            ...MONO,
            fontSize: '0.9375rem',
            fontWeight: 800,
            letterSpacing: '-0.02em',
            color: 'onSurface',
          }}
        >
          #{order.orderNumber}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
          <StatusBadge status={order.status} />
          <SalesChannelBadge channel={order.salesChannel} />
        </Box>
      </Box>

      {/* Customer + delivery address / contact channel */}
      <Box sx={{ minWidth: 0 }}>
        <Typography
          component="p"
          sx={{
            fontSize: '0.9375rem',
            fontWeight: 700,
            color: 'onSurface',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {order.customerName}
        </Typography>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            mt: 0.25,
            minWidth: 0,
            color: 'onSurfaceVariant',
            '& svg': { flexShrink: 0 },
          }}
        >
          {subtitleIcon}
          <Typography
            component="p"
            sx={{
              fontSize: '0.8125rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {subtitleText}
          </Typography>
        </Box>
      </Box>

      <ItemsBox items={order.items} />

      {/* Financials */}
      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography component="p" sx={{ ...LABEL, color: 'onSurfaceVariant' }}>
            Total
          </Typography>
          <Typography
            component="p"
            sx={{
              ...MONO,
              fontSize: '1.125rem',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              color: 'onSurface',
            }}
          >
            {fmtMoney(order.totalAmount)}
          </Typography>
        </Box>
        <PaymentBadge balance={order.balance} />
      </Box>

      {/* Footer — timeline / cancellation + detail affordance */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          pt: 1.25,
          borderTop: '1px dashed',
          borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.8),
          minWidth: 0,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.625,
            minWidth: 0,
            color: isCancelled ? 'error.main' : 'onSurfaceVariant',
          }}
        >
          {isCancelled ? <IconX size={14} /> : <IconClock size={14} />}
          <Typography
            component="span"
            sx={{
              fontSize: '0.6875rem',
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {isCancelled ? `Cancelada · ${fmtDate(businessDate)}` : timelineLabel}
          </Typography>
        </Box>
        <Box
          component="span"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.25,
            color: 'primary.main',
            fontSize: '0.75rem',
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          Detalles <IconChevronRight size={16} />
        </Box>
      </Box>
    </Box>
  );
}

/* ── Filter chip (status quick filters) ────────
   Active = primary filled + check icon; inactive = surfaceContainerHigh
   with a 1px outlineVariant border. */

function CountChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <MuiChip
      label={label}
      onClick={onClick}
      icon={active ? <IconCheck size={14} /> : undefined}
      variant="filled"
      sx={{
        flexShrink: 0,
        whiteSpace: 'nowrap',
        height: 34,
        fontSize: '0.75rem',
        fontWeight: active ? 700 : 600,
        border: 1,
        '& .MuiChip-label': { px: 1.5, fontSize: '0.75rem' },
        ...(active
          ? {
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              borderColor: 'primary.main',
              boxShadow: 1,
              '& .MuiChip-icon': { color: 'primary.contrastText' },
              '&:hover': { bgcolor: 'primary.dark' },
            }
          : {
              bgcolor: 'surfaceContainerHigh',
              color: 'onSurfaceVariant',
              borderColor: (theme: Theme) => alpha(theme.palette.outlineVariant, 0.6),
              '&:hover': { bgcolor: 'surfaceContainerHighest' },
            }),
      }}
    />
  );
}

/* ── Daily summary ─────────────────────────────
   Operational card: live pulse + today's count, a "for delivery today"
   warning pill and two mini stats (billed / volume). */

function StatTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'primary' | 'warning';
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        p: 1.25,
        borderRadius: '16px',
        bgcolor: (theme) => alpha(theme.palette.surfaceContainerLowest, 0.55),
        border: 1,
        borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.35),
        minWidth: 0,
      }}
    >
      <Box
        aria-hidden
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 38,
          height: 38,
          borderRadius: '12px',
          flexShrink: 0,
          bgcolor: (theme) =>
            alpha(
              tone === 'primary' ? theme.palette.primary.main : theme.palette.warning.main,
              0.16,
            ),
          color:
            tone === 'primary'
              ? 'primary.main'
              : (theme: Theme) =>
                  theme.palette.mode === 'dark'
                    ? theme.palette.warning.light
                    : theme.palette.warning.dark,
        }}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography component="p" sx={{ ...LABEL, color: 'onSurfaceVariant' }}>
          {label}
        </Typography>
        <Typography
          component="p"
          sx={{
            ...MONO,
            fontSize: '0.9375rem',
            fontWeight: 800,
            color: 'onSurface',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {value}
        </Typography>
      </Box>
    </Box>
  );
}

function OpsSummary({ stats }: { stats: OrderStats | null }) {
  return (
    <Box
      sx={{
        borderRadius: '24px',
        border: 1,
        borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.5),
        p: { xs: 2, sm: 2.5 },
        mb: 2.5,
        background: (theme) =>
          `linear-gradient(160deg, ${theme.palette.surfaceContainer} 0%, ${theme.palette.surfaceContainerHigh} 100%)`,
        boxShadow: 1,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1.5,
          flexWrap: 'wrap',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
          <Box
            aria-hidden
            sx={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              bgcolor: 'success.main',
              flexShrink: 0,
              animation: `${pulseDot} 1.8s ease-out infinite`,
            }}
          />
          <Typography
            component="p"
            sx={{ fontSize: { xs: '0.8125rem', sm: '0.875rem' }, color: 'onSurface' }}
          >
            <Box component="span" sx={{ ...MONO, fontWeight: 800 }}>
              {stats?.todayCount ?? 0}
            </Box>{' '}
            órdenes registradas hoy
          </Typography>
        </Box>
        <Box
          component="span"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.625,
            px: 1.25,
            py: 0.5,
            borderRadius: '999px',
            bgcolor: 'warningContainer',
            color: 'onWarningContainer',
            fontSize: '0.6875rem',
            fontWeight: 700,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          <IconClock size={14} />
          {stats?.forTodayCount ?? 0} para entregar hoy
        </Box>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
          gap: 1.25,
          mt: 1.75,
        }}
      >
        <StatTile
          tone="primary"
          icon={<IconPayments size={19} />}
          label="Facturado"
          value={fmtMoney(stats?.todayTotal ?? 0)}
        />
        <StatTile
          tone="warning"
          icon={<IconStock size={19} />}
          label="Volumen"
          value={`${stats?.todayMaples ?? 0} maples`}
        />
      </Box>
    </Box>
  );
}

/* ── Pagination dot generator ──────────────────
   Compact ellipsis window: up to 7 items, current ±1 around the
   active page, always anchored on 1 and the last page. */

function pageItems(count: number, current: number): (number | '…')[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const items: (number | '…')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(count - 1, current + 1);
  if (start > 2) items.push('…');
  for (let p = start; p <= end; p++) items.push(p);
  if (end < count - 1) items.push('…');
  items.push(count);
  return items;
}

/* ── OrdersPage ("Pedidos") ──────────
   Presentation rewrite of the M3 reference screen: header + total pill,
   operational summary, pill search with the date panel, scrollable
   count chips, tonal order cards → pagination → extended FAB.
   All data wiring is unchanged (paged + stats queries, debounce,
   filters, pagination, detail navigation, CSV export). */

export function OrdersPage() {
  const navigate = useNavigate();
  const showFabLabel = useMediaQuery('(min-width:360px)');

  const [page, setPage] = useState(1);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [quickRange, setQuickRange] = useState<QuickRange | 'custom'>('custom');

  // The tune button toggles the date-range panel (quick chips + pickers).
  const [filtersOpen, setFiltersOpen] = useState(false);

  const activeFilterCount =
    (statusFilter !== 'all' ? 1 : 0) + (search ? 1 : 0) + (from || to ? 1 : 0);
  const hasFilters = activeFilterCount > 0;

  // Debounce the search box (orderNumber / customerName) and reset to page 1.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filters: OrderListFilters = { limit: PAGE_SIZE, page };
  if (statusFilter !== 'all') filters.status = statusFilter;
  if (search) filters.search = search;
  if (from) filters.from = from;
  if (to) filters.to = to;

  // Paged list — the visible rows. Changing status/search/dates/page changes
  // the query key, so a fresh query runs automatically (no imperative reload).
  const ordersQuery = useOrders(filters);
  // Global stats (counts + daily summary) — independent of filters, one
  // unfiltered limit=200 fetch.
  const statsQuery = useOrders({ limit: 200 });

  const orders = ordersQuery.data?.items ?? [];
  const total = ordersQuery.data?.total ?? 0;
  const limit = ordersQuery.data?.limit || PAGE_SIZE;
  const loading = ordersQuery.isLoading;
  const error = ordersQuery.error
    ? ordersQuery.error instanceof Error
      ? ordersQuery.error.message
      : 'Error al cargar órdenes'
    : null;
  const stats = statsQuery.data
    ? computeStats(statsQuery.data.items, statsQuery.data.total)
    : null;

  const refresh = () => {
    void ordersQuery.refetch();
    void statsQuery.refetch();
  };

  const selectStatus = (value: StatusFilter) => {
    setStatusFilter(value);
    setPage(1);
  };

  const selectQuickRange = (value: QuickRange) => {
    const range = rangeForQuick(value);
    setQuickRange(value);
    setFrom(range.from);
    setTo(range.to);
    setPage(1);
  };

  const clearDates = () => {
    setQuickRange('custom');
    setFrom('');
    setTo('');
    setPage(1);
  };

  const selectManualFrom = (value: string) => {
    setFrom(value);
    setQuickRange('custom');
    setPage(1);
  };

  const selectManualTo = (value: string) => {
    setTo(value);
    setQuickRange('custom');
    setPage(1);
  };

  const clearFilters = () => {
    setStatusFilter('all');
    setSearchInput('');
    setSearch('');
    setQuickRange('custom');
    setFrom('');
    setTo('');
    setPage(1);
  };

  // CSV export of the currently loaded (filtered) rows — gives the
  // "Exportar" button a real job without a backend endpoint.
  const exportCsv = () => {
    if (orders.length === 0) return;
    const header = ['Nro', 'Cliente', 'Estado', 'Total', 'Saldo', 'Fecha'];
    const rows = orders.map((o) => [
      o.orderNumber,
      o.customerName,
      statusLabelMap[o.status],
      o.totalAmount.toFixed(2),
      o.balance.toFixed(2),
      new Date(o.orderDate ?? o.createdAt).toLocaleString('es-AR'),
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ordenes-${toDateStr(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pagesCount = Math.max(1, Math.ceil(total / limit));
  const dots = pageItems(pagesCount, page);

  if (loading && orders.length === 0) {
    return <LoadingState label="Cargando tus órdenes…" />;
  }

  return (
    <Box sx={{ maxWidth: 960, mx: 'auto' }}>
      {/* 1 — Heading: title + total pill, export + new order actions */}
      <PageHeader
        title="Pedidos"
        titleAdornment={
          <Box
            component="span"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              px: 1,
              py: 0.25,
              borderRadius: '999px',
              bgcolor: (theme) => alpha(theme.palette.primary.main, 0.14),
              color: 'primary.main',
              ...MONO,
              fontSize: '0.6875rem',
              fontWeight: 800,
              lineHeight: 1.4,
            }}
          >
            {stats?.total ?? total} total
          </Box>
        }
        subtitle="Gestión y seguimiento en tiempo real"
        icon={<IconOrder size={22} />}
        actions={
          <>
            <IconButton
              onClick={refresh}
              aria-label="Actualizar órdenes"
              title="Actualizar órdenes"
              sx={{
                width: 44,
                height: 44,
                borderRadius: '12px',
                border: 1,
                borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.6),
                bgcolor: 'surfaceContainer',
                color: 'onSurfaceVariant',
                '&:hover': { bgcolor: 'surfaceContainerHigh' },
              }}
            >
              <IconSync size={18} />
            </IconButton>
            <MuiButton
              variant="secondary"
              size="sm"
              startIcon={<IconDownload size={16} />}
              onClick={exportCsv}
              sx={{ minHeight: 44 }}
            >
              Exportar
            </MuiButton>
            <MuiButton
              variant="primary"
              size="sm"
              startIcon={<IconPlus size={16} />}
              onClick={() => navigate('/orders/new')}
              sx={{ minHeight: 44 }}
            >
              Nuevo Pedido
            </MuiButton>
          </>
        }
      />

      {/* 2 — Operational summary */}
      <OpsSummary stats={stats} />

      {/* 3 — Search + tune (date panel) */}
      <MuiTextField
        placeholder="Buscar por nro. de orden o cliente…"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        fullWidth
        slotProps={{
          htmlInput: { 'aria-label': 'Buscar por número de orden o cliente' },
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <IconSearch size={19} />
              </InputAdornment>
            ),
            endAdornment: (
              <InputAdornment position="end" sx={{ mr: -0.25 }}>
                <IconButton
                  onClick={() => setFiltersOpen((o) => !o)}
                  aria-expanded={filtersOpen}
                  aria-controls="orders-date-filters"
                  aria-label={
                    activeFilterCount > 0
                      ? `Filtros de fecha (${activeFilterCount} activos)`
                      : 'Filtros de fecha'
                  }
                  size="small"
                  sx={{
                    width: 38,
                    height: 38,
                    borderRadius: '10px',
                    border: 1,
                    borderColor: filtersOpen
                      ? (theme) => alpha(theme.palette.primary.main, 0.5)
                      : 'transparent',
                    bgcolor: filtersOpen
                      ? (theme) => alpha(theme.palette.primary.main, 0.12)
                      : 'transparent',
                    color: filtersOpen ? 'primary.main' : 'onSurfaceVariant',
                    '&:hover': {
                      bgcolor: filtersOpen
                        ? (theme) => alpha(theme.palette.primary.main, 0.18)
                        : 'surfaceContainerHigh',
                    },
                  }}
                >
                  <Badge
                    badgeContent={activeFilterCount}
                    color="primary"
                    invisible={activeFilterCount === 0}
                    sx={{
                      '& .MuiBadge-badge': {
                        fontSize: 10,
                        minWidth: 16,
                        height: 16,
                        fontWeight: 700,
                      },
                    }}
                  >
                    <IconTune size={19} />
                  </Badge>
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
        sx={{
          mb: filtersOpen ? 1.5 : 2.5,
          '& .MuiOutlinedInput-root': {
            borderRadius: '16px',
            bgcolor: 'surfaceContainer',
            minHeight: 52,
            boxShadow: 'none',
            '& fieldset': { borderColor: (theme: Theme) => alpha(theme.palette.outlineVariant, 0.6) },
            '&:hover fieldset': { borderColor: 'outline' },
            '&.Mui-focused': {
              boxShadow: (theme: Theme) => `0 0 0 3px ${alpha(theme.palette.primary.main, 0.18)}`,
              '& fieldset': { borderWidth: 1, borderColor: 'primary.main' },
            },
          },
        }}
      />

      {/* Collapsible date panel — quick ranges + manual pickers */}
      <Collapse in={filtersOpen} id="orders-date-filters" timeout={200}>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
            mb: 2.5,
            p: 2,
            borderRadius: '16px',
            bgcolor: 'surfaceContainerLow',
            border: 1,
            borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.4),
          }}
        >
          <Box
            sx={{
              display: 'flex',
              gap: 1,
              flexWrap: 'wrap',
              pb: 0.5,
            }}
          >
            {quickRanges.map((qr) => (
              <MuiChip
                key={qr.value}
                label={qr.label}
                icon={qr.icon}
                onClick={() => selectQuickRange(qr.value)}
                variant="filled"
                sx={{
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                  height: 32,
                  fontWeight: quickRange === qr.value ? 700 : 600,
                  ...(quickRange === qr.value
                    ? {
                        bgcolor: 'secondaryContainer',
                        color: 'onSecondaryContainer',
                        borderColor: 'secondaryContainer',
                        '& .MuiChip-icon': { color: 'onSecondaryContainer' },
                      }
                    : {
                        bgcolor: 'surfaceContainer',
                        color: 'onSurfaceVariant',
                        '&:hover': { bgcolor: 'surfaceContainerHigh' },
                      }),
                }}
              />
            ))}
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
            <MuiTextField
              label="Desde"
              type="date"
              value={from}
              onChange={(e) => selectManualFrom(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: { xs: '100%', sm: 160 } }}
            />
            <MuiTextField
              label="Hasta"
              type="date"
              value={to}
              onChange={(e) => selectManualTo(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: { xs: '100%', sm: 160 } }}
            />
            {(from || to) && (
              <MuiButton variant="ghost" size="sm" onClick={clearDates}>
                Limpiar fechas
              </MuiButton>
            )}
            {hasFilters && (
              <MuiButton variant="ghost" size="sm" startIcon={<IconX size={14} />} onClick={clearFilters}>
                Limpiar filtros
              </MuiButton>
            )}
          </Box>
        </Box>
      </Collapse>

      {/* 4 — Status chips with live counts (horizontal scroll) */}
      <Box
        sx={{
          display: 'flex',
          gap: 1,
          flexWrap: 'wrap',
          pb: 0.5,
          mb: 2.5,
        }}
      >
        {countFilters.map((f) => {
          const active = statusFilter === f.value;
          const count = f.value === 'all' ? (stats?.total ?? total) : (stats?.byStatus[f.value] ?? 0);
          return (
            <CountChip
              key={f.value}
              label={`${f.label} (${count})`}
              active={active}
              onClick={() => selectStatus(f.value)}
            />
          );
        })}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2.5, borderRadius: '16px' }}>
          {error}
        </Alert>
      )}

      {ordersQuery.isFetching && orders.length > 0 && (
        <LinearProgress
          sx={{
            mb: 1.5,
            height: 4,
            borderRadius: '999px',
            bgcolor: 'surfaceContainerHighest',
            '& .MuiLinearProgress-bar': { borderRadius: '999px' },
          }}
        />
      )}

      {/* 5 — Orders list */}
      {orders.length === 0 ? (
        <Box
          sx={{
            bgcolor: 'surfaceContainer',
            border: 1,
            borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.5),
            borderRadius: '24px',
          }}
        >
          <EmptyState
            title={hasFilters ? 'Sin resultados' : 'No hay órdenes'}
            subtitle={
              hasFilters
                ? 'Ninguna orden coincide con los filtros seleccionados.'
                : 'Cuando registres un pedido, va a aparecer acá.'
            }
            action={
              !hasFilters ? (
                <MuiButton variant="primary" startIcon={<IconPlus />} onClick={() => navigate('/orders/new')}>
                  Nuevo Pedido
                </MuiButton>
              ) : undefined
            }
          />
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {orders.map((order) => (
            <OrderCard key={order._id} order={order} onClick={() => navigate(`/orders/${order._id}`)} />
          ))}
        </Box>
      )}

      {/* 6 — Pagination strip */}
      {total > 0 && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            mt: 3,
            px: 1,
            py: 1,
            bgcolor: 'surfaceContainer',
            border: 1,
            borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.5),
            borderRadius: '16px',
            boxShadow: 1,
          }}
        >
          <MuiButton
            variant="ghost"
            size="sm"
            startIcon={<IconArrowLeft size={16} />}
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </MuiButton>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', gap: 1 }}>
              {dots.map((d, i) =>
                d === '…' ? (
                  <Typography key={`e${i}`} variant="caption" color="onSurfaceVariant" sx={{ px: 0.25 }}>
                    …
                  </Typography>
                ) : (
                  <Box
                    key={d}
                    component="button"
                    onClick={() => setPage(d)}
                    aria-label={`Página ${d}`}
                    aria-current={d === page ? 'page' : undefined}
                    sx={{
                      width: d === page ? 22 : 8,
                      height: 8,
                      borderRadius: '999px',
                      p: 0,
                      border: 'none',
                      cursor: 'pointer',
                      bgcolor: d === page ? 'primary.main' : 'surfaceContainerHighest',
                      transition: 'width 0.2s cubic-bezier(0.2, 0, 0, 1), background-color 0.15s',
                      '&:hover': { bgcolor: d === page ? 'primary.main' : 'outline' },
                      '&:focus-visible': {
                        outline: '2px solid',
                        outlineColor: 'primary.main',
                        outlineOffset: 2,
                      },
                    }}
                  />
                ),
              )}
            </Box>
            <Typography
              variant="caption"
              color="onSurfaceVariant"
              sx={{ ...MONO, fontWeight: 600, whiteSpace: 'nowrap' }}
            >
              Pág {page} de {pagesCount}
            </Typography>
          </Box>
          <MuiButton
            variant="ghost"
            size="sm"
            endIcon={<IconArrowRight size={16} />}
            disabled={page >= pagesCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Siguiente
          </MuiButton>
        </Box>
      )}

      {/* 7 — Extended FAB (label hidden below 360px) */}
      <MuiFab
        onClick={() => navigate('/orders/new')}
        aria-label="Nuevo pedido"
        sx={{
          width: 'auto',
          minWidth: 'auto',
          height: 56,
          px: 2.5,
          gap: 0.75,
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          background: (theme) =>
            `linear-gradient(135deg, ${theme.palette.primary.light} 0%, ${theme.palette.primary.main} 55%, ${theme.palette.primary.dark} 100%)`,
          boxShadow: (theme) =>
            `0 6px 20px ${alpha(theme.palette.primary.main, 0.38)}, 0 2px 6px rgba(0,0,0,0.12)`,
          '&:hover': {
            bgcolor: 'primary.main',
            background: (theme) =>
              `linear-gradient(135deg, ${theme.palette.primary.light} 0%, ${theme.palette.primary.main} 55%, ${theme.palette.primary.dark} 100%)`,
            filter: 'brightness(1.04)',
            boxShadow: (theme) =>
              `0 8px 26px ${alpha(theme.palette.primary.main, 0.45)}, 0 4px 10px rgba(0,0,0,0.14)`,
          },
        }}
      >
        <IconPlus size={22} />
        {showFabLabel && (
          <Typography variant="labelLarge" sx={{ fontWeight: 700, whiteSpace: 'nowrap', color: 'inherit' }}>
            Nuevo Pedido
          </Typography>
        )}
      </MuiFab>
    </Box>
  );
}
