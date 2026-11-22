import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client.ts';
import { usePurchase, useSuppliers, useProducts } from '../hooks/queries/index.ts';
import {
  useDeliverPurchase,
  useCancelPurchase,
  useDeletePurchase,
  useRecordPurchasePayment,
} from '../hooks/mutations/index.ts';
import { isOfflineQueuedError } from '../hooks/use-offline-mutation.ts';
import { useSmartBack } from '../hooks/useSmartBack.ts';
import { MuiButton, MuiCard, MuiDialog, MuiSnackbar, PageHeader, LoadingState } from '../components/ui/index.ts';
import { IconArrowBack, IconCreditCard, IconDelete, IconEdit, IconShoppingCart, IconStore, IconTruck, IconX } from '../components/ui/icons.tsx';
import { PurchaseFormDialog } from '../components/purchase/PurchaseFormDialog.tsx';
import { unitLabel } from '../lib/units.ts';
import {
  PaymentLinesEditor,
  newPaymentLine,
  toPaymentLines,
  totalOfLines,
  type PaymentLineDraft,
} from '../components/purchase/PaymentLinesEditor.tsx';
import {
  ACCOUNT_LABELS,
  METHOD_LABELS,
  PurchasePaymentChip,
  PurchaseStatusChip,
  formatCurrency,
  formatDate,
} from '../components/purchase/PurchaseStatusChips.tsx';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';

/* ── PurchaseDetailPage ──────────────────────── */

/**
 * PurchaseDetailPage — dedicated detail page for a purchase.
 *
 * Replaces the old detail modal in ComprasPage: full page with supplier card,
 * item breakdown (cajón → per-maple cost + margin), financial summary,
 * status/payment info and lifecycle actions (marcar entregada / registrar pago /
 * editar / cancelar / eliminar) gated by purchase state.
 */
