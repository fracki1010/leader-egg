import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client.ts';
import { useAuthStore } from '../stores/authStore.ts';
import type {
  Customer,
  Order,
  OrderStatus,
} from '../types/index.ts';
import { useAccountMovements, useCustomerSummary, useCustomerOrders } from '../hooks/queries/index.ts';
import { useUpdateCustomerStatus, useDeleteCustomer } from '../hooks/mutations/index.ts';
import { useSmartBack } from '../hooks/useSmartBack.ts';
import { isOfflineQueuedError } from '../hooks/use-offline-mutation.ts';
import {
  MuiButton,
  MuiCard,
  MuiDialog,
  MuiIconButton,
  MuiSnackbar,
  LoadingState,
  MapView,
} from '../components/ui/index.ts';
import {
  IconAddCircle,
  IconArrowBack,
  IconCall,
  IconChat,
  IconCheck,
  IconCircleCheck,
  IconClock,
  IconDelete,
  IconEdit,
  IconEgg,
  IconHistory,
  IconInbox,
  IconInfo,
  IconLocation,
  IconMoreVert,
  IconNearMe,
  IconOrder,
  IconPayments,
  IconPerson,
  IconRoute,
  IconStorefront,
  IconTruck,
  IconWallet,
  IconWarning,
  IconX,
} from '../components/ui/icons.tsx';
import { AccountMovements } from '../components/customer/AccountMovements.tsx';
import { CustomerFormDialog } from '../components/customer/CustomerFormDialog.tsx';
import { CustomerPaymentDialog } from '../components/customer/CustomerPaymentDialog.tsx';
import { CustomerChargeDialog } from '../components/customer/CustomerChargeDialog.tsx';
import { m3Shape } from '../theme/index.ts';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import Pagination from '@mui/material/Pagination';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';

/* ── Config ─────────────────────────────────── */

const ORDERS_PAGE_SIZE = 50;
/** "Recent" order = created within the last 7 days (primary-tinted #ORD). */
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
/** How many top products to show in "Calibres Habituales". */
const TOP_PRODUCTS = 6;

/* ── Helpers ─────────────────────────────────── */

