import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import type { CreatePaymentPayload } from '../api/payments.ts';
import type { CreateReturnPayload } from '../api/returns.ts';
import { productsApi } from '../api/products.ts';
import { useAuthStore } from '../stores/authStore.ts';
import type {
  Order,
  OrderStatus,
  OrderChannel,
  PaymentMethod,
  PaymentPreference,
  PriceEntry,
  PriceUnit,
  ReturnEffect,
  ReturnReason,
  MoneyAccount,
  CancelMoneyAction,
} from '../types/index.ts';
import { useOrder, usePayments, useOrderReturns, useProducts } from '../hooks/queries/index.ts';
import {
  useTransitionOrderStatus,
  useUpdateOrder,
  useRecordPayment,
  useCreateReturn,
} from '../hooks/mutations/index.ts';
import { useSmartBack } from '../hooks/useSmartBack.ts';
import { isOfflineQueuedError } from '../hooks/use-offline-mutation.ts';
import { queryKeys } from '../hooks/query-keys.ts';
import { MuiButton, MuiChip, MuiCard, MuiDialog, MuiSnackbar, MuiTextField, PageHeader, LoadingState } from '../components/ui/index.ts';
import { IconLockOpen, IconEdit, IconX, IconLocation, IconTruck, IconArrowBack, IconPlus, IconEgg, IconPromo, IconUndo, IconRoute, IconCircleCheck, IconClock } from '../components/ui/icons.tsx';
import { OrderStatusConfirmDialog, getTransitionConsequence } from '../components/order/OrderStatusConfirmDialog.tsx';
import { promoShortLabel } from '../lib/promos.ts';
import { unitLabel } from '../lib/units.ts';
import { m3Shape } from '../theme/index.ts';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';

/* ── Config ─────────────────────────────────── */

const statusColorMap: Record<OrderStatus, 'warning' | 'primary' | 'info' | 'success' | 'error'> = {
  pending: 'warning',
  assigned: 'primary',
  in_transit: 'warning',
  delivered: 'success',
  cancelled: 'error',
};

const statusLabelMap: Record<OrderStatus, string> = {
  pending: 'Pendiente',
  assigned: 'Asignada',
  in_transit: 'En Camino',
  delivered: 'Entregada',
  cancelled: 'Cancelada',
};

/** Tonal container pair for the prominent current-status pill. */
const statusContainerMap: Record<OrderStatus, { bg: string; fg: string }> = {
  pending: { bg: 'warningContainer', fg: 'onWarningContainer' },
  assigned: { bg: 'primaryContainer', fg: 'onPrimaryContainer' },
  in_transit: { bg: 'infoContainer', fg: 'onInfoContainer' },
  delivered: { bg: 'successContainer', fg: 'onSuccessContainer' },
  cancelled: { bg: 'errorContainer', fg: 'onErrorContainer' },
};

/** Icon that represents the current status in the pill. */
const statusIconMap: Record<OrderStatus, React.ReactNode> = {
  pending: <IconClock size={18} />,
  assigned: <IconRoute size={18} />,
  in_transit: <IconTruck size={18} />,
  delivered: <IconCircleCheck size={18} />,
  cancelled: <IconX size={18} />,
};

type TransitionTone = 'primary' | 'secondary' | 'destructive';

/** A single status action: how it reads on the grid, in the dialog and how it's toned. */
interface TransitionAction {
  status: OrderStatus;
  /** Grid button label. */
  label: string;
  /** Confirmation dialog heading. */
  dialogTitle: string;
  /** Confirmation button copy. */
  confirmLabel: string;
  /** One-line consequence shown under the label. */
  subtitle: string;
  tone: TransitionTone;
}

const validTransitions: Record<OrderStatus, TransitionAction[]> = {
  pending: [
    {
      status: 'assigned',
      label: 'Marcar Asignada',
      dialogTitle: 'Marcar como Asignada',
      confirmLabel: 'Sí, marcar Asignada',
      subtitle: 'Se asigna a un repartidor.',
      tone: 'primary',
    },
    {
      status: 'cancelled',
      label: 'Cancelar',
      dialogTitle: 'Cancelar pedido',
      confirmLabel: 'Sí, cancelar pedido',
      subtitle: 'Se cancela el pedido.',
      tone: 'destructive',
    },
  ],
  assigned: [
    {
      status: 'in_transit',
      label: 'Marcar En Camino',
      dialogTitle: 'Marcar como En Camino',
      confirmLabel: 'Sí, marcar En Camino',
      subtitle: 'El pedido sale a reparto.',
      tone: 'primary',
    },
    {
      status: 'pending',
      label: 'Volver a Pendiente',
      dialogTitle: 'Volver a Pendiente',
      confirmLabel: 'Sí, volver a Pendiente',
      subtitle: 'Vuelve a la lista de pendientes.',
      tone: 'secondary',
    },
    {
      status: 'cancelled',
      label: 'Cancelar',
      dialogTitle: 'Cancelar pedido',
      confirmLabel: 'Sí, cancelar pedido',
      subtitle: 'Se cancela el pedido.',
      tone: 'destructive',
    },
  ],
  in_transit: [
    {
      status: 'delivered',
      label: 'Marcar Entregada',
      dialogTitle: 'Marcar como Entregada',
      confirmLabel: 'Sí, marcar Entregada',
      subtitle: 'Confirma la entrega y descuenta stock.',
      tone: 'primary',
    },
    {
      status: 'assigned',
      label: 'Volver a Asignada',
      dialogTitle: 'Volver a Asignada',
      confirmLabel: 'Sí, volver a Asignada',
      subtitle: 'Vuelve a estar asignada.',
      tone: 'secondary',
    },
    {
      status: 'cancelled',
      label: 'Cancelar',
      dialogTitle: 'Cancelar pedido',
      confirmLabel: 'Sí, cancelar pedido',
      subtitle: 'Se cancela el pedido.',
      tone: 'destructive',
    },
  ],
  delivered: [
    {
      status: 'in_transit',
      label: 'Deshacer Entrega',
      dialogTitle: 'Volver a En Camino',
      confirmLabel: 'Sí, volver a En Camino',
      subtitle: 'Deshace la entrega y repone el stock.',
      tone: 'destructive',
    },
  ],
  cancelled: [],
};

/** Icon for a transition target — undo (delivered → in_transit) gets its own glyph. */
const transitionIcon = (current: OrderStatus, target: OrderStatus) => {
  if (current === 'delivered' && target === 'in_transit') return <IconUndo size={20} />;
  switch (target) {
    case 'assigned':
      return <IconRoute size={20} />;
    case 'in_transit':
      return <IconTruck size={20} />;
    case 'delivered':
      return <IconCircleCheck size={20} />;
    case 'pending':
      return <IconClock size={20} />;
    case 'cancelled':
      return <IconX size={20} />;
  }
};

const channelLabels: Record<string, string> = {
  phone: 'Teléfono',
  whatsapp: 'WhatsApp',
  driver_visit: 'Visita del repartidor',
  walk_in: 'Mostrador (puesto)',
};

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  check: 'Cheque',
};

const PAYMENT_PREFERENCE_LABELS: Record<PaymentPreference, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  credit: 'Cta. Cte.',
  cod: 'Contra reembolso',
  partial: 'Pago parcial',
};

const REFERENCE_LABELS: Record<string, string> = {
  transfer: 'Referencia',
  check: 'Nro. de Cheque',
};

const ACCOUNT_LABELS: Record<MoneyAccount, string> = {
  cash: 'Efectivo',
  mp: 'Mercado Pago',
  bank: 'Banco',
};