export function PurchaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const goBack = useSmartBack('/compras');

  // Reads — purchase detail + reference data for the edit dialog (supplier and
  // product selects). All keep the api IndexedDB read-through offline.
  const purchaseQuery = usePurchase(id);
  const suppliersQuery = useSuppliers(true);
  const productsQuery = useProducts();
  const detail = purchaseQuery.data ?? null;
  const suppliers = suppliersQuery.data ?? [];
  const products = productsQuery.data ?? [];
  const loading = purchaseQuery.isLoading;

  // Action errors (deliver/cancel/delete) surfaced next to load errors.
  const [error, setError] = useState<string | null>(null);
  const loadError = purchaseQuery.error
    ? purchaseQuery.error instanceof Error
      ? purchaseQuery.error.message
      : 'Error al cargar el detalle'
    : null;

  // Edit dialog (pending only)
  const [showEdit, setShowEdit] = useState(false);

  // Payment dialog — dynamic lines; a single line is the degenerate case.
  const [showPayment, setShowPayment] = useState(false);
  const [paymentLines, setPaymentLines] = useState<PaymentLineDraft[]>([newPaymentLine()]);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // Snackbar
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  // Writes — offline-aware; each invalidates purchases + linked domains.
  const deliverPurchase = useDeliverPurchase();
  const cancelPurchase = useCancelPurchase();
  const deletePurchase = useDeletePurchase();
  const recordPurchasePayment = useRecordPurchasePayment();
  const paymentSubmitting = recordPurchasePayment.isPending;

  const notify = (message: string) => {
    setSnackbar({ open: true, message, severity: 'success' });
  };

  const handleDeliver = () => {
    if (!id) return;
    deliverPurchase.mutate(id, {
      onSuccess: () => notify('Compra marcada como entregada · stock actualizado'),
      onError: (err) => {
        // Offline queued write: normal outcome, the OfflineBanner confirmed it.
        if (isOfflineQueuedError(err)) return;
        setError(err instanceof Error ? err.message : 'Error al marcar la entrega');
      },
    });
  };

  const handleCancelPurchase = () => {
    if (!detail || !id) return;
    if (!window.confirm(`¿Cancelar la compra ${detail.purchaseNumber}? No afecta el stock.`)) return;
    cancelPurchase.mutate(id, {
      onSuccess: () => notify('Compra cancelada'),
      onError: (err) => {
        if (isOfflineQueuedError(err)) return;
        setError(err instanceof Error ? err.message : 'Error al cancelar la compra');
      },
    });
  };

  const handleDelete = () => {
    if (!detail || !id) return;
    if (!window.confirm(`¿Eliminar la compra ${detail.purchaseNumber} por ${formatCurrency(detail.totalCost)}?`)) return;
    deletePurchase.mutate(id, {
      onSuccess: () => {
        notify('Compra eliminada');
        navigate('/compras');
      },
      onError: (err) => {
        if (isOfflineQueuedError(err)) {
          notify('Compra eliminada (offline)');
          navigate('/compras');
          return;
        }
        if (err instanceof ApiError && err.status === 409) {
          setError('No se puede eliminar una compra entregada. Cancelá la compra o revertí el stock antes.');
        } else {
          setError(err instanceof Error ? err.message : 'Error al eliminar la compra');
        }
      },
    });
  };

  const handleEditSaved = (message: string) => {
    setShowEdit(false);
    setSnackbar({ open: true, message, severity: 'success' });
  };

  const openPaymentDialog = () => {
    setPaymentLines([newPaymentLine()]);
    setPaymentError(null);
    setShowPayment(true);
  };

  const handleRecordPayment = () => {
    if (!detail || !id) return;
    const total = totalOfLines(paymentLines);
    if (!(total > 0)) {
      setPaymentError('El monto total debe ser mayor a 0');
      return;
    }
    if (total > detail.balance + 0.005) {
      setPaymentError(`El total supera el saldo pendiente (${formatCurrency(detail.balance)})`);
      return;
    }

    setPaymentError(null);
    recordPurchasePayment.mutate(
      { id, data: { payments: toPaymentLines(paymentLines) } },
      {
        onSuccess: () => {
          setShowPayment(false);
          notify('Pago registrado correctamente');
        },
        onError: (err) => {
          if (isOfflineQueuedError(err)) {
            setShowPayment(false);
            notify('Pago registrado (offline)');
            return;
          }
          setPaymentError(err instanceof Error ? err.message : 'Error al registrar el pago');
        },
      },
    );
  };

  if (loading) {
    return <LoadingState label="Cargando compra…" />;
  }

  if ((loadError || error) && !detail) {
    return (
      <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
        <MuiButton variant="ghost" onClick={goBack} startIcon={<IconArrowBack />}>
          Volver a Compras
        </MuiButton>
        <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>
      </Box>
    );
  }

  if (!detail) return null;

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
      {/* Header — back + identity + chips + lifecycle actions */}
      <Box sx={{ mb: 6 }}>
        <MuiButton variant="ghost" onClick={goBack} startIcon={<IconArrowBack />} sx={{ mb: 3 }}>
          Volver
        </MuiButton>
        <PageHeader
          title={`Compra ${detail.purchaseNumber}`}
          subtitle={`${detail.supplierName} · ${formatDate(detail.date)}`}
          icon={<IconShoppingCart size={22} />}
          actions={
            <>
              <PurchaseStatusChip status={detail.status} />
              <PurchasePaymentChip status={detail.paymentStatus} />
              {detail.status === 'pending' && (
                <>
                  <MuiButton variant="danger" startIcon={<IconX />} onClick={handleCancelPurchase}>
                    Cancelar
                  </MuiButton>
                  <MuiButton variant="secondary" startIcon={<IconEdit />} onClick={() => setShowEdit(true)}>
                    Editar
                  </MuiButton>
                  {detail.paymentStatus !== 'paid' && (
                    <MuiButton variant="secondary" startIcon={<IconCreditCard />} onClick={openPaymentDialog}>
                      Registrar pago
                    </MuiButton>
                  )}
                  <MuiButton variant="primary" startIcon={<IconTruck />} onClick={handleDeliver}>
                    Marcar entregada
                  </MuiButton>
                </>
              )}
              {detail.status === 'delivered' && detail.paymentStatus !== 'paid' && (
                <MuiButton variant="secondary" startIcon={<IconCreditCard />} onClick={openPaymentDialog}>
                  Registrar pago
                </MuiButton>
              )}
              {detail.status !== 'delivered' && (
                <MuiButton variant="danger" startIcon={<IconDelete />} onClick={handleDelete}>
                  Eliminar
                </MuiButton>
              )}
            </>
          }
        />
      </Box>

      {(loadError || error) && (
        <Alert severity="error" sx={{ mb: 4 }}>{loadError || error}</Alert>
      )}

      {/* Supplier card — identity, date, notes, delivery state */}
      <MuiCard variant="elevated" sx={{ mb: 4 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: '10px', bgcolor: 'secondaryContainer', color: 'onSecondaryContainer' }}>
              <IconStore size={18} />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
              Proveedor
            </Typography>
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {detail.supplierName}
          </Typography>
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mt: 1.5 }}>
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Fecha
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {formatDate(detail.date)}
              </Typography>
            </Box>
            {detail.status === 'delivered' && detail.deliveredAt && (
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  Entregada el
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, color: 'success.main' }}>
                  {formatDate(detail.deliveredAt)}
                </Typography>
              </Box>
            )}
            {detail.status === 'pending' && (
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  Estado
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  Pendiente de entrega — el stock se suma al marcarla entregada
                </Typography>
              </Box>
            )}
          </Box>
          {detail.notes && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              {detail.notes}
            </Typography>
          )}
        </Box>
      </MuiCard>

      {/* Items table */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, display: 'block', mb: 1.5 }}>
          Ítems
        </Typography>
        <MuiCard variant="elevated" sx={{ p: 0, overflow: 'hidden', '& .MuiCardContent-root': { p: 0, '&:last-child': { pb: 0 } } }}>
          {/* Header (desktop) */}
          <Box
            sx={{
              display: { xs: 'none', sm: 'grid' },
              gridTemplateColumns: '2fr 1.4fr 1.2fr 1fr 0.9fr',
              gap: 1.5,
              px: 3,
              py: 1.5,
              bgcolor: 'action.hover',
              borderBottom: 1,
              borderColor: 'divider',
            }}
          >
            {['Producto', 'Unidad · cantidad', 'Costo unitario', 'Subtotal', 'Margen/maple'].map((h) => (
              <Typography key={h} variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                {h}
              </Typography>
            ))}
          </Box>
          {detail.items.map((item, i) => {
            const unit = item.unit ?? 'maple';
            const qty = item.quantity ?? item.quantityMaples;
            const perMaple = item.unitCostPerMaple ?? item.unitCost;
            return (
              <Box
                key={`${item.productId}-${i}`}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr 1fr', sm: '2fr 1.4fr 1.2fr 1fr 0.9fr' },
                  gap: 1.5,
                  alignItems: 'start',
                  px: 3,
                  py: 1.5,
                  borderBottom: 1,
                  borderColor: 'divider',
                  '&:last-child': { borderBottom: 'none' },
                }}
              >
                <Box sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {item.productName}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {unit !== 'maple'
                      ? `${qty} ${unitLabel(unit, { plural: qty !== 1 })} · = ${item.quantityMaples} maples`
                      : `${item.quantityMaples} maples`}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'block', sm: 'none' } }}>
                    Costo
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                    {formatCurrency(item.unitCost)}/{unitLabel(unit)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    = {formatCurrency(perMaple)}/maple
                  </Typography>
                </Box>
                <Box sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'block', sm: 'none' } }}>
                    Subtotal
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {formatCurrency(item.subtotal)}
                  </Typography>
                </Box>
                <Box sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'block', sm: 'none' } }}>
                    Margen/maple
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: 'var(--font-mono)',
                      fontVariantNumeric: 'tabular-nums',
                      color: item.margin === null ? 'text.secondary' : item.margin >= 0 ? 'success.main' : 'error.main',
                    }}
                  >
                    {item.margin === null ? '—' : formatCurrency(item.margin)}
                  </Typography>
                </Box>
              </Box>
            );
          })}
        </MuiCard>
      </Box>

      {/* Financials — total / paid / balance / method */}
      <MuiCard variant="elevated" sx={{ mb: 4 }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' },
            gap: 2,
          }}
        >
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Total
            </Typography>
            <Typography variant="body1" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {formatCurrency(detail.totalCost)}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Pagado
            </Typography>
            <Typography variant="body1" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {formatCurrency(detail.paidAmount)}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Saldo
            </Typography>
            <Typography
              variant="body1"
              sx={{
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color: detail.balance > 0 ? 'warning.main' : 'success.main',
              }}
            >
              {formatCurrency(detail.balance)}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Método
            </Typography>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>
              {detail.paymentMethod ? METHOD_LABELS[detail.paymentMethod] : '—'}
            </Typography>
          </Box>
        </Box>
      </MuiCard>

      {/* Status / payment info */}
      <MuiCard variant="elevated" sx={{ mb: 4 }}>
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, display: 'block', mb: 1.5 }}>
            Estado y pago
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="body2" color="text.secondary">Estado de pago</Typography>
              <PurchasePaymentChip status={detail.paymentStatus} />
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="body2" color="text.secondary">Método de pago</Typography>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {detail.paymentMethod ? METHOD_LABELS[detail.paymentMethod] : '—'}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="body2" color="text.secondary">Entrega</Typography>
              <Typography variant="body2" sx={{ fontWeight: 600, color: detail.status === 'delivered' ? 'success.main' : 'text.primary' }}>
                {detail.status === 'delivered'
                  ? detail.deliveredAt ? formatDate(detail.deliveredAt) : 'Entregada'
                  : detail.status === 'cancelled' ? 'Cancelada' : 'Pendiente'}
              </Typography>
            </Box>
          </Box>
        </Box>
      </MuiCard>

      {/* Payment history — one row per line, grouped by the shared groupId */}
      {detail.payments && detail.payments.length > 0 && (
        <MuiCard variant="elevated" sx={{ mb: 4 }}>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, display: 'block', mb: 1.5 }}>
              Historial de pagos
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {detail.payments.map((payment, i) => (
                <Box
                  key={`${payment.groupId}-${i}`}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.1fr) minmax(0, 1.1fr) auto',
                    gap: 1.5,
                    alignItems: 'center',
                    py: 0.75,
                    borderBottom: 1,
                    borderColor: 'divider',
                    '&:last-of-type': { borderBottom: 'none' },
                  }}
                >
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {formatDate(payment.date)}
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                    {METHOD_LABELS[payment.method]}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {ACCOUNT_LABELS[payment.account]}
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {formatCurrency(payment.amount)}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        </MuiCard>
      )}

      {/* Edit dialog (pending only) — shared form */}
      <PurchaseFormDialog
        open={showEdit}
        mode="edit"
        editId={id ?? null}
        editDetail={detail}
        suppliers={suppliers}
        products={products}
        onClose={() => setShowEdit(false)}
        onSaved={handleEditSaved}
      />

      {/* Payment dialog */}
      <MuiDialog
        open={showPayment}
        onClose={() => setShowPayment(false)}
        title="Registrar pago"
        maxWidth="xs"
        actions={
          <>
            <MuiButton variant="ghost" onClick={() => setShowPayment(false)} disabled={paymentSubmitting}>
              Cancelar
            </MuiButton>
            <MuiButton variant="primary" isLoading={paymentSubmitting} disabled={paymentSubmitting} onClick={handleRecordPayment}>
              {paymentSubmitting ? 'Guardando...' : 'Registrar pago'}
            </MuiButton>
          </>
        }
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 1 }}>
          {paymentError && <Alert severity="error">{paymentError}</Alert>}
          <PaymentLinesEditor
            lines={paymentLines}
            onChange={setPaymentLines}
            cap={detail.balance}
            capLabel="Saldo pendiente"
          />
        </Box>
      </MuiDialog>

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