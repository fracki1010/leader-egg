import { MuiChip } from '../ui/index.ts';
import type { MoneyAccount, PurchasePaymentMethod, PurchasePaymentStatus, PurchaseStatus } from '../../types/index.ts';

/* ── Purchase status / payment metadata ──────── */

export const STATUS_META: Record<PurchaseStatus, { label: string; color: 'default' | 'success' | 'error' }> = {
  pending: { label: 'Pendiente', color: 'default' },
  delivered: { label: 'Entregada', color: 'success' },
  cancelled: { label: 'Cancelada', color: 'error' },
};

export const PAYMENT_META: Record<PurchasePaymentStatus, { label: string; color: 'default' | 'warning' | 'success' }> = {
  unpaid: { label: 'Impago', color: 'default' },
  partial: { label: 'Parcial', color: 'warning' },
  paid: { label: 'Pagado', color: 'success' },
};

export const METHOD_LABELS: Record<PurchasePaymentMethod, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  check: 'Cheque',
};

/** Money account labels shared by the payment editor and the payment history. */
export const ACCOUNT_LABELS: Record<MoneyAccount, string> = {
  cash: 'Efectivo',
  mp: 'Mercado Pago',
  bank: 'Banco',
};

/* ── Formatting helpers (shared list + detail) ─ */

export const formatCurrency = (n: number) =>
  `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

export const formatDate = (d: string) => {
  const date = new Date(d);
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
};

/* ── Chips ───────────────────────────────────── */

export function PurchaseStatusChip({ status }: { status: PurchaseStatus }) {
  const meta = STATUS_META[status];
  return <MuiChip label={meta.label} color={meta.color} size="small" />;
}

export function PurchasePaymentChip({ status }: { status: PurchasePaymentStatus }) {
  const meta = PAYMENT_META[status];
  return <MuiChip label={meta.label} color={meta.color} size="small" variant="outlined" />;
}