/** Money account the payment lands in, defaulted by method (cash→Efectivo, check→Banco). */
const accountForMethod = (method: PaymentMethod): MoneyAccount =>
  method === 'cash' ? 'cash' : method === 'check' ? 'bank' : 'mp';

const RETURN_REASON_LABELS: Record<ReturnReason, string> = {
  broken: 'Roto',
  difference: 'Diferencia de cantidad',
  product_change: 'Cambio de producto',
  other: 'Otro',
};

const RETURN_EFFECT_LABELS: Record<ReturnEffect, string> = {
  refund_cash: 'Reembolso en efectivo',
  refund_transfer: 'Reembolso por transferencia',
  reduce_debt: 'Descontar deuda',
  no_refund: 'Sin reembolso',
};

interface EditItemRow {
  productId: string;
  quantity: string;
}

/** One row of the "Registrar devolución" dialog — per order item, quantity
 *  capped at what remains after prior returns (ordered − already returned). */
interface ReturnRow {
  productId: string;
  productName: string;
  quantity: number;
  unit: PriceUnit;
  mapleQty?: number;
  unitPrice: number;
  alreadyReturned: number;
  qty: string;
}

/** Monetary totals for the current return draft. Uses the SAME effective-value
 *  math as the backend: the order-level bonificación/recargo factor
 *  (`totalAmount / subtotal`) is applied to the returned line subtotals, and
 *  only the already-paid portion is refundable. */
interface ReturnTotals {
  effectiveValue: number;
  debtCancelled: number;
  paidPortion: number;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

const computeReturnTotals = (order: Order, rows: ReturnRow[]): ReturnTotals => {
  const subtotalFromItems = order.items.reduce((sum, item) => sum + item.subtotal, 0);
  // Legacy orders may lack `subtotal` (or carry 0) → derive it from the items.
  const orderSubtotal = order.subtotal && order.subtotal > 0 ? order.subtotal : subtotalFromItems;
  const factor = orderSubtotal > 0 ? order.totalAmount / orderSubtotal : 1;
  const rawSubtotal = rows.reduce((sum, row) => sum + (Number(row.qty) || 0) * row.unitPrice, 0);
  const effectiveValue = round2(rawSubtotal * factor);
  const balanceBefore = round2(order.balance);
  const debtCancelled = round2(Math.min(balanceBefore, effectiveValue));
  const paidPortion = round2(effectiveValue - debtCancelled);
  return { effectiveValue, debtCancelled, paidPortion };
};

/* ── OrderDetailPage ────────────────────────── */

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const goBack = useSmartBack('/orders');
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  // Reads — the order, its payments and its returns. Mutations invalidate the
  // domains, so the page refetches automatically after every write.
  const orderQuery = useOrder(id);
  const paymentsQuery = usePayments(id);
  const returnsQuery = useOrderReturns(id);
  const order = orderQuery.data ?? null;
  const payments = paymentsQuery.data ?? [];
  const returns = returnsQuery.data ?? [];
  const loading = orderQuery.isLoading || paymentsQuery.isLoading || returnsQuery.isLoading;

  const queryError = orderQuery.error;
  const loadError = queryError
    ? queryError instanceof Error
      ? queryError.message
      : 'Error al cargar la orden'
    : null;
  // Action errors (transition / undo delivery) surfaced next to load errors.
  const [actionError, setActionError] = useState<string | null>(null);
  const error = loadError ?? actionError;

  // Writes — offline-aware; each invalidates orders + linked domains.
  const transitionOrder = useTransitionOrderStatus();
  const updateOrder = useUpdateOrder();
  const recordPayment = useRecordPayment();
  const createReturn = useCreateReturn();
  const paymentSubmitting = recordPayment.isPending;
  const transitionSubmitting = transitionOrder.isPending;
  const editSubmitting = updateOrder.isPending;
  const returnSubmitting = createReturn.isPending;

  // Edit dialog — product select fed by useProducts; per-product active maple
  // prices come from a fan-out (each lookup caught: no price → row shows 0).
  const editProductsQuery = useProducts();
  const editProducts = editProductsQuery.data ?? [];
  const editPriceQueries = useQueries({
    queries: editProducts.map((p) => ({
      queryKey: queryKeys.products.activePrice(p._id),
      queryFn: () => productsApi.getActivePrice(p._id).catch(() => undefined),
    })),
  });
  const editPriceMap: Record<string, PriceEntry> = {};
  for (const q of editPriceQueries) {
    const entry = q.data;
    if (entry) editPriceMap[entry.productId] = entry;
  }