const fmtMoney = (n: number) =>
  `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

const fmtDate = (d: string | null) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
};

const isRecent = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  return diff >= 0 && diff <= RECENT_MS;
};

/** Structured address composition — falls back to the composed display string. */
function composeAddress(c: Customer): string {
  const d = c.addressDetail;
  if (d && (d.street || d.neighborhood || d.city || d.province)) {
    const street = d.street && d.number ? `${d.street} ${d.number}` : d.street;
    return [street, d.floor, d.neighborhood, d.city, d.province].filter(Boolean).join(', ');
  }
  return c.address || '';
}

/** Compact address for the map overlay (street + neighborhood/city). */
function composeAddressShort(c: Customer): string {
  const d = c.addressDetail;
  const street = d?.street && d.number ? `${d.street} ${d.number}` : (d?.street ?? '');
  const area = [d?.neighborhood, d?.city].filter(Boolean).join(', ');
  return [street, area].filter(Boolean).join(' · ') || c.address || '';
}

/** Initials for the hero avatar (first two words). */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const second = words[1]?.[0] ?? '';
  return (first + second).toUpperCase() || '?';
}

/** "N maples (40 AA + 20 A)" summary from an order's items (mapleQty is
 *  the backend's maple-converted quantity; legacy items fall back to
 *  the raw quantity, which is maples for maple-unit lines). */
function orderItemsSummary(order: Order): string {
  const total = order.items.reduce((s, it) => s + (it.mapleQty ?? it.quantity ?? 0), 0);
  const parts = order.items.map((it) => `${it.mapleQty ?? it.quantity ?? 0} ${it.productName}`);
  return `${total} maples${parts.length > 0 ? ` (${parts.join(' + ')})` : ''}`;
}

/** Aggregates the most-bought products from the loaded order history.
 *  Honest: built only from the orders already fetched (first page). */
interface ProductStat {
  name: string;
  totalMaples: number;
  orderCount: number;
  avgMaples: number;
}

function aggregateProducts(orders: Order[]): ProductStat[] {
  const byName = new Map<string, { total: number; orderIds: Set<string> }>();
  for (const order of orders) {
    for (const it of order.items) {
      const qty = it.mapleQty ?? it.quantity ?? 0;
      if (qty <= 0) continue;
      const entry = byName.get(it.productName) ?? { total: 0, orderIds: new Set<string>() };
      entry.total += qty;
      entry.orderIds.add(order._id);
      byName.set(it.productName, entry);
    }
  }
  return [...byName.entries()]
    .map(([name, e]) => ({
      name,
      totalMaples: e.total,
      orderCount: e.orderIds.size,
      avgMaples: e.orderIds.size > 0 ? Math.round(e.total / e.orderIds.size) : 0,
    }))
    .sort((a, b) => b.totalMaples - a.totalMaples)
    .slice(0, TOP_PRODUCTS);
}

/* ── Order status chip meta ──────────────────── */

const ORDER_STATUS_META: Record<OrderStatus, { label: string; bg: string; fg: string; icon: React.ReactElement }> = {
  delivered: { label: 'Entregado', bg: 'secondaryFixed', fg: 'onSecondaryFixed', icon: <IconCircleCheck size={14} /> },
  pending: { label: 'Pendiente', bg: 'primaryFixed', fg: 'onPrimaryFixed', icon: <IconClock size={14} /> },
  assigned: { label: 'Asignada', bg: 'tertiaryContainer', fg: 'onTertiaryContainer', icon: <IconRoute size={14} /> },
  in_transit: { label: 'En camino', bg: 'warningContainer', fg: 'onWarningContainer', icon: <IconTruck size={14} /> },
  cancelled: { label: 'Cancelada', bg: 'errorContainer', fg: 'onErrorContainer', icon: <IconX size={14} /> },
};

/* ── Local M3 pieces ────────────────────────── */

/** Tonal pill — small container chip for badges/status (M3 container + on-container pair). */
function PillChip({ bg, fg, children }: { bg: string; fg: string; children: React.ReactNode }) {
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1.5,
        py: 0.75,
        borderRadius: m3Shape.full,
        bgcolor: bg,
        color: fg,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  );
}

/** In-card section header: tonal icon square + title + optional right slot. */
function CardHeader({
  icon,
  title,
  bg = 'surfaceContainerHigh',
  fg = 'onSurfaceVariant',
  action,
}: {
  icon: React.ReactElement;
  title: string;
  bg?: string;
  fg?: string;
  action?: React.ReactNode;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: m3Shape.medium,
          bgcolor: bg,
          color: fg,
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>
      <Typography variant="titleMedium" sx={{ fontWeight: 700, color: 'onSurface' }}>
        {title}
      </Typography>
      {action && <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center' }}>{action}</Box>}
    </Box>
  );
}

/** Compact order status chip (pill + icon). */
function StatusChip({ label, bg, fg, icon }: { label: string; bg: string; fg: string; icon: React.ReactElement }) {
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
      {icon}
      <Typography variant="labelMedium" sx={{ fontWeight: 600, fontSize: '0.6875rem', lineHeight: 1 }}>
        {label}
      </Typography>
    </Box>
  );
}

/** Quick-action button: anchor (href) or button (onClick), tonal fill, ≥44px. */
function QuickAction({
  href,
  target,
  onClick,
  icon,
  label,
  bg,
  fg,
  bold = false,
  disabled = false,
}: {
  href?: string;
  target?: string;
  onClick?: () => void;
  icon: React.ReactElement;
  label: string;
  bg: string;
  fg: string;
  bold?: boolean;
  disabled?: boolean;
}) {
  const sx = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    minHeight: 44,
    px: 1,
    borderRadius: m3Shape.medium,
    bgcolor: bg,
    color: fg,
    fontWeight: bold ? 700 : 600,
    fontSize: '0.8125rem',
    lineHeight: 1.25,
    textDecoration: 'none',
    border: 'none',
    cursor: 'pointer',
    transition: 'background-color 0.15s, transform 0.12s',
    '&:active': { transform: 'scale(0.97)' },
    ...(disabled && { opacity: 0.5, cursor: 'default', pointerEvents: 'none' }),
  };
  if (href) {
    return (
      <Box component="a" href={href} target={target} rel={target === '_blank' ? 'noreferrer' : undefined} sx={sx}>
        {icon}
        {label}
      </Box>
    );
  }
  return (
    <Box component="button" type="button" onClick={onClick} sx={sx}>
      {icon}
      {label}
    </Box>
  );
}

/* ── CustomerDetailPage ─────────────────────── */

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const goBack = useSmartBack('/customers');
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  // Dashboard data (GET /:id/summary)
  const summaryQuery = useCustomerSummary(id);
  const summary = summaryQuery.data ?? null;
  const loading = summaryQuery.isLoading;
  const queryError = summaryQuery.error;
  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : 'Error al cargar datos del cliente'
    : null;

  // Orders (GET /:id/orders, paginated — page keys the query)
  const [ordersPage, setOrdersPage] = useState(1);
  const ordersQuery = useCustomerOrders(id, { limit: ORDERS_PAGE_SIZE, page: ordersPage });
  const orders = ordersQuery.data?.items ?? [];
  const ordersTotal = ordersQuery.data?.total ?? 0;
  const ordersLoading = ordersQuery.isLoading;
  const ordersQueryError = ordersQuery.error;
  const ordersError = ordersQueryError
    ? ordersQueryError instanceof Error
      ? ordersQueryError.message
      : 'Error al cargar órdenes'
    : null;

  // Account ledger (GET /:customerId/movements — same cache key the payment
  // dialog uses, so opening the dialog does not trigger a second fetch).
  const accountQuery = useAccountMovements(id);
  const accountData = accountQuery.data ?? null;
  const accountMovements = accountData?.movements ?? [];
  const accountOrders = accountData?.orders.items ?? [];
  const accountOrdersTotal = accountData?.orders.total ?? 0;
  const accountLoading = accountQuery.isLoading;
  const accountQueryError = accountQuery.error;
  const accountError = accountQueryError
    ? accountQueryError instanceof Error
      ? accountQueryError.message
      : 'Error al cargar la cuenta'
    : null;

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);

  // Shared account dialogs (payment / manual charge)
  const [payOpen, setPayOpen] = useState(false);
  const [chargeOpen, setChargeOpen] = useState(false);

  // More-actions menu (Desactivar/Activar + Eliminar)
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);

  // Status toggle dialog
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Delete confirm dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Snackbar
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  // Writes — offline-aware; both invalidate customers + linked domains.
  const updateCustomerStatus = useUpdateCustomerStatus();
  const deleteCustomer = useDeleteCustomer();
  const statusSubmitting = updateCustomerStatus.isPending;
  const deleteSubmitting = deleteCustomer.isPending;

  const handleToggleStatus = () => {
    if (!summary) return;
    setStatusError(null);
    const newStatus = summary.customer.status === 'active' ? 'inactive' : 'active';
    updateCustomerStatus.mutate(
      { id: summary.customer._id, status: newStatus },
      {
        onSuccess: () => {
          setStatusOpen(false);
          setSnackbar({ open: true, message: `Cliente ${newStatus === 'active' ? 'activado' : 'desactivado'}`, severity: 'success' });
        },
        onError: (err) => {
          // Offline queued write: normal outcome, the OfflineBanner confirmed it.
          if (isOfflineQueuedError(err)) {
            setStatusOpen(false);
            setSnackbar({ open: true, message: `Cliente ${newStatus === 'active' ? 'activado' : 'desactivado'} (offline)`, severity: 'success' });
            return;
          }
          if (err instanceof ApiError && err.status === 409) {
            setStatusError('No se puede desactivar: el cliente tiene órdenes pendientes o asignadas.');
          } else {
            setStatusError(err instanceof Error ? err.message : 'Error al actualizar estado');
          }
        },
      },
    );
  };

  const handleDelete = () => {
    if (!summary) return;
    setDeleteError(null);
    deleteCustomer.mutate(summary.customer._id, {
      onSuccess: () => {
        setDeleteOpen(false);
        navigate('/customers');
      },
      onError: (err) => {
        if (isOfflineQueuedError(err)) {
          setDeleteOpen(false);
          navigate('/customers');
          return;
        }
        if (err instanceof ApiError && err.status === 409) {
          setDeleteError('No se puede eliminar: el cliente tiene órdenes asociadas. Desactivá el cliente en su lugar.');
        } else {
          setDeleteError(err instanceof Error ? err.message : 'Error al eliminar el cliente');
        }
      },
    });
  };

  if (loading) {
    return <LoadingState label="Cargando cliente…" />;
  }

  if (error || !summary) {
    return (
      <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
        <MuiButton variant="ghost" onClick={goBack} startIcon={<IconArrowBack />} sx={{ mb: 3 }}>
          Volver a Clientes
        </MuiButton>
        <Alert severity="error">{error ?? 'Cliente no encontrado'}</Alert>
      </Box>
    );
  }

  const customer = summary.customer;
  const isB2B = customer.type === 'B2B';
  const isActive = customer.status === 'active';
  const idSuffix = customer._id.slice(-4);
  const contactPerson = customer.addressDetail?.reference || customer.name;
  const waDigits = customer.phone ? customer.phone.replace(/\D/g, '') : '';
  const hasPhone = Boolean(customer.phone);

  // Location (GeoJSON: coordinates = [lng, lat])
  const locationPoint =
    customer.location && customer.location.coordinates.length === 2
      ? { lat: customer.location.coordinates[1]!, lng: customer.location.coordinates[0]! }
      : null;
  const navigateUrl = locationPoint
    ? `https://www.google.com/maps/dir/?api=1&destination=${locationPoint.lat},${locationPoint.lng}`
    : customer.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(customer.address)}`
      : null;

  // Cuenta corriente
  const hasDebt = summary.outstandingBalance > 0;
  const limit = customer.creditConfig.limit;
  const termDays = customer.creditConfig.termDays;
  const hasCredit = limit > 0;
  const availablePct = hasCredit
    ? Math.max(0, Math.min(100, Math.round(((limit - summary.outstandingBalance) / limit) * 100)))
    : 0;
  const exceedsLimit = hasCredit && summary.outstandingBalance > limit;
  const saldoLabel =
    summary.outstandingBalance === 0
      ? 'Saldada'
      : summary.totalSpent > 0
        ? `${Math.min(100, Math.round((summary.outstandingBalance / summary.totalSpent) * 100))}% pendiente`
        : 'Pendiente';

  // Calibres habituales
  const topProducts = aggregateProducts(orders);

  const totalPages = Math.max(1, Math.ceil(ordersTotal / ORDERS_PAGE_SIZE));
  const address = composeAddress(customer);

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
      {/* ── Sub-header ─────────────────────────────
          Round back button + "Ficha de Cliente" + ID/type subtitle;
          right: edit icon + more_vert menu (Desactivar/Activar, Eliminar). */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <MuiIconButton
          aria-label="Volver a clientes"
          onClick={goBack}
          sx={{ bgcolor: 'surfaceContainer', color: 'onSurfaceVariant', flexShrink: 0 }}
        >
          <IconArrowBack size={22} />
        </MuiIconButton>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2, color: 'onSurface' }}>
            Ficha de Cliente
          </Typography>
          <Typography variant="body2" color="onSurfaceVariant" noWrap>
            ID: #{idSuffix} · {isB2B ? 'Mayorista' : 'Minorista'}
          </Typography>
        </Box>
        {isAdmin && (
          <>
            <MuiIconButton
              aria-label="Editar cliente"
              onClick={() => setEditOpen(true)}
              sx={{ bgcolor: 'surfaceContainer', color: 'onSurfaceVariant', flexShrink: 0 }}
            >
              <IconEdit size={20} />
            </MuiIconButton>
            <IconButton
              aria-label="Más acciones"
              onClick={(e) => setMenuAnchor(e.currentTarget)}
              sx={{ bgcolor: 'surfaceContainer', color: 'onSurfaceVariant', flexShrink: 0, width: 48, height: 48 }}
            >
              <IconMoreVert size={20} />
            </IconButton>
            <Menu
              anchorEl={menuAnchor}
              open={Boolean(menuAnchor)}
              onClose={() => setMenuAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              slotProps={{ paper: { sx: { borderRadius: m3Shape.medium, mt: 0.5 } } }}
            >
              <MenuItem
                onClick={() => { setMenuAnchor(null); setStatusError(null); setStatusOpen(true); }}
              >
                <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, color: customer.status === 'active' ? 'error.main' : 'success.main' }}>
                  {customer.status === 'active' ? <IconX size={18} /> : <IconCheck size={18} />}
                  {customer.status === 'active' ? 'Desactivar cliente' : 'Activar cliente'}
                </Box>
              </MenuItem>
              <MenuItem
                onClick={() => { setMenuAnchor(null); setDeleteError(null); setDeleteOpen(true); }}
              >
                <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, color: 'error.main' }}>
                  <IconDelete size={18} />
                  Eliminar cliente
                </Box>
              </MenuItem>
            </Menu>
          </>
        )}
      </Box>

      {/* ── Client Profile Hero Card ───────────────
          Avatar (initials) + type/status badges + name + contact/info
          lines + quick action trio (Llamar / WhatsApp / Pedido). */}
      <MuiCard variant="elevated" sx={{ mb: 3, position: 'relative', overflow: 'hidden' }}>
        {/* Ambient glow — decorative primaryContainer blur behind the header */}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            top: -56,
            right: -32,
            width: 200,
            height: 200,
            borderRadius: '50%',
            bgcolor: 'primaryContainer',
            opacity: 0.45,
            filter: 'blur(56px)',
            pointerEvents: 'none',
          }}
        />
        <Box sx={{ position: 'relative', zIndex: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2.5 }}>
            {/* Avatar 64px + small type badge (storefront B2B / person B2C) */}
            <Box sx={{ position: 'relative', flexShrink: 0 }}>
              <Box
                sx={{
                  width: 64,
                  height: 64,
                  borderRadius: m3Shape.medium,
                  bgcolor: 'surfaceContainerHigh',
                  color: 'onSurfaceVariant',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.375rem',
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                }}
              >
                {initialsOf(customer.name)}
              </Box>
              <Box
                sx={{
                  position: 'absolute',
                  bottom: -4,
                  right: -4,
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  bgcolor: 'secondaryContainer',
                  color: 'onSecondaryContainer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '2px solid',
                  borderColor: 'surfaceContainerLowest',
                }}
              >
                {isB2B ? <IconStorefront size={14} /> : <IconPerson size={14} />}
              </Box>
            </Box>

            <Box sx={{ minWidth: 0, flex: 1 }}>
              {/* Badges row */}
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                <PillChip bg={isB2B ? 'primaryFixed' : 'surfaceContainerHigh'} fg={isB2B ? 'onPrimaryFixed' : 'onSurfaceVariant'}>
                  {isB2B ? 'Mayorista' : 'Minorista'}
                </PillChip>
                <PillChip bg={isActive ? 'secondaryFixed' : 'errorContainer'} fg={isActive ? 'onSecondaryFixed' : 'onErrorContainer'}>
                  {isActive && (
                    <Box
                      component="span"
                      sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main', display: 'inline-block', flexShrink: 0 }}
                    />
                  )}
                  {isActive ? 'Activo' : 'Inactivo'}
                </PillChip>
                {summary.hasPendingOrders && (
                  <PillChip bg="primaryContainer" fg="onPrimaryContainer">
                    <IconClock size={13} />
                    Órdenes pendientes
                  </PillChip>
                )}
              </Box>

              {/* Name */}
              <Typography
                variant="h6"
                sx={{
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  lineHeight: 1.25,
                  color: 'onSurface',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={customer.name}
              >
                {customer.name}
              </Typography>

              {/* Contact + info lines */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75, minWidth: 0 }}>
                <IconPerson size={15} />
                <Typography variant="body2" color="onSurfaceVariant" noWrap>
                  {contactPerson} (Titular)
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 0.25, flexWrap: 'wrap' }}>
                {customer.taxId && (
                  <Typography variant="labelMedium" color="onSurfaceVariant" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                    CUIT {customer.taxId}
                  </Typography>
                )}
                <Typography variant="labelMedium" color="onSurfaceVariant" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                  Cta. Cte. #{idSuffix}
                </Typography>
              </Box>
            </Box>
          </Box>

          {/* Quick action trio */}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1.5, mt: 2.5 }}>
            <QuickAction
              href={hasPhone ? `tel:${customer.phone}` : undefined}
              disabled={!hasPhone}
              icon={<IconCall size={18} />}
              label="Llamar"
              bg="surfaceContainer"
              fg="onSurface"
            />
            <QuickAction
              href={waDigits ? `https://wa.me/${waDigits}` : undefined}
              target="_blank"
              disabled={!waDigits}
              icon={<IconChat size={18} />}
              label="WhatsApp"
              bg="secondaryContainer"
              fg="onSecondaryContainer"
              bold
            />
            <QuickAction
              onClick={() => navigate(`/orders/new?customer=${customer._id}`)}
              icon={<IconOrder size={18} />}
              label="Pedido"
              bg="primaryContainer"
              fg="onPrimaryContainer"
              bold
            />
          </Box>
        </Box>
      </MuiCard>

      {/* ── Logística y Entrega ──────────────────── */}
      <MuiCard variant="elevated" sx={{ mb: 3 }}>
        <CardHeader
          icon={<IconTruck size={18} />}
          title="Logística y Entrega"
          bg="primaryContainer"
          fg="onPrimaryContainer"
        />

        {/* Map snapshot (real coordinates) or honest placeholder */}
        <Box sx={{ position: 'relative', borderRadius: m3Shape.medium, overflow: 'hidden', mb: 2 }}>
          {locationPoint ? (
            <MapView
              markers={[{ lat: locationPoint.lat, lng: locationPoint.lng, label: '1' }]}
              height={128}
              zoom={15}
              overlay={
                navigateUrl && (
                  <Box
                    sx={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                      px: 1.5,
                      py: 1,
                      bgcolor: 'rgba(255, 255, 255, 0.92)',
                      backdropFilter: 'blur(4px)',
                      borderTop: 1,
                      borderColor: 'outlineVariant',
                    }}
                  >
                    <Box sx={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <IconLocation size={16} />
                      <Typography component="div" variant="labelMedium" color="onSurface" noWrap sx={{ fontWeight: 600 }}>
                        {composeAddressShort(customer) || 'Ubicación registrada'}
                      </Typography>
                    </Box>
                    <Box
                      component="a"
                      href={navigateUrl}
                      target="_blank"
                      rel="noreferrer"
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.5,
                        minHeight: 36,
                        px: 1.5,
                        borderRadius: m3Shape.full,
                        bgcolor: 'primaryContainer',
                        color: 'onPrimaryContainer',
                        fontWeight: 700,
                        fontSize: '0.75rem',
                        textDecoration: 'none',
                        flexShrink: 0,
                        transition: 'background-color 0.15s, transform 0.12s',
                        '&:hover': { bgcolor: 'primaryContainer', filter: 'brightness(0.96)' },
                        '&:active': { transform: 'scale(0.97)' },
                      }}
                    >
                      <IconNearMe size={16} />
                      Navegar
                    </Box>
                  </Box>
                )
              }
            />
          ) : (
            <Box
              sx={{
                height: 128,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1,
                bgcolor: 'surfaceContainer',
                borderRadius: m3Shape.medium,
              }}
            >
              <IconLocation size={24} />
              <Typography variant="body2" color="onSurfaceVariant">
                Sin coordenadas — editar para geocodificar
              </Typography>
            </Box>
          )}
        </Box>

        {/* Delivery details */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
            <Box sx={{ display: 'flex', color: 'onSurfaceVariant', pt: 0.25, flexShrink: 0 }}>
              <IconLocation size={18} />
            </Box>
            <Typography variant="body2" color="onSurface">
              {address || 'Sin dirección registrada'}
            </Typography>
          </Box>
          {customer.addressDetail?.reference && (
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
              <Box sx={{ display: 'flex', color: 'tertiary.main', pt: 0.25, flexShrink: 0 }}>
                <IconInfo size={18} />
              </Box>
              <Typography variant="body2" color="onSurfaceVariant">
                Observación: {customer.addressDetail.reference}
              </Typography>
            </Box>
          )}
        </Box>
      </MuiCard>

      {/* ── Cuenta Corriente ─────────────────────── */}
      <MuiCard variant="elevated" sx={{ mb: 3 }}>
        <CardHeader
          icon={<IconWallet size={18} />}
          title="Cuenta Corriente"
          bg="secondaryContainer"
          fg="onSecondaryContainer"
          action={
            <PillChip bg={hasDebt ? 'errorContainer' : 'secondaryFixed'} fg={hasDebt ? 'onErrorContainer' : 'onSecondaryFixed'}>
              {hasDebt ? <IconWarning size={14} /> : <IconCircleCheck size={14} />}
              {hasDebt ? 'Con Deuda' : 'Sin Deuda'}
            </PillChip>
          }
        />

        {/* Balance card */}
        <Box sx={{ bgcolor: 'surfaceContainerLow', borderRadius: m3Shape.medium, p: 2.5, mb: 2 }}>
          <Typography variant="overline" color="onSurfaceVariant" sx={{ display: 'block', mb: 0.5 }}>
            Saldo Pendiente
          </Typography>
          <Typography
            variant="h3"
            sx={{
              fontWeight: 800,
              letterSpacing: '-0.02em',
              fontVariantNumeric: 'tabular-nums',
              fontFamily: 'var(--font-mono)',
              lineHeight: 1.15,
              color: hasDebt ? 'error.main' : 'secondary.main',
              mb: 0.5,
            }}
          >
            {fmtMoney(summary.outstandingBalance)}
          </Typography>
          <Typography variant="body2" color="onSurfaceVariant">
            Facturación: {saldoLabel}
          </Typography>
        </Box>

        {/* Credit bar — only when a limit is agreed */}
        {hasCredit ? (
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 2, mb: 1, flexWrap: 'wrap' }}>
              <Typography variant="labelMedium" color="onSurfaceVariant" sx={{ fontWeight: 600 }}>
                Límite acordado:{' '}
                <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'onSurface' }}>
                  {fmtMoney(limit)}
                </Box>
              </Typography>
              <Typography variant="labelMedium" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'secondary.main' }}>
                {availablePct}% disponible
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={availablePct}
              color="secondary"
              sx={{ height: 8, borderRadius: m3Shape.full, mb: 0.5 }}
            />
            {exceedsLimit && (
              <Typography variant="caption" color="error.main" sx={{ fontWeight: 600 }}>
                El saldo supera el límite acordado.
              </Typography>
            )}
          </Box>
        ) : (
          <Box sx={{ bgcolor: 'surfaceContainerLow', borderRadius: m3Shape.medium, p: 2, mb: 2 }}>
            <Typography variant="body2" color="onSurfaceVariant">
              Sin límite configurado.
            </Typography>
          </Box>
        )}

        {/* 2-col metrics */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.5 }}>
          <Box sx={{ bgcolor: 'surfaceContainerLow', borderRadius: m3Shape.medium, p: 2 }}>
            <Typography variant="overline" color="onSurfaceVariant" sx={{ display: 'block', mb: 0.5 }}>
              Consumo Total
            </Typography>
            <Typography
              variant="titleMedium"
              sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'onSurface' }}
            >
              {fmtMoney(summary.totalSpent)}
            </Typography>
            <Typography variant="body2" color="onSurfaceVariant">
              {summary.orderCount} {summary.orderCount === 1 ? 'orden' : 'órdenes'}
            </Typography>
          </Box>
          <Box sx={{ bgcolor: 'surfaceContainerLow', borderRadius: m3Shape.medium, p: 2 }}>
            <Typography variant="overline" color="onSurfaceVariant" sx={{ display: 'block', mb: 0.5 }}>
              Condición de Pago
            </Typography>
            <Typography
              variant="titleMedium"
              sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'onSurface' }}
            >
              {termDays > 0 ? `${termDays} días` : 'Contado'}
            </Typography>
            <Typography variant="body2" color="onSurfaceVariant">
              {termDays > 0 ? 'plazo de crédito' : 'pago al contado'}
            </Typography>
          </Box>
        </Box>

        {/* Account actions — this page is the single hub for the account. */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
            gap: 1.5,
            mt: 2.5,
          }}
        >
          <MuiButton
            variant="primary"
            fullWidth
            disabled={!hasDebt}
            onClick={() => setPayOpen(true)}
            startIcon={<IconPayments size={18} />}
          >
            Registrar pago
          </MuiButton>
          <MuiButton
            variant="secondary"
            fullWidth
            onClick={() => setChargeOpen(true)}
            startIcon={<IconAddCircle size={18} />}
          >
            Crear deuda
          </MuiButton>
        </Box>
      </MuiCard>

      {/* ── Movimientos de la cuenta ───────────────
          Collapsed ledger + open orders, fed by the accounts endpoint. */}
      <AccountMovements
        movements={accountMovements}
        orders={accountOrders}
        ordersTotal={accountOrdersTotal}
        loading={accountLoading}
        error={accountError}
        onOrderClick={(orderId) => navigate(`/orders/${orderId}`)}
      />

      {/* ── Calibres Habituales ────────────────────
          Honest aggregation from the loaded order history (no fake data). */}
      <MuiCard variant="elevated" sx={{ mb: 3 }}>
        <CardHeader icon={<IconEgg size={18} />} title="Calibres Habituales" bg="primaryContainer" fg="onPrimaryContainer" />
        {topProducts.length === 0 ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2.5, bgcolor: 'surfaceContainerLow', borderRadius: m3Shape.medium }}>
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
              <IconInbox size={20} />
            </Box>
            <Box>
              <Typography variant="titleSmall" sx={{ fontWeight: 600, color: 'onSurface' }}>
                Sin historial de productos
              </Typography>
              <Typography variant="body2" color="onSurfaceVariant">
                Los calibres que compra aparecerán acá al cargar pedidos.
              </Typography>
            </Box>
          </Box>
        ) : (
          <>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {topProducts.map((p) => (
                <Box
                  key={p.name}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, borderRadius: m3Shape.medium, bgcolor: 'surfaceContainerLow' }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 40,
                      height: 40,
                      borderRadius: m3Shape.small,
                      bgcolor: 'tertiaryContainer',
                      color: 'onTertiaryContainer',
                      flexShrink: 0,
                    }}
                  >
                    <IconEgg size={20} />
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography component="div" variant="titleSmall" sx={{ fontWeight: 600, color: 'onSurface' }} noWrap>
                      {p.name}
                    </Typography>
                    <Typography variant="labelMedium" color="onSurfaceVariant">
                      Frecuencia: {p.orderCount} {p.orderCount === 1 ? 'pedido' : 'pedidos'} · ≈{p.avgMaples} maples por pedido
                    </Typography>
                  </Box>
                  <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                    <Typography
                      variant="titleMedium"
                      sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'onSurface', lineHeight: 1.2 }}
                    >
                      {p.totalMaples}
                    </Typography>
                    <Typography variant="labelMedium" color="onSurfaceVariant">
                      maples totales
                    </Typography>
                  </Box>
                </Box>
              ))}
            </Box>
            <Typography variant="caption" color="onSurfaceVariant" sx={{ display: 'block', mt: 1.5 }}>
              Análisis de las últimas {orders.length} {orders.length === 1 ? 'orden cargada' : 'órdenes cargadas'}.
            </Typography>
          </>
        )}
      </MuiCard>

      {/* ── Historial de Pedidos ─────────────────── */}
      <MuiCard variant="elevated" sx={{ mb: 3 }}>
        <CardHeader
          icon={<IconHistory size={18} />}
          title="Historial de Pedidos"
          bg="tertiaryContainer"
          fg="onTertiaryContainer"
          action={
            <Typography variant="labelMedium" color="onSurfaceVariant" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
              {ordersTotal} {ordersTotal === 1 ? 'pedido' : 'pedidos'}
            </Typography>
          }
        />

        {ordersError && <Alert severity="error" sx={{ mb: 2 }}>{ordersError}</Alert>}

        {ordersLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={28} />
          </Box>
        ) : orders.length === 0 ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2.5, bgcolor: 'surfaceContainerLow', borderRadius: m3Shape.medium }}>
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
              <IconInbox size={20} />
            </Box>
            <Box>
              <Typography variant="titleSmall" sx={{ fontWeight: 600, color: 'onSurface' }}>
                Sin órdenes registradas
              </Typography>
              <Typography variant="body2" color="onSurfaceVariant">
                Este cliente todavía no tiene pedidos.
              </Typography>
            </Box>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {orders.map((order) => {
              const meta = ORDER_STATUS_META[order.status] ?? ORDER_STATUS_META.pending;
              return (
                <Box
                  key={order._id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/orders/${order._id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/orders/${order._id}`);
                    }
                  }}
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.75,
                    p: 2,
                    borderRadius: m3Shape.medium,
                    bgcolor: 'surfaceContainerLow',
                    cursor: 'pointer',
                    transition: 'background-color 0.15s, transform 0.15s',
                    '&:hover': { bgcolor: 'surfaceContainerHigh', transform: 'translateY(-1px)' },
                    '&:focus-visible': { outline: '2px solid var(--mui-palette-primary-main)', outlineOffset: 2 },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
                      <Typography
                        variant="titleSmall"
                        sx={{
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 700,
                          fontVariantNumeric: 'tabular-nums',
                          color: isRecent(order.orderDate ?? order.createdAt) ? 'primary.main' : 'onSurface',
                          flexShrink: 0,
                        }}
                      >
                        #{order.orderNumber}
                      </Typography>
                      <Typography variant="body2" color="onSurfaceVariant" noWrap>
                        {fmtDate(order.orderDate ?? order.createdAt)}
                      </Typography>
                    </Box>
                    <StatusChip label={meta.label} bg={meta.bg} fg={meta.fg} icon={meta.icon} />
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5 }}>
                    <Typography variant="body2" color="onSurfaceVariant" noWrap sx={{ flex: 1, minWidth: 0 }}>
                      {orderItemsSummary(order)}
                    </Typography>
                    <Typography
                      variant="titleMedium"
                      sx={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'onSurface', flexShrink: 0 }}
                    >
                      {fmtMoney(order.totalAmount)}
                    </Typography>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}

        {totalPages > 1 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
            <Pagination
              count={totalPages}
              page={ordersPage}
              onChange={(_, page) => setOrdersPage(page)}
              color="primary"
              shape="rounded"
            />
          </Box>
        )}
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1.5 }}>
          <Link
            component={RouterLink}
            to="/orders"
            underline="hover"
            sx={{ fontSize: '0.8125rem', fontWeight: 600, color: 'primary.main', cursor: 'pointer' }}
          >
            Ver todos →
          </Link>
        </Box>
      </MuiCard>

      {/* ── Sticky bottom quick order banner ─────── */}
      <Box
        sx={{
          position: 'sticky',
          bottom: { xs: '80px', md: 0 },
          zIndex: 100,
          pt: 2,
          pb: 1,
          bgcolor: 'background.default',
          borderTop: 1,
          borderColor: 'outlineVariant',
          mx: { xs: -2, sm: -3, md: 0 },
          px: { xs: 2, sm: 3, md: 0 },
        }}
      >
        <MuiButton
          variant="primary"
          size="lg"
          fullWidth
          startIcon={<IconAddCircle size={20} />}
          onClick={() => navigate(`/orders/new?customer=${customer._id}`)}
        >
          Cargar Nuevo Pedido a este Cliente
        </MuiButton>
      </Box>

      {/* ── Edit dialog (admin) ────────────────── */}
      <CustomerFormDialog
        open={editOpen}
        mode="edit"
        customer={customer}
        onClose={() => setEditOpen(false)}
        onSaved={(message) => {
          setSnackbar({ open: true, message, severity: 'success' });
        }}
      />

      {/* ── Status toggle confirm dialog ───────── */}
      <MuiDialog
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        title={customer.status === 'active' ? 'Desactivar cliente' : 'Activar cliente'}
        actions={
          <>
            <MuiButton variant="ghost" onClick={() => setStatusOpen(false)} disabled={statusSubmitting}>
              Cancelar
            </MuiButton>
            <MuiButton
              variant={customer.status === 'active' ? 'danger' : 'primary'}
              isLoading={statusSubmitting}
              disabled={statusSubmitting}
              onClick={handleToggleStatus}
            >
              {statusSubmitting ? 'Guardando...' : customer.status === 'active' ? 'Desactivar' : 'Activar'}
            </MuiButton>
          </>
        }
      >
        {statusError && <Alert severity="error" sx={{ mb: 2 }}>{statusError}</Alert>}
        <Typography variant="body2">
          {customer.status === 'active'
            ? `¿Seguro que querés desactivar a "${customer.name}"? No podrá recibir nuevas órdenes mientras esté inactivo.`
            : `¿Seguro que querés reactivar a "${customer.name}"?`}
        </Typography>
      </MuiDialog>

      {/* ── Delete confirm dialog ──────────────── */}
      <MuiDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Eliminar cliente"
        actions={
          <>
            <MuiButton variant="ghost" onClick={() => setDeleteOpen(false)} disabled={deleteSubmitting}>
              Cancelar
            </MuiButton>
            <MuiButton variant="danger" isLoading={deleteSubmitting} disabled={deleteSubmitting} onClick={handleDelete}>
              {deleteSubmitting ? 'Eliminando...' : 'Eliminar'}
            </MuiButton>
          </>
        }
      >
        {deleteError && <Alert severity="error" sx={{ mb: 2 }}>{deleteError}</Alert>}
        <Typography variant="body2">
          ¿Seguro que querés eliminar a <strong>"{customer.name}"</strong>? Esta acción no se puede deshacer. Si el cliente
          tiene órdenes asociadas, no se podrá eliminar y deberás desactivarlo.
        </Typography>
      </MuiDialog>

      {/* ── Account dialogs (shared with the statement page) ── */}
      <CustomerPaymentDialog
        open={payOpen}
        customerId={customer._id}
        onClose={() => setPayOpen(false)}
        onSuccess={(result) => {
          setSnackbar({
            open: true,
            message: `Pago registrado: ${fmtMoney(result.applied)} aplicado${result.allocations.length > 1 ? ` en ${result.allocations.length} órdenes` : ''}`,
            severity: 'success',
          });
        }}
      />

      <CustomerChargeDialog
        open={chargeOpen}
        customerId={customer._id}
        currentBalance={summary.outstandingBalance}
        onClose={() => setChargeOpen(false)}
        onSuccess={(type) => {
          setSnackbar({
            open: true,
            message: type === 'charge' ? 'Deuda creada correctamente' : 'Crédito registrado correctamente',
            severity: 'success',
          });
        }}
      />

      {/* Snackbar */}
      <MuiSnackbar
        open={snackbar.open}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
        severity={snackbar.severity}
      />
    </Box>
  );
}