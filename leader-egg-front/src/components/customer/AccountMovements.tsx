import { useState } from 'react';
import type { AccountMovement } from '../../api/accounts.ts';
import type { Order } from '../../types/index.ts';
import { EmptyState, MuiCard } from '../ui/index.ts';
import {
  IconAddCircle,
  IconCircleCheck,
  IconExpandMore,
  IconHistory,
  IconInbox,
  IconPayments,
  IconReceiptLong,
  IconUndo,
} from '../ui/icons.tsx';
import { m3Shape } from '../../theme/index.ts';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

/* ── Config ─────────────────────────────────── */

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  check: 'Cheque',
};

const PAYMENT_PREFERENCE_LABELS: Record<string, string> = {
  cash: 'Contado',
  transfer: 'Transferencia',
  credit: 'Crédito',
  cod: 'Contra entrega',
  partial: 'Parcial',
};

const fmtMoney = (val: number) =>
  `$ ${val.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

const fmtDate = (d: string | null) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
};

const fmtDateFull = (d: string) =>
  new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });

/* ── AccountMovements ───────────────────────── */

export interface AccountMovementsProps {
  movements: AccountMovement[];
  /** Open orders belonging to this account. Omit to hide the block. */
  orders?: Order[];
  /** Server-reported open-order count (falls back to `orders.length`). */
  ordersTotal?: number;
  loading?: boolean;
  error?: string | null;
  /** Collapsed by default so the customer hub stays short. */
  defaultExpanded?: boolean;
  onOrderClick?: (orderId: string) => void;
}

/**
 * Collapsible account ledger for one customer: movements (date · concept ·
 * debit/credit) plus a compact open-orders table. Presentational — the caller
 * owns the data query and the order navigation.
 */
export function AccountMovements({
  movements,
  orders,
  ordersTotal,
  loading = false,
  error = null,
  defaultExpanded = false,
  onOrderClick,
}: AccountMovementsProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const totalOpenOrders = ordersTotal ?? orders?.length ?? 0;
  const summaryLabel = loading
    ? 'Cargando…'
    : `${movements.length} ${movements.length === 1 ? 'movimiento' : 'movimientos'}${
        orders && totalOpenOrders > 0
          ? ` · ${totalOpenOrders} ${totalOpenOrders === 1 ? 'orden abierta' : 'órdenes abiertas'}`
          : ''
      }`;

  return (
    <MuiCard variant="elevated" sx={{ mb: 3 }}>
      <Box
        component="button"
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-controls={expanded ? 'account-movements-panel' : undefined}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          width: '100%',
          p: 0,
          m: 0,
          border: 0,
          bgcolor: 'transparent',
          color: 'inherit',
          font: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
          '&:focus-visible': {
            outline: '2px solid',
            outlineColor: 'primary.main',
            outlineOffset: 2,
            borderRadius: m3Shape.small,
          },
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            borderRadius: m3Shape.medium,
            bgcolor: 'secondaryContainer',
            color: 'onSecondaryContainer',
            flexShrink: 0,
          }}
        >
          <IconHistory size={18} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="titleMedium" sx={{ fontWeight: 700, color: 'onSurface' }}>
            Movimientos de la cuenta
          </Typography>
          <Typography variant="labelMedium" color="onSurfaceVariant">
            {summaryLabel}
          </Typography>
        </Box>
        <Box
          sx={{
            display: 'flex',
            color: 'onSurfaceVariant',
            flexShrink: 0,
            transform: expanded ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s ease',
          }}
        >
          <IconExpandMore size={22} />
        </Box>
      </Box>

      {expanded && (
        <Box id="account-movements-panel" sx={{ mt: 2.5 }}>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress size={28} />
            </Box>
          ) : movements.length === 0 ? (
            <EmptyState
              icon={<IconInbox size={28} />}
              title="Sin movimientos"
              subtitle="Los pedidos y pagos de este cliente aparecerán acá."
            />
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              {movements.map((mov: AccountMovement, index) => {
                const isPayment = mov.type === 'payment';
                const isReturn = mov.type === 'return';
                const isCharge = mov.type === 'charge';
                const isCredit = mov.type === 'credit';
                const rowBg = isPayment
                  ? 'successContainer'
                  : isReturn
                    ? 'warningContainer'
                    : isCredit
                      ? 'secondaryContainer'
                      : isCharge
                        ? 'errorContainer'
                        : 'transparent';
                const iconBg = isPayment
                  ? 'secondaryContainer'
                  : isReturn
                    ? 'warningContainer'
                    : isCredit
                      ? 'secondaryContainer'
                      : isCharge
                        ? 'errorContainer'
                        : 'surfaceContainerHigh';
                const iconFg = isPayment
                  ? 'onSecondaryContainer'
                  : isReturn
                    ? 'onWarningContainer'
                    : isCredit
                      ? 'onSecondaryContainer'
                      : isCharge
                        ? 'onErrorContainer'
                        : 'onSurfaceVariant';
                const amountColor = isPayment
                  ? 'secondary.main'
                  : isReturn
                    ? 'warning.main'
                    : isCredit
                      ? 'secondary.main'
                      : isCharge
                        ? 'error.main'
                        : 'onSurface';
                return (
                  <Box
                    key={`${mov.type}-${mov.id}`}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                      px: 1.5,
                      py: 1.25,
                      borderBottom: index < movements.length - 1 ? 1 : 0,
                      borderColor: 'outlineVariant',
                      bgcolor: rowBg,
                      borderRadius: m3Shape.small,
                    }}
                  >
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 36,
                        height: 36,
                        borderRadius: m3Shape.medium,
                        bgcolor: iconBg,
                        color: iconFg,
                        flexShrink: 0,
                      }}
                    >
                      {isPayment ? (
                        <IconPayments size={18} />
                      ) : isReturn || isCredit ? (
                        <IconUndo size={18} />
                      ) : isCharge ? (
                        <IconAddCircle size={18} />
                      ) : (
                        <IconReceiptLong size={18} />
                      )}
                    </Box>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: 'onSurface' }} noWrap>
                        {mov.description}
                      </Typography>
                      <Typography variant="caption" color="onSurfaceVariant">
                        {fmtDateFull(mov.date)}
                        {mov.method
                          ? ` · ${PAYMENT_METHOD_LABELS[mov.method] ?? PAYMENT_PREFERENCE_LABELS[mov.method] ?? mov.method}`
                          : ''}
                        {mov.reference ? ` · ${mov.reference}` : ''}
                      </Typography>
                    </Box>
                    <Typography
                      variant="titleSmall"
                      sx={{
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 800,
                        fontVariantNumeric: 'tabular-nums',
                        color: amountColor,
                        flexShrink: 0,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {mov.sign === '-' ? `-${fmtMoney(mov.amount)}` : `+${fmtMoney(mov.amount)}`}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          )}

          {orders && (
            <Box sx={{ mt: 2.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <IconReceiptLong size={18} />
                <Typography variant="titleSmall" sx={{ fontWeight: 700, color: 'onSurface' }}>
                  Órdenes abiertas
                </Typography>
                <Typography
                  variant="labelMedium"
                  color="onSurfaceVariant"
                  sx={{ ml: 'auto', fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                >
                  {totalOpenOrders}
                </Typography>
              </Box>

              {orders.length === 0 ? (
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
                    <IconCircleCheck size={20} />
                  </Box>
                  <Box>
                    <Typography variant="titleSmall" sx={{ fontWeight: 600, color: 'onSurface' }}>
                      Sin órdenes pendientes de pago
                    </Typography>
                    <Typography variant="body2" color="onSurfaceVariant">
                      Todas las órdenes de este cliente están saldadas.
                    </Typography>
                  </Box>
                </Box>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: 'surfaceContainerLow' }}>
                        <TableCell sx={{ fontWeight: 600 }}>Pedido</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Fecha</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Total</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">Saldo</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {orders.map((order: Order) => (
                        <TableRow
                          key={order._id}
                          hover={Boolean(onOrderClick)}
                          onClick={onOrderClick ? () => onOrderClick(order._id) : undefined}
                          sx={{ cursor: onOrderClick ? 'pointer' : 'default', '&:last-child td': { borderBottom: 0 } }}
                        >
                          <TableCell>
                            <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'primary.main' }}>
                              #{order.orderNumber}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" color="onSurfaceVariant">
                              {fmtDate(order.createdAt)}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                              {fmtMoney(order.totalAmount)}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography
                              variant="body2"
                              sx={{
                                fontFamily: 'var(--font-mono)',
                                fontWeight: 800,
                                fontVariantNumeric: 'tabular-nums',
                                color: order.balance > 0 ? 'error.main' : 'secondary.main',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {fmtMoney(order.balance)}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Box>
          )}
        </Box>
      )}
    </MuiCard>
  );
}