  // Payment form
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paymentAccount, setPaymentAccount] = useState<MoneyAccount>('cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);

  // Status-change confirmation — every transition is gated by the dialog.
  const [pendingTransition, setPendingTransition] = useState<TransitionAction | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  // Money decision for a paid cancellation — reset every time the dialog opens
  // or closes so a stale choice can never be submitted.
  const [cancelMoneyAction, setCancelMoneyAction] = useState<CancelMoneyAction | null>(null);

  // Registrar devolución (admin + driver, in_transit/delivered)
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnRows, setReturnRows] = useState<ReturnRow[]>([]);
  const [returnReason, setReturnReason] = useState<ReturnReason | ''>('');
  const [returnEffect, setReturnEffect] = useState<ReturnEffect | ''>('');
  const [returnRefund, setReturnRefund] = useState('');
  const [returnRefundEdited, setReturnRefundEdited] = useState(false);
  const [returnNotes, setReturnNotes] = useState('');
  const [returnError, setReturnError] = useState<string | null>(null);

  // Edit order (admin, pending only)
  const [editOpen, setEditOpen] = useState(false);
  const [editChannel, setEditChannel] = useState<OrderChannel>('phone');
  const [editItems, setEditItems] = useState<EditItemRow[]>([]);
  const [editError, setEditError] = useState<string | null>(null);

  // Snackbar
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  /* ── Status transitions (always via confirmation) ── */

  const openTransitionConfirm = (action: TransitionAction) => {
    setTransitionError(null);
    setCancelMoneyAction(null);
    setPendingTransition(action);
  };

  const closeTransitionConfirm = () => {
    // Never dismiss mid-flight: the request is already committed.
    if (transitionOrder.isPending) return;
    setPendingTransition(null);
    setTransitionError(null);
    setCancelMoneyAction(null);
  };

  const confirmTransition = () => {
    if (!order || !pendingTransition) return;
    const target = pendingTransition.status;
    // Cancelling an order that already collected money always asks what to do
    // with it — the backend rejects the request otherwise.
    const requiresMoneyChoice = target === 'cancelled' && order.paidAmount > 0;
    if (requiresMoneyChoice && cancelMoneyAction === null) return;
    // Undoing a delivery restores stock — same request, distinct feedback.
    const isUndoDelivery = order.status === 'delivered' && target === 'in_transit';

    transitionOrder.mutate(
      {
        id: order._id,
        status: target,
        ...(requiresMoneyChoice && cancelMoneyAction ? { moneyAction: cancelMoneyAction } : {}),
      },
      {
        onSuccess: () => {
          setPendingTransition(null);
          setTransitionError(null);
          setCancelMoneyAction(null);
          if (isUndoDelivery) {
            setSnackbar({ open: true, message: 'Entrega deshecha — stock restaurado', severity: 'success' });
          }
        },
        onError: (err) => {
          // Offline queued write: normal outcome, the OfflineBanner confirmed it.
          if (isOfflineQueuedError(err)) {
            setPendingTransition(null);
            if (isUndoDelivery) {
              setSnackbar({ open: true, message: 'Entrega deshecha (offline) — stock restaurado', severity: 'success' });
            }
            return;
          }
          const message = err instanceof Error ? err.message : 'Error al actualizar estado';
          setActionError(message);
          setTransitionError(message);
        },
      },
    );
  };

  const resetPaymentForm = () => {
    setShowPaymentForm(false);
    setPaymentAmount('');
    setPaymentMethod('cash');
    setPaymentAccount('cash');
    setPaymentReference('');
    setPaymentError(null);
  };

  const handleRecordPayment = (e: FormEvent) => {
    e.preventDefault();
    if (!order) return;

    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) {
      setPaymentError('El monto debe ser mayor a 0');
      return;
    }
    if (amount > order.balance) {
      setPaymentError(`El monto no puede exceder el saldo ($ ${order.balance.toFixed(2)})`);
      return;
    }

    const payload: CreatePaymentPayload = {
      amount,
      method: paymentMethod,
      account: paymentAccount,
      ...(paymentReference.trim() ? { reference: paymentReference.trim() } : {}),
    };
    recordPayment.mutate(
      { orderId: order._id, data: payload },
      {
        onSuccess: resetPaymentForm,
        onError: (err) => {
          if (isOfflineQueuedError(err)) {
            resetPaymentForm();
            return;
          }
          setPaymentError(err instanceof Error ? err.message : 'Error al registrar pago');
        },
      },
    );
  };

  /* ── Edit (admin, pending only) ───────────── */

  const openEditDialog = () => {
    if (!order) return;
    setEditChannel(order.channel);
    setEditItems(order.items.map((it) => ({ productId: it.productId, quantity: String(it.quantity) })));
    setEditError(null);
    setEditOpen(true);
  };

  const closeEditDialog = () => {
    setEditOpen(false);
    setEditError(null);
  };

  const updateEditItemProduct = (index: number, productId: string) => {
    setEditItems((rows) => rows.map((r, i) => (i === index ? { ...r, productId } : r)));
  };

  const updateEditItemQuantity = (index: number, quantity: string) => {
    setEditItems((rows) => rows.map((r, i) => (i === index ? { ...r, quantity } : r)));
  };

  const addEditItemRow = () => {
    setEditItems((rows) => [...rows, { productId: '', quantity: '1' }]);
  };

  const removeEditItemRow = (index: number) => {
    setEditItems((rows) => (rows.length <= 1 ? rows : rows.filter((_, i) => i !== index)));
  };

  const handleSaveEdit = (e: FormEvent) => {
    e.preventDefault();
    if (!order) return;
    setEditError(null);

    const validItems = editItems.filter((r) => r.productId && Number(r.quantity) > 0);
    if (validItems.length === 0) {
      setEditError('Agregá al menos un producto con cantidad');
      return;
    }

    updateOrder.mutate(
      {
        id: order._id,
        data: {
          channel: editChannel,
          items: validItems.map((r) => ({ productId: r.productId, quantity: Number(r.quantity) })),
        },
      },
      {
        onSuccess: () => {
          closeEditDialog();
          setSnackbar({ open: true, message: 'Orden actualizada', severity: 'success' });
        },
        onError: (err) => {
          // 409: order already assigned, or total below paid amount — backend message shown.
          if (isOfflineQueuedError(err)) {
            closeEditDialog();
            setSnackbar({ open: true, message: 'Orden actualizada (offline)', severity: 'success' });
            return;
          }
          setEditError(err instanceof Error ? err.message : 'Error al actualizar la orden');
        },
      },
    );
  };

  /* ── Registrar devolución (admin + driver) ── */

  const openReturnDialog = () => {
    if (!order) return;
    const returnedByProduct = new Map<string, number>();
    for (const returnDoc of returns) {
      for (const item of returnDoc.items) {
        returnedByProduct.set(item.productId, (returnedByProduct.get(item.productId) ?? 0) + item.quantity);
      }
    }
    setReturnRows(
      order.items.map((it) => ({
        productId: it.productId,
        productName: it.productName,
        quantity: it.quantity,
        unit: it.unit ?? 'maple',
        mapleQty: it.mapleQty,
        unitPrice: it.unitPrice,
        alreadyReturned: returnedByProduct.get(it.productId) ?? 0,
        qty: '',
      }))
    );
    setReturnReason('');
    setReturnEffect('');
    setReturnRefund('');
    setReturnRefundEdited(false);
    setReturnNotes('');
    setReturnError(null);
    setReturnOpen(true);
  };

  const updateReturnQty = (index: number, qty: string) => {
    setReturnRows((rows) => rows.map((r, i) => (i === index ? { ...r, qty } : r)));
    // Keep the refund input in sync with the returned amount until the user
    // edits it manually.
    if (!returnRefundEdited) setReturnRefund('');
  };

  const handleReturnEffectChange = (effect: ReturnEffect) => {
    setReturnEffect(effect);
    if (effect === 'refund_cash' || effect === 'refund_transfer') {
      setReturnRefund('');
      setReturnRefundEdited(false);
    }
  };

  const handleSaveReturn = async (e: FormEvent) => {
    e.preventDefault();
    if (!order) return;
    setReturnError(null);

    if (!returnReason) {
      setReturnError('Seleccioná un motivo');
      return;
    }
    if (!returnEffect) {
      setReturnError('Seleccioná un efecto');
      return;
    }

    const items = returnRows
      .map((r) => ({ productId: r.productId, quantity: Math.floor(Number(r.qty) || 0) }))
      .filter((it) => it.quantity > 0);

    for (const row of returnRows) {
      const qty = Number(row.qty) || 0;
      if (qty < 0) {
        setReturnError('Las cantidades no pueden ser negativas');
        return;
      }
      const remaining = row.quantity - row.alreadyReturned;
      if (qty > remaining) {
        const unitName = unitLabel(row.unit, { plural: remaining !== 1 });
        setReturnError(
          `${row.productName}: máximo ${remaining} ${unitName} (ya se devolvieron ${row.alreadyReturned})`
        );
        return;
      }
    }

    if (items.length === 0) {
      setReturnError('Indicá al menos un producto con cantidad mayor a 0');
      return;
    }

    // Cap the refund at the paid portion of the EFFECTIVE returned value, not
    // the raw line price and not the order's total paid amount.
    const totals = computeReturnTotals(order, returnRows);
    const refundCandidate =
      returnEffect === 'refund_cash' || returnEffect === 'refund_transfer'
        ? returnRefund === ''
          ? totals.paidPortion
          : Math.max(0, Number(returnRefund) || 0)
        : 0;
    if (refundCandidate > totals.paidPortion) {
      setReturnError(
        `El reembolso no puede superar la parte pagada del valor efectivo devuelto (${fmtMoney(totals.paidPortion)})`
      );
      return;
    }

    setReturnError(null);

    const payload: CreateReturnPayload = {
      items,
      reason: returnReason,
      effect: returnEffect,
      ...(returnEffect === 'refund_cash' || returnEffect === 'refund_transfer'
        ? { refundAmount: returnRefundValue }
        : {}),
      ...(returnNotes.trim() ? { notes: returnNotes.trim() } : {}),
    };
    createReturn.mutate(
      { orderId: order._id, data: payload },
      {
        onSuccess: () => {
          setReturnOpen(false);
          setSnackbar({ open: true, message: 'Devolución registrada', severity: 'success' });
        },
        onError: (err) => {
          // Offline queued write: normal outcome, the OfflineBanner confirmed it.
          if (isOfflineQueuedError(err)) {
            setReturnOpen(false);
            setSnackbar({ open: true, message: 'Devolución registrada (offline)', severity: 'success' });
            return;
          }
          setReturnError(err instanceof Error ? err.message : 'Error al registrar la devolución');
        },
      },
    );
  };

  if (loading) {
    return <LoadingState label="Cargando orden…" />;
  }

  if (error && !order) {
    return (
      <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
        <MuiButton variant="ghost" onClick={goBack} startIcon={<IconArrowBack />}>
          Volver a Órdenes
        </MuiButton>
        <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>
      </Box>
    );
  }

  if (!order) return null;

  const config = statusLabelMap[order.status];
  // Undo delivery (restores stock) is an admin-only action.
  const transitions =
    order.status === 'delivered' && !isAdmin ? [] : (validTransitions[order.status] ?? []);

  const fmtMoney = (val: number) =>
    `$ ${val.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

  // Live devolución totals using the SAME effective-value math as the backend:
  // the order-level bonificación/recargo is distributed across the returned
  // lines, and only the already-paid portion is refundable.
  const isRefundEffect = returnEffect === 'refund_cash' || returnEffect === 'refund_transfer';
  const returnTotals = computeReturnTotals(order, returnRows);
  const returnEffectiveValue = returnTotals.effectiveValue;
  const returnRefundCap = returnTotals.paidPortion;
  const returnRefundValue = isRefundEffect
    ? returnRefund === ''
      ? returnRefundCap
      : Math.max(0, Number(returnRefund) || 0)
    : 0;
  // Saldo a favor preview: the paid portion that is not refunded. For
  // `reduce_debt` the whole paid portion becomes credit; `no_refund` is an
  // explicit forgiveness → no credit.
  const returnCreditPreview =
    returnEffect === 'no_refund' || returnEffect === ''
      ? 0
      : round2(Math.max(0, returnTotals.paidPortion - returnRefundValue));

  const paymentStatusConfig = {
    paid: { label: 'Pagado', color: 'success' as const },
    partial: { label: 'Parcial', color: 'warning' as const },
    unpaid: { label: 'Impago', color: 'error' as const },
  };

  const psConfig = paymentStatusConfig[order.paymentStatus] ?? paymentStatusConfig.unpaid;

  // Stock consequence for the pending transition — mirrors the backend.
  const pendingConsequence = pendingTransition
    ? getTransitionConsequence(
        order.status,
        pendingTransition.status,
        order.stockDeducted,
        statusLabelMap[pendingTransition.status],
      )
    : null;

  // A paid cancellation also moves money — spell out the chosen outcome as part
  // of the consequence, not only inside the radio section.
  const requiresCancelMoney =
    pendingTransition?.status === 'cancelled' && order.paidAmount > 0;
  const cancelMoneyText = (() => {
    if (!requiresCancelMoney) return null;
    if (cancelMoneyAction === null) {
      return `El pedido tiene ${fmtMoney(order.paidAmount)} cobrados: elegí qué hacer con la plata.`;
    }
    switch (cancelMoneyAction) {
      case 'refund_cash':
        return `Se reintegrarán ${fmtMoney(order.paidAmount)} en efectivo.`;
      case 'refund_transfer':
        return `Se reintegrarán ${fmtMoney(order.paidAmount)} por transferencia.`;
      case 'customer_credit':
        return `Se dejarán ${fmtMoney(order.paidAmount)} a favor del cliente.`;
      case 'none':
        return 'No se moverá la plata (se resuelve aparte).';
    }
    return null;
  })();
  const displayConsequence =
    pendingConsequence && cancelMoneyText
      ? pendingConsequence.lead
        ? {
            ...pendingConsequence,
            detail: `${pendingConsequence.detail ?? ''} ${cancelMoneyText}`.trim(),
          }
        : {
            ...pendingConsequence,
            text: `${pendingConsequence.text ?? ''} ${cancelMoneyText}`.trim(),
          }
      : pendingConsequence;

  const canRegisterReturn =
    !!user &&
    (user.role === 'admin' || user.role === 'superadmin' || user.role === 'driver') &&
    (order.status === 'in_transit' || order.status === 'delivered');
  const canEditOrder = isAdmin && order.status === 'pending';

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ mb: 6 }}>
        <MuiButton variant="ghost" onClick={goBack} startIcon={<IconArrowBack />} sx={{ mb: 3 }}>
          Volver
        </MuiButton>
        <PageHeader
          title={`Orden #${order.orderNumber}`}
          subtitle={`${order.customerName} · ${new Date(order.orderDate ?? order.createdAt).toLocaleDateString('es-AR')}`}
          icon={<IconTruck size={22} />}
          actions={
            <MuiChip label={config} color={statusColorMap[order.status]} size="small" variant="outlined" />
          }
        />
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 4 }}>{error}</Alert>
      )}

      {/* Estado del pedido — prominent current status + every status action */}
      <Box sx={{ mb: 6 }}>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, display: 'block', mb: 1.5 }}>
          Estado del pedido
        </Typography>
        <MuiCard variant="elevated">
          {/* Current status — large tonal pill */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: transitions.length > 0 || canRegisterReturn || canEditOrder ? 3 : 0 }}>
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 1,
                px: 2,
                py: 1,
                borderRadius: m3Shape.full,
                bgcolor: statusContainerMap[order.status].bg,
                color: statusContainerMap[order.status].fg,
              }}
            >
              {statusIconMap[order.status]}
              <Typography variant="titleSmall" sx={{ fontWeight: 700, color: 'inherit' }}>
                {statusLabelMap[order.status]}
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary">
              {order.stockDeducted ? 'Stock ya descontado del depósito.' : 'Stock aún en depósito.'}
            </Typography>
          </Box>

          {/* Status action grid */}
          {transitions.length > 0 ? (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 2 }}>
              {transitions.map((action) => {
                const destructive = action.tone === 'destructive';
                return (
                  <MuiButton
                    key={action.status}
                    fullWidth
                    variant={action.tone === 'primary' ? 'primary' : 'secondary'}
                    onClick={() => openTransitionConfirm(action)}
                    sx={{
                      justifyContent: 'flex-start',
                      alignItems: 'stretch',
                      textAlign: 'left',
                      whiteSpace: 'normal',
                      py: 1.5,
                      px: 2,
                      minHeight: 76,
                      ...(destructive && {
                        bgcolor: 'errorContainer',
                        color: 'onErrorContainer',
                        '&:hover': { bgcolor: 'errorContainer', filter: 'brightness(0.96)' },
                      }),
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, width: '100%', minWidth: 0 }}>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 36,
                          height: 36,
                          flexShrink: 0,
                          borderRadius: m3Shape.medium,
                          color: 'inherit',
                          bgcolor:
                            action.tone === 'primary'
                              ? 'rgba(255,255,255,0.2)'
                              : action.tone === 'destructive'
                                ? 'color-mix(in srgb, var(--mui-palette-onErrorContainer) 12%, transparent)'
                                : 'surfaceContainerHigh',
                        }}
                      >
                        {transitionIcon(order.status, action.status)}
                      </Box>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography variant="titleSmall" sx={{ fontWeight: 700, color: 'inherit', display: 'block', lineHeight: 1.3 }}>
                          {action.label}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'inherit', opacity: 0.85, display: 'block', mt: 0.25, whiteSpace: 'normal' }}>
                          {action.subtitle}
                        </Typography>
                      </Box>
                    </Box>
                  </MuiButton>
                );
              })}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No hay acciones de estado disponibles.
            </Typography>
          )}

          {/* Secondary actions — returns and edit (not status transitions) */}
          {(canRegisterReturn || canEditOrder) && (
            <>
              <Box sx={{ my: 3, borderTop: 1, borderColor: 'outlineVariant' }} />
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
                {canRegisterReturn && (
                  <MuiButton variant="secondary" onClick={openReturnDialog} startIcon={<IconUndo />}>
                    Registrar Devolución
                  </MuiButton>
                )}
                {canEditOrder && (
                  <MuiButton variant="secondary" onClick={openEditDialog} startIcon={<IconEdit />}>
                    Editar orden
                  </MuiButton>
                )}
              </Box>
            </>
          )}
        </MuiCard>
      </Box>

      {/* Summary cards */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
          gap: 3,
          mb: 6,
        }}
      >
        {[
          { label: 'Total', value: fmtMoney(order.totalAmount), color: 'text.primary' },
          { label: 'Pagado', value: fmtMoney(order.paidAmount), color: 'success.main' },
          { label: 'Saldo', value: fmtMoney(order.balance), color: order.balance > 0 ? 'error.main' : 'success.main' },
          { label: 'Canal', value: channelLabels[order.channel] ?? order.channel, color: 'text.primary', isText: true },
        ].map((item) => (
          <MuiCard key={item.label} variant="elevated">
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', mb: 0.5 }}>
              {item.label}
            </Typography>
            <Typography
              variant={item.isText ? 'body1' : 'h6'}
              sx={{
                fontFamily: item.isText ? 'inherit' : 'monospace',
                fontWeight: item.isText ? 500 : 700,
                fontVariantNumeric: 'tabular-nums',
                color: item.color,
                lineHeight: 1.2,
              }}
            >
              {item.value}
            </Typography>
          </MuiCard>
        ))}
      </Box>

      {/* Shipping card */}
      <MuiCard variant="elevated" sx={{ mb: 6 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: m3Shape.small, bgcolor: 'primaryContainer', color: 'onPrimaryContainer' }}>
            <IconTruck size={18} />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            Envío
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          <IconLocation size={18} style={{ color: 'var(--mui-palette-onSurfaceVariant)', marginTop: 2, flexShrink: 0 }} />
          <Box>
            <Typography variant="body2" sx={{ color: 'text.primary', fontWeight: 500 }}>
              {order.deliveryAddress || 'Sin dirección de entrega'}
            </Typography>
            {order.deliveryNotes && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {order.deliveryNotes}
              </Typography>
            )}
          </Box>
        </Box>
      </MuiCard>

      {/* Items — rich M3 list */}
      <Box sx={{ mb: 6 }}>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, display: 'block', mb: 1.5 }}>
          Productos
        </Typography>
        <MuiCard variant="elevated" sx={{ p: 0, overflow: 'hidden' }}>
          {order.items.map((item, index) => {
            const isLast = index === order.items.length - 1;
            const itemUnit = item.unit ?? 'maple';
            const qtyLabel = `${item.quantity} ${unitLabel(itemUnit, { plural: item.quantity !== 1 })}`;
            const unitName = unitLabel(itemUnit);
            const hasPromo = Boolean(item.promo);
            return (
              <Box key={index}>
                {/* Row: leading icon + body + trailing */}
                <Box
                  sx={{
                    display: 'flex',
                    flexWrap: { xs: 'wrap', md: 'nowrap' },
                    gap: 2,
                    alignItems: 'flex-start',
                    py: { xs: 2, md: 2.5 },
                  }}
                >
                  {/* Leading — tonal square */}
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 44,
                      height: 44,
                      borderRadius: m3Shape.medium,
                      flexShrink: 0,
                      bgcolor: hasPromo ? 'tertiaryContainer' : 'primaryContainer',
                      color: hasPromo ? 'onTertiaryContainer' : 'onPrimaryContainer',
                    }}
                  >
                    <IconEgg size={24} />
                  </Box>

                  {/* Body */}
                  <Box sx={{ flex: 1, minWidth: { xs: 140, md: 0 } }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Typography variant="titleMedium" sx={{ fontWeight: 700, color: 'onSurface', lineHeight: 1.3 }}>
                        {item.productName}
                      </Typography>
                      {hasPromo && (
                        <MuiChip
                          label="PROMO"
                          color="primary"
                          size="small"
                          icon={<IconPromo size={12} />}
                          sx={{ flexShrink: 0 }}
                        />
                      )}
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
                      <Typography
                        variant="labelMedium"
                        sx={{ color: 'onSurface', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
                      >
                        {qtyLabel}
                      </Typography>
                      {itemUnit !== 'maple' && item.mapleQty != null && (
                        <Typography variant="caption" color="onSurfaceVariant" sx={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                          = {item.mapleQty.toLocaleString('es-AR')} maples
                        </Typography>
                      )}
                      {hasPromo && item.promo && (
                        <Typography variant="caption" sx={{ color: 'tertiary.main', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                          {promoShortLabel(item.promo)}
                        </Typography>
                      )}
                    </Box>
                  </Box>

                  {/* Trailing — subtotal + unit price (wraps below on very small screens) */}
                  <Box sx={{ textAlign: 'right', flexShrink: 0, ml: { xs: 'auto', md: 0 }, minWidth: 0 }}>
                    <Typography
                      variant="titleMedium"
                      sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'onSurface', lineHeight: 1.2, whiteSpace: 'nowrap' }}
                    >
                      {fmtMoney(item.subtotal)}
                    </Typography>
                    {item.originalUnitPrice != null && (
                      <Typography variant="caption" color="onSurfaceVariant" sx={{ textDecoration: 'line-through', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', display: 'block', whiteSpace: 'nowrap' }}>
                        {fmtMoney(item.originalUnitPrice)}
                      </Typography>
                    )}
                    <Typography variant="caption" color="onSurfaceVariant" sx={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', display: 'block', whiteSpace: 'nowrap' }}>
                      {fmtMoney(item.unitPrice)}/{unitName}
                    </Typography>
                  </Box>
                </Box>
                {/* Inset divider — aligns with the body text after the 44px leading */}
                {!isLast && (
                  <Box sx={{ ml: '60px', borderBottom: 1, borderColor: 'outlineVariant' }} />
                )}
              </Box>
            );
          })}
          {/* Total footer */}
          <Box sx={{ py: 2, borderTop: 1, borderColor: 'outlineVariant', bgcolor: 'action.hover', px: 2 }}>
            {((order.bonification?.amount ?? 0) > 0 || (order.surcharge?.amount ?? 0) > 0) && (
              <>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5, mb: 0.75 }}>
                  <Typography variant="body2" color="text.secondary">
                    Subtotal
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', color: 'text.primary' }}>
                    {fmtMoney(
                      order.subtotal ??
                        order.totalAmount +
                          (order.bonification?.amount ?? 0) -
                          (order.surcharge?.amount ?? 0)
                    )}
                  </Typography>
                </Box>
                {order.bonification && order.bonification.amount > 0 && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5, mb: 0.75 }}>
                    <Typography variant="body2" color="text.secondary">
                      Bonificación
                      {order.bonification.type === 'percent'
                        ? ` (${order.bonification.value}%)`
                        : ' (monto fijo)'}
                    </Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', color: 'success.main', fontWeight: 700 }}>
                      −{fmtMoney(order.bonification.amount)}
                    </Typography>
                  </Box>
                )}
                {order.surcharge && order.surcharge.amount > 0 && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5, mb: 0.75 }}>
                    <Typography variant="body2" color="text.secondary">
                      Recargo
                      {order.surcharge.type === 'percent'
                        ? ` (${order.surcharge.value}%)`
                        : ' (monto fijo)'}
                    </Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', color: 'warning.main', fontWeight: 700 }}>
                      +{fmtMoney(order.surcharge.amount)}
                    </Typography>
                  </Box>
                )}
              </>
            )}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography variant="titleMedium" sx={{ fontWeight: 700, color: 'onSurface' }}>
                  Total
                </Typography>
                {order.returnedAmount > 0 && (
                  <MuiChip label={`Devuelto: ${fmtMoney(order.returnedAmount)}`} color="warning" size="small" variant="outlined" />
                )}
              </Box>
              <Typography variant="titleLarge" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'onSurface', lineHeight: 1.2 }}>
                {fmtMoney(order.totalAmount)}
              </Typography>
            </Box>
          </Box>
        </MuiCard>
      </Box>

      {/* Returns */}
      {returns.length > 0 && (
        <Box sx={{ mb: 6 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
              Devoluciones ({returns.length})
            </Typography>
          </Box>
          <MuiCard variant="elevated" sx={{ p: 0, overflow: 'hidden' }}>
            {returns.map((ret) => (
              <Box key={ret._id} sx={{ display: 'flex', px: 3, py: 1.5, borderBottom: 1, borderColor: 'divider', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <Box sx={{ flex: 2, minWidth: 140 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {new Date(ret.date).toLocaleString('es-AR')}
                  </Typography>
                </Box>
                <Box sx={{ flex: 2, minWidth: 140 }}>
                  <Typography variant="body2">{RETURN_REASON_LABELS[ret.reason]}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {RETURN_EFFECT_LABELS[ret.effect]}
                  </Typography>
                </Box>
                <Box sx={{ flex: 1, textAlign: 'right', minWidth: 120 }}>
                  <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'warning.main' }}>
                    {fmtMoney(ret.returnedAmount)}
                  </Typography>
                  {ret.refundAmount > 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', display: 'block' }}>
                      reembolso {fmtMoney(ret.refundAmount)}
                    </Typography>
                  )}
                </Box>
              </Box>
            ))}
          </MuiCard>
        </Box>
      )}

      {/* Payments */}
      <Box sx={{ mb: 6 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            Pagos
          </Typography>
          {order.balance > 0 && order.status !== 'cancelled' && (
            <MuiButton variant="primary" size="sm" onClick={() => setShowPaymentForm(!showPaymentForm)} startIcon={<IconPlus />}>
              {showPaymentForm ? 'Cancelar' : 'Registrar Pago'}
            </MuiButton>
          )}
        </Box>

        {/* Payment form */}
        {showPaymentForm && (
          <MuiCard variant="elevated" sx={{ mb: 3, p: 3 }}>
            <Box component="form" onSubmit={handleRecordPayment} sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {paymentError && <Alert severity="error">{paymentError}</Alert>}
              <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <MuiTextField
                  label="Monto ($)"
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  required
                  placeholder="0.00"
                  fullWidth
                  slotProps={{
                    htmlInput: { min: 0.01, max: String(order.balance), step: 0.01 },
                  }}
                  sx={{ flex: 1, minWidth: 120 }}
                />
                <MuiTextField
                  label="Método"
                  value={paymentMethod}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setPaymentMethod(e.target.value as PaymentMethod); setPaymentAccount(accountForMethod(e.target.value as PaymentMethod)); setPaymentReference(''); }}
                  select
                  fullWidth
                  sx={{ flex: 1, minWidth: 120 }}
                >
                  <MenuItem value="cash">Efectivo</MenuItem>
                  <MenuItem value="transfer">Transferencia</MenuItem>
                  <MenuItem value="check">Cheque</MenuItem>
                </MuiTextField>
                <MuiTextField
                  label="Cuenta"
                  value={paymentAccount}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPaymentAccount(e.target.value as MoneyAccount)}
                  select
                  fullWidth
                  disabled={paymentMethod !== 'transfer'}
                  sx={{ flex: 1, minWidth: 120 }}
                >
                  {/* Transfer: Mercado Pago (default) or Banco. Cash/check are locked to their account. */}
                  <MenuItem value="cash">{ACCOUNT_LABELS.cash}</MenuItem>
                  <MenuItem value="mp">{ACCOUNT_LABELS.mp}</MenuItem>
                  <MenuItem value="bank">{ACCOUNT_LABELS.bank}</MenuItem>
                </MuiTextField>
                {paymentMethod !== 'cash' && (
                  <MuiTextField
                    label={REFERENCE_LABELS[paymentMethod]}
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value.slice(0, 100))}
                    placeholder={REFERENCE_LABELS[paymentMethod]}
                    fullWidth
                    sx={{ flex: 1, minWidth: 120 }}
                  />
                )}
                <Box sx={{ p: 1, bgcolor: 'action.hover', borderRadius: 1, border: 1, borderColor: 'divider' }}>
                  <Typography variant="caption" color="text.secondary">Saldo pendiente</Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'error.main' }}>
                    {fmtMoney(order.balance)}
                  </Typography>
                </Box>
                <MuiButton type="submit" variant="primary" isLoading={paymentSubmitting} disabled={paymentSubmitting}>
                  {paymentSubmitting ? 'Registrando...' : 'Registrar'}
                </MuiButton>
              </Box>
            </Box>
          </MuiCard>
        )}

        {/* Payments list */}
        {payments.length === 0 ? (
          <MuiCard variant="elevated">
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
              No hay pagos registrados.
            </Typography>
          </MuiCard>
        ) : (
          <MuiCard variant="elevated" sx={{ p: 0, overflow: 'hidden' }}>
            {/* Header */}
            <Box sx={{ display: 'flex', px: 3, py: 1, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
              <Box sx={{ flex: 2, ...thStyle }}>Fecha</Box>
              <Box sx={{ flex: 1, ...thStyle }}>Método</Box>
              <Box sx={{ flex: 1, ...thStyle, textAlign: 'right' }}>Monto</Box>
            </Box>
            {/* Rows */}
            {payments.map((payment) => (
              <Box key={payment._id} sx={{ display: 'flex', px: 3, py: 1.5, borderBottom: 1, borderColor: 'divider', alignItems: 'center' }}>
                <Box sx={{ flex: 2 }}>
                  <Typography variant="body2">{new Date(payment.date).toLocaleDateString('es-AR')}</Typography>
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2">
                    {PAYMENT_METHOD_LABELS[payment.method]}{payment.reference ? ` (${payment.reference})` : ''}
                  </Typography>
                </Box>
                <Box sx={{ flex: 1, textAlign: 'right', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'success.main', fontSize: 'body2.fontSize' }}>
                  {fmtMoney(payment.amount)}
                </Box>
              </Box>
            ))}
          </MuiCard>
        )}
      </Box>

      {/* Details */}
      <Box sx={{ mb: 6 }}>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, display: 'block', mb: 1.5 }}>
          Detalles
        </Typography>
        <MuiCard variant="elevated">
          {(
            [
              {
                label: 'Estado de pago',
                content: (
                  <MuiChip
                    label={psConfig.label}
                    color={psConfig.color}
                    size="small"
                    variant="outlined"
                  />
                ),
              },
              {
                label: 'Forma de pago',
                content: (
                  <MuiChip
                    label={PAYMENT_PREFERENCE_LABELS[order.paymentPreference ?? 'cash']}
                    color="secondary"
                    size="small"
                    variant="outlined"
                  />
                ),
              },
              order.dueDate
                ? {
                    label: 'Fecha vencimiento',
                    content: (
                      <Typography
                        variant="body2"
                        sx={{
                          fontFamily: 'var(--font-mono)',
                          fontVariantNumeric: 'tabular-nums',
                          color: new Date(order.dueDate) < new Date() && order.paymentStatus !== 'paid' ? 'error.main' : 'text.primary',
                        }}
                      >
                        {new Date(order.dueDate).toLocaleDateString('es-AR')}
                      </Typography>
                    ),
                  }
                : null,
              {
                label: 'Fecha del pedido',
                content: (
                  <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                    {new Date(order.orderDate ?? order.createdAt).toLocaleDateString('es-AR')}
                  </Typography>
                ),
              },
              {
                label: 'Creada',
                content: (
                  <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                    {new Date(order.createdAt).toLocaleString('es-AR')}
                  </Typography>
                ),
              },
              {
                label: 'Actualizada',
                content: (
                  <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                    {new Date(order.updatedAt).toLocaleString('es-AR')}
                  </Typography>
                ),
              },
            ] as Array<{ label: string; content: React.ReactNode }>
          )
            .filter((row): row is { label: string; content: React.ReactNode } => row !== null)
            .map((row, idx) => (
            <Box
              key={idx}
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                py: 1,
                px: 2,
                borderBottom: idx < 3 ? 1 : 0,
                borderColor: 'divider',
              }}
            >
              <Typography variant="body2" color="text.secondary">{row.label}</Typography>
              {row.content}
            </Box>
          ))}
        </MuiCard>
      </Box>

      {/* Audit log — credit bypass entries */}
      {order.auditLog && order.auditLog.length > 0 && (
        <Box sx={{ mb: 6 }}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}
          >
            <IconLockOpen size={14} />
            Bypass de Crédito
          </Typography>
          <MuiCard variant="elevated" sx={{ p: 0, overflow: 'hidden' }}>
            {/* Header */}
            <Box sx={{ display: 'flex', px: 3, py: 1, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
              <Box sx={{ flex: 2, ...thStyle }}>Fecha</Box>
              <Box sx={{ flex: 2, ...thStyle }}>Admin</Box>
              <Box sx={{ flex: 1, ...thStyle, textAlign: 'right' }}>Exceso</Box>
            </Box>
            {/* Rows */}
            {order.auditLog.map((entry, idx) => (
              <Box key={idx} sx={{ display: 'flex', px: 3, py: 1.5, borderBottom: 1, borderColor: 'divider', alignItems: 'center' }}>
                <Box sx={{ flex: 2 }}>
                  <Typography variant="body2">{new Date(entry.timestamp).toLocaleString('es-AR')}</Typography>
                </Box>
                <Box sx={{ flex: 2 }}>
                  <Typography variant="body2">{entry.adminUserId}</Typography>
                </Box>
                <Box sx={{ flex: 1, textAlign: 'right', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'error.main', fontSize: 'body2.fontSize' }}>
                  {fmtMoney(entry.overageAmount)}
                </Box>
              </Box>
            ))}
          </MuiCard>
        </Box>
      )}

      {/* ── Edit Order Dialog (admin, pending only) ── */}
      <MuiDialog
        open={editOpen}
        onClose={closeEditDialog}
        title={`Editar orden #${order.orderNumber}`}
        maxWidth="md"
        actions={
          <>
            <MuiButton variant="ghost" onClick={closeEditDialog} disabled={editSubmitting}>Cancelar</MuiButton>
            <MuiButton variant="primary" isLoading={editSubmitting} disabled={editSubmitting} onClick={() => {
              const form = document.querySelector('[data-edit-order-form]') as HTMLFormElement;
              form?.requestSubmit();
            }}>
              {editSubmitting ? 'Guardando...' : 'Guardar cambios'}
            </MuiButton>
          </>
        }
      >
        <Box component="form" data-edit-order-form onSubmit={handleSaveEdit} sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {editError && <Alert severity="error">{editError}</Alert>}

          <MuiTextField
            label="Canal"
            value={editChannel}
            onChange={(e) => setEditChannel(e.target.value as OrderChannel)}
            select
            fullWidth
          >
            <MenuItem value="phone">Teléfono</MenuItem>
            <MenuItem value="whatsapp">WhatsApp</MenuItem>
            <MenuItem value="driver_visit">Visita del repartidor</MenuItem>
            <MenuItem value="walk_in">Mostrador (puesto)</MenuItem>
          </MuiTextField>

          {/* Items builder (simpler version of NewOrderPage) */}
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
                Productos
              </Typography>
              <MuiButton variant="ghost" size="sm" onClick={addEditItemRow} startIcon={<IconPlus />}>
                Agregar
              </MuiButton>
            </Box>

            {editItems.map((row, index) => {
              const unitPrice = editPriceMap[row.productId]?.price ?? 0;
              const qty = Number(row.quantity) || 0;
              return (
                <Box key={index} sx={{ display: 'flex', gap: 2, alignItems: 'flex-end', py: 2, borderBottom: 1, borderColor: 'divider', flexWrap: { xs: 'wrap', md: 'nowrap' } }}>
                  <Box sx={{ flex: 3, minWidth: { xs: 'calc(50% - 8px)', md: 'auto' } }}>
                    <MuiTextField
                      label="Producto"
                      value={row.productId}
                      onChange={(e) => updateEditItemProduct(index, e.target.value)}
                      select
                      fullWidth
                    >
                      <MenuItem value="">Seleccionar...</MenuItem>
                      {editProducts.map((p) => (
                        <MenuItem key={p._id} value={p._id}>{p.displayName}</MenuItem>
                      ))}
                    </MuiTextField>
                  </Box>
                  <Box sx={{ flex: 1, minWidth: { xs: 'calc(50% - 8px)', md: 'auto' } }}>
                    <MuiTextField
                      label="Cantidad"
                      type="number"
                      value={row.quantity}
                      onChange={(e) => updateEditItemQuantity(index, e.target.value)}
                      slotProps={{ htmlInput: { min: 1 } }}
                      fullWidth
                    />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: { xs: 'calc(50% - 8px)', md: 'auto' } }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>P. Unitario</Typography>
                    <Box sx={{ fontFamily: 'var(--font-mono)', fontSize: 'body2.fontSize', fontVariantNumeric: 'tabular-nums', color: 'text.secondary', p: 1.5, bgcolor: 'action.hover', borderRadius: 1, border: 1, borderColor: 'divider' }}>
                      {unitPrice > 0 ? fmtMoney(unitPrice) : 'Sin precio'}
                    </Box>
                  </Box>
                  <Box sx={{ flex: 1, minWidth: { xs: 'calc(50% - 8px)', md: 'auto' } }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Subtotal</Typography>
                    <Box sx={{ fontFamily: 'var(--font-mono)', fontSize: 'body2.fontSize', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'text.primary', p: 1.5, bgcolor: 'action.hover', borderRadius: 1, border: 1, borderColor: 'divider' }}>
                      {fmtMoney(qty * unitPrice)}
                    </Box>
                  </Box>
                  {editItems.length > 1 && (
                    <MuiButton
                      variant="ghost"
                      size="sm"
                      onClick={() => removeEditItemRow(index)}
                      sx={{ color: 'error.main', minWidth: 'auto', p: 1 }}
                    >
                      <IconX size={18} />
                    </MuiButton>
                  )}
                </Box>
              );
            })}
          </Box>

          {/* Projected total */}
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, display: 'block' }}>
                Total proyectado
              </Typography>
              <Typography variant="h6" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
                {fmtMoney(editItems.reduce((sum, r) => {
                  const price = editPriceMap[r.productId]?.price ?? 0;
                  return sum + (Number(r.quantity) || 0) * price;
                }, 0))}
              </Typography>
            </Box>
          </Box>

          <Typography variant="caption" color="text.secondary">
            Los precios se recalculan con la lista vigente. Solo se puede editar una orden pendiente.
          </Typography>
        </Box>
      </MuiDialog>

      {/* ── Registrar Devolución Dialog (admin + driver) ── */}
      <MuiDialog
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        title={`Registrar devolución — orden #${order.orderNumber}`}
        maxWidth="md"
        actions={
          <>
            <MuiButton variant="ghost" onClick={() => setReturnOpen(false)} disabled={returnSubmitting}>Cancelar</MuiButton>
            <MuiButton variant="primary" isLoading={returnSubmitting} disabled={returnSubmitting} onClick={() => {
              const form = document.querySelector('[data-return-form]') as HTMLFormElement;
              form?.requestSubmit();
            }}>
              {returnSubmitting ? 'Guardando...' : 'Registrar devolución'}
            </MuiButton>
          </>
        }
      >
        <Box component="form" data-return-form onSubmit={handleSaveReturn} sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {returnError && <Alert severity="error">{returnError}</Alert>}

          {/* Item rows — qty capped at what remains after prior returns */}
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, display: 'block', mb: 1 }}>
              Productos a devolver
            </Typography>
            {returnRows.map((row, index) => {
              const remaining = row.quantity - row.alreadyReturned;
              const unitName = unitLabel(row.unit);
              const unitNamePlural = unitLabel(row.unit, { plural: true });
              return (
                <Box key={row.productId} sx={{ display: 'flex', gap: 2, alignItems: 'flex-end', py: 2, borderBottom: 1, borderColor: 'divider', flexWrap: { xs: 'wrap', md: 'nowrap' } }}>
                  <Box sx={{ flex: 3, minWidth: { xs: '100%', md: 0 } }}>
                    <Typography variant="titleSmall" sx={{ fontWeight: 600, color: 'onSurface' }}>
                      {row.productName}
                    </Typography>
                    <Typography variant="caption" color="onSurfaceVariant" sx={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', display: 'block' }}>
                      {fmtMoney(row.unitPrice)}/{unitName}
                      {row.unit !== 'maple' && row.mapleQty != null ? ` · ${row.mapleQty.toLocaleString('es-AR')} maples` : ''}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Máx. {remaining} {remaining === 1 ? unitName : unitNamePlural}
                      {row.alreadyReturned > 0 ? ` (${row.alreadyReturned} ya devueltos)` : ''}
                    </Typography>
                  </Box>
                  <Box sx={{ flex: 1, minWidth: { xs: '100%', md: 'auto' } }}>
                    <MuiTextField
                      label={`Cantidad (${unitName})`}
                      type="number"
                      value={row.qty}
                      onChange={(e) => updateReturnQty(index, e.target.value)}
                      slotProps={{ htmlInput: { min: 0, max: remaining, step: 1 } }}
                      fullWidth
                    />
                  </Box>
                </Box>
              );
            })}
          </Box>

          {/* Reason + effect */}
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            <MuiTextField
              select
              label="Motivo"
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value as ReturnReason)}
              fullWidth
              sx={{ flex: 1, minWidth: 200 }}
            >
              <MenuItem value="broken">Roto</MenuItem>
              <MenuItem value="difference">Diferencia de cantidad</MenuItem>
              <MenuItem value="product_change">Cambio de producto</MenuItem>
              <MenuItem value="other">Otro</MenuItem>
            </MuiTextField>
            <MuiTextField
              select
              label="Efecto"
              value={returnEffect}
              onChange={(e) => handleReturnEffectChange(e.target.value as ReturnEffect)}
              fullWidth
              sx={{ flex: 1, minWidth: 200 }}
            >
              <MenuItem value="refund_cash">Reembolso en efectivo</MenuItem>
              <MenuItem value="refund_transfer">Reembolso por transferencia</MenuItem>
              <MenuItem value="reduce_debt">Descontar deuda</MenuItem>
              <MenuItem value="no_refund">Sin reembolso</MenuItem>
            </MuiTextField>
          </Box>

          {/* Refund amount — only when the effect actually refunds money */}
          {isRefundEffect && (
            <Box>
              <MuiTextField
                label="Monto a reembolsar ($)"
                type="number"
                value={returnRefund}
                onChange={(e) => { setReturnRefund(e.target.value); setReturnRefundEdited(true); }}
                helperText={`Máximo ${fmtMoney(returnRefundCap)} (parte pagada del valor efectivo devuelto)`}
                placeholder={fmtMoney(returnRefundCap)}
                fullWidth
                slotProps={{ htmlInput: { min: 0, max: returnRefundCap, step: 0.01 } }}
              />
              {returnCreditPreview > 0 && (
                <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.5 }}>
                  Se generará un saldo a favor de {fmtMoney(returnCreditPreview)}.
                </Typography>
              )}
            </Box>
          )}

          {/* reduce_debt also creates a saldo a favor when there was paid money */}
          {returnEffect === 'reduce_debt' && returnCreditPreview > 0 && (
            <Typography variant="caption" color="warning.main">
              Se generará un saldo a favor de {fmtMoney(returnCreditPreview)} (no hay deuda pendiente que descontar).
            </Typography>
          )}

          {/* Notes */}
          <MuiTextField
            label="Notas"
            multiline
            rows={2}
            value={returnNotes}
            onChange={(e) => setReturnNotes(e.target.value.slice(0, 500))}
            placeholder="Detalles de la devolución (opcional)"
            fullWidth
          />

          {/* Live summary */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', p: 2, bgcolor: 'action.hover', borderRadius: m3Shape.medium, border: 1, borderColor: 'divider' }}>
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, display: 'block' }}>
                Valor devuelto
              </Typography>
              <Typography variant="titleMedium" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'warning.main' }}>
                {fmtMoney(returnEffectiveValue)}
              </Typography>
            </Box>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, display: 'block' }}>
                Reembolso
              </Typography>
              <Typography variant="titleMedium" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'text.primary' }}>
                {fmtMoney(returnRefundValue)}
              </Typography>
            </Box>
            {returnCreditPreview > 0 && (
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, display: 'block' }}>
                  Saldo a favor
                </Typography>
                <Typography variant="titleMedium" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'warning.main' }}>
                  {fmtMoney(returnCreditPreview)}
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      </MuiDialog>

      {/* ── Status change confirmation — the single gate for every action ── */}
      <OrderStatusConfirmDialog
        open={pendingTransition !== null}
        title={pendingTransition?.dialogTitle ?? ''}
        confirmLabel={pendingTransition?.confirmLabel ?? ''}
        consequence={displayConsequence}
        moneyChoice={
          requiresCancelMoney
            ? {
                amount: order.paidAmount,
                value: cancelMoneyAction,
                onChange: setCancelMoneyAction,
              }
            : undefined
        }
        destructive={pendingTransition?.tone === 'destructive'}
        error={transitionError}
        submitting={transitionSubmitting}
        orderNumber={order.orderNumber}
        onClose={closeTransitionConfirm}
        onConfirm={confirmTransition}
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

/* ── Shared styles ──────────────────────────── */

const thStyle = {
  fontSize: '0.75rem',
  fontWeight: 500,
  color: 'text.secondary',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.08em',
};
