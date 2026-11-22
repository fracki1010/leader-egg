import { Link as RouterLink } from 'react-router-dom';
import { MuiChip } from '../ui/index.ts';
import type { StockTransaction, TransactionType } from '../../types/index.ts';
import type { Column } from '../ui/index.ts';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';

/* ── Stock status metadata ───────────────────── */

export type StockStatus = 'alto' | 'ok' | 'bajo';

export function getStockStatus(qty: number, threshold: number): StockStatus {
  if (qty >= threshold * 2) return 'alto';
  if (qty >= threshold) return 'ok';
  return 'bajo';
}

export interface StatusMeta {
  label: string;
  chipColor: 'success' | 'warning' | 'error';
  main: string;
  light: string;
  dark: string;
  /** Tonal container roles for the status-tinted quantity panel */
  container: string;
  onContainer: string;
}

export const STATUS_META: Record<StockStatus, StatusMeta> = {
  alto: { label: 'Alto', chipColor: 'success', main: 'success.main', light: 'success.light', dark: 'success.dark', container: 'successContainer', onContainer: 'onSuccessContainer' },
  ok: { label: 'OK', chipColor: 'warning', main: 'warning.main', light: 'warning.light', dark: 'warning.dark', container: 'warningContainer', onContainer: 'onWarningContainer' },
  bajo: { label: 'Bajo', chipColor: 'error', main: 'error.main', light: 'error.light', dark: 'error.dark', container: 'errorContainer', onContainer: 'onErrorContainer' },
};

/* ── Transaction labels ──────────────────────── */

export const TX_LABELS: Record<TransactionType, string> = {
  sale: 'Venta',
  purchase: 'Compra',
  adjustment: 'Ajuste',
  delivery: 'Entrega',
  opening: 'Punto cero',
  classification: 'Clasificación',
  return: 'Devolución',
};

export const TX_CHIP_COLOR: Record<TransactionType, 'success' | 'error' | 'info' | 'default'> = {
  purchase: 'success',
  delivery: 'error',
  adjustment: 'info',
  sale: 'default',
  opening: 'info',
  classification: 'info',
  return: 'info',
};

export const txColumns: Column<StockTransaction>[] = [
  {
    id: 'createdAt',
    label: 'Fecha',
    sortable: true,
    render: (_value, row) => formatDateTime(row.createdAt),
  },
  {
    id: 'type',
    label: 'Tipo',
    render: (_value, row) => (
      <MuiChip label={TX_LABELS[row.type] ?? row.type} color={TX_CHIP_COLOR[row.type] ?? 'default'} size="small" />
    ),
  },
  {
    id: 'quantity',
    label: 'Cantidad',
    sortable: true,
    render: (value) => {
      const qty = Number(value);
      return (
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: qty > 0 ? 'var(--mui-palette-success-main)' : qty < 0 ? 'var(--mui-palette-error-main)' : 'inherit',
        }}>
          {qty > 0 ? `+${qty}` : String(qty)}
        </span>
      );
    },
  },
  {
    id: 'notes',
    label: 'Notas',
    render: (value, row) => {
      const note = value ? String(value) : '—';
      if (!row.purchaseId) return note;

      return (
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 1 }}>
          <span>{note}</span>
          <Link
            component={RouterLink}
            to={`/compras/${row.purchaseId}`}
            underline="hover"
            sx={{ fontSize: '0.8125rem', fontWeight: 600, color: 'primary.main', cursor: 'pointer' }}
          >
            Ver compra
          </Link>
        </Box>
      );
    },
  },
];

/* ── Format helpers ──────────────────────────── */

export function formatPrice(n: number): string {
  return `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
}

export function formatDateTime(d: string): string {
  return new Date(d).toLocaleString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Backend populates `productId` on GET /v1/inventory (populated doc with
 *  _id/variety/caliber/lowStockThreshold) or returns the raw ObjectId string;
 *  normalize both shapes to a plain product id. */
export function inventoryProductId(inv: { productId: string | { _id: string } }): string {
  if (typeof inv.productId === 'string') return inv.productId;
  return inv.productId._id;
}

/* ── Chips ───────────────────────────────────── */

export function StockStatusChip({ status }: { status: StockStatus }) {
  const meta = STATUS_META[status];
  return <MuiChip label={meta.label} color={meta.chipColor} size="small" statusIcon />;
}

export function NoInventoryChip() {
  return <MuiChip label="Sin inventario" color="default" size="small" />;
}