import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { productsApi } from '../api/products.ts';
import { ApiError } from '../api/client.ts';
import { usePurchases, useSuppliers, useProducts } from '../hooks/queries/index.ts';
import { useDeletePurchase } from '../hooks/mutations/index.ts';
import { isOfflineQueuedError } from '../hooks/use-offline-mutation.ts';
import { queryKeys } from '../hooks/query-keys.ts';
import type { Purchase } from '../types/index.ts';
import { unitLabel } from '../lib/units.ts';
import {
  MuiButton,
  MuiCard,
  MuiChip,
  MuiSnackbar,
  MuiTextField,
  PageHeader,
  EmptyState,
  LoadingState,
} from '../components/ui/index.ts';
import {
  IconShoppingCart,
  IconPlus,
  IconDelete,
  IconStore,
  IconTrendingUp,
  IconWallet,
} from '../components/ui/icons.tsx';
import { PurchaseFormDialog } from '../components/purchase/PurchaseFormDialog.tsx';
import {
  PurchasePaymentChip,
  PurchaseStatusChip,
  formatCurrency,
  formatDate,
} from '../components/purchase/PurchaseStatusChips.tsx';
import { SuppliersPage } from './SuppliersPage.tsx';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Alert from '@mui/material/Alert';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';

/* ── Constants / helpers ───────────────────── */

/** Reads the supplier display name from a purchase (populated or raw id). */
const supplierNameOf = (purchase: Purchase): string =>
  typeof purchase.supplierId === 'object' ? purchase.supplierId.name : 'Proveedor';

/** balance = totalCost − paidAmount (detail returns it; list items compute it). */
const balanceOf = (p: { totalCost: number; paidAmount: number; balance?: number }): number =>
  p.balance ?? p.totalCost - p.paidAmount;

/**
 * Human-readable quantity summary for a purchase item, unit-aware and showing
 * the derived per-maple cost when bought by cajón:
 * "12 cajones · = 144 maples · $2.400/cajón ($200/maple)". Legacy items (no
 * unit) default to maples.
 */
const itemQtyLabel = (item: Purchase['items'][number]): string => {
  const unit = item.unit ?? 'maple';
  if (unit !== 'maple') {
    const qty = item.quantity ?? item.quantityMaples;
    const perMaple = item.unitCostPerMaple ?? item.unitCost;
    const unitName = unitLabel(unit, { plural: qty !== 1 });
    return `${qty} ${unitName} · = ${item.quantityMaples} maples · ${formatCurrency(item.unitCost)}/${unitLabel(unit)} (${formatCurrency(perMaple)}/maple)`;
  }
  return `${item.quantityMaples} maples`;
};

/* ── ComprasPage ───────────────────────────── */

/**
 * ComprasPage — purchases + suppliers (tab).
 *
 * Purchases tab: summary card (total comprado + margen promedio), filterable
 * purchase list with lifecycle + payment status chips. Clicking a row opens
 * the dedicated detail page (/compras/:id) with the lifecycle actions
 * (marcar entregada / registrar pago / editar / cancelar / eliminar). Create
 * dialog supports "¿Ya entregada?" + optional payment info and navigates to
 * the new purchase's detail page after saving.
 *
 * Proveedores tab: embeds SuppliersPage (create/edit/deactivate).
 */
export function ComprasPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState(0);

  // Filters
  const [supplierFilter, setSupplierFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Create dialog (shared form)
  const [showCreate, setShowCreate] = useState(false);

  // Reads — the filter object keys the purchases query; suppliers/products feed
  // the create dialog, the supplier filter and the margin summary.
  const filters = {
    supplierId: supplierFilter || undefined,
    from: fromDate ? `${fromDate}T00:00:00.000` : undefined,
    to: toDate ? `${toDate}T23:59:59.999` : undefined,
  };
  const purchasesQuery = usePurchases(filters);
  const suppliersQuery = useSuppliers(true);
  const productsQuery = useProducts();
  const purchases = purchasesQuery.data ?? [];
  const suppliers = suppliersQuery.data ?? [];
  const products = productsQuery.data ?? [];
  const loading = purchasesQuery.isLoading;

  const readError = purchasesQuery.error
    ? purchasesQuery.error instanceof Error
      ? purchasesQuery.error.message
      : 'Error al cargar compras'
    : null;

  // Active price per purchased product (404 → skipped), for the margin summary.
  const productIds = useMemo(
    () => Array.from(new Set(purchases.flatMap((p) => p.items.map((item) => item.productId)))),
    [purchases],
  );
  const activePriceQueries = useQueries({
    queries: productIds.map((id) => ({
      queryKey: queryKeys.products.activePrice(id),
      queryFn: () => productsApi.getActivePrice(id).catch(() => undefined),
    })),
  });
  const activePrices: Record<string, number> = {};
  productIds.forEach((id, index) => {
    const entry = activePriceQueries[index]?.data;
    if (entry) activePrices[id] = entry.price;
  });

  // Write — offline-aware delete invalidates the purchases domain.
  const deletePurchase = useDeletePurchase();

  // Mutation (write) error — kept separate from the read error alert.
  const [actionError, setActionError] = useState<string | null>(null);

  // Snackbar
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  // ── Summary card ───────────────────────────────────────────────

  const totalComprado = purchases.reduce((sum, p) => sum + p.totalCost, 0);

  // Margen promedio: weighted average of (activePrice − unitCostPerMaple) per
  // maple, only over items that have an active price. null when nothing is
  // computable. Legacy items (no unitCostPerMaple) fall back to unitCost.
  const marginSummary = (() => {
    let totalMargin = 0;
    let totalQuantity = 0;
    for (const purchase of purchases) {
      for (const item of purchase.items) {
        const activePrice = activePrices[item.productId];
        if (activePrice === undefined) continue; // no active price → skip
        const costPerMaple = item.unitCostPerMaple ?? item.unitCost;
        totalMargin += (activePrice - costPerMaple) * item.quantityMaples;
        totalQuantity += item.quantityMaples;
      }
    }
    if (totalQuantity === 0) return null;
    return totalMargin / totalQuantity;
  })();

  // ── Create dialog ─────────────────────────────────────────────

  const handleCreateSaved = (message: string, saved: Purchase | null) => {
    setShowCreate(false);
    setSnackbar({ open: true, message, severity: 'success' });
    if (saved) {
      navigate(`/compras/${saved._id}`);
    }
  };

  // ── Delete (list row) ──────────────────────────────────────────

  const handleDeleteFromList = (purchase: Purchase) => {
    const total = formatCurrency(purchase.totalCost);
    if (!window.confirm(`¿Eliminar la compra ${purchase.purchaseNumber} por ${total}?`)) return;

    deletePurchase.mutate(purchase._id, {
      onSuccess: () => setSnackbar({ open: true, message: 'Compra eliminada', severity: 'success' }),
      onError: (err) => {
        // Offline queued write: normal outcome, the OfflineBanner already confirmed it.
        if (isOfflineQueuedError(err)) {
          setSnackbar({ open: true, message: 'Compra eliminada sin conexión', severity: 'success' });
          return;
        }
        if (err instanceof ApiError && err.status === 409) {
          setActionError('No se puede eliminar una compra entregada. Cancelá la compra o revertí el stock antes.');
        } else {
          setActionError(err instanceof Error ? err.message : 'Error al eliminar la compra');
        }
      },
    });
  };

  if (loading) {
    return <LoadingState label="Cargando compras…" />;
  }

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
      {/* Header — single PageHeader pattern */}
      <PageHeader
        title="Compras"
        subtitle="Registro de compras a proveedores"
        icon={<IconShoppingCart size={22} />}
        actions={
          tab === 0 ? (
            <MuiButton variant="primary" onClick={() => setShowCreate(true)} startIcon={<IconPlus />}>
              Nueva Compra
            </MuiButton>
          ) : undefined
        }
      />

      {/* Tabs — Compras / Proveedores */}
      <Tabs
        value={tab}
        onChange={(_e, value) => setTab(value)}
        sx={{ mb: 4, '& .MuiTab-root': { minHeight: 48, fontWeight: 600 } }}
      >
        <Tab label="Compras" icon={<IconShoppingCart size={18} />} iconPosition="start" />
        <Tab label="Proveedores" icon={<IconStore size={18} />} iconPosition="start" />
      </Tabs>

      {tab === 0 && (
        <>
          {/* Summary card — total comprado + margen promedio */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, mb: 3 }}>
            <MuiCard variant="elevated" sx={{ p: 3, '& .MuiCardContent-root': { p: 3, '&:last-child': { pb: 3 } } }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 36,
                    height: 36,
                    borderRadius: '12px',
                    bgcolor: 'primaryContainer',
                    color: 'onPrimaryContainer',
                  }}
                >
                  <IconWallet size={18} />
                </Box>
                <Typography variant="overline" color="onSurfaceVariant" sx={{ fontWeight: 500 }}>
                  Total comprado
                </Typography>
              </Box>
              <Typography variant="h5" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'onSurface' }}>
                {formatCurrency(totalComprado)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {purchases.length} compra{purchases.length === 1 ? '' : 's'}
              </Typography>
            </MuiCard>

            <MuiCard variant="elevated" sx={{ p: 3, '& .MuiCardContent-root': { p: 3, '&:last-child': { pb: 3 } } }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 36,
                    height: 36,
                    borderRadius: '12px',
                    bgcolor: 'secondaryContainer',
                    color: 'onSecondaryContainer',
                  }}
                >
                  <IconTrendingUp size={18} />
                </Box>
                <Typography variant="overline" color="onSurfaceVariant" sx={{ fontWeight: 500 }}>
                  Margen promedio
                </Typography>
              </Box>
              <Typography variant="h5" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'onSurface' }}>
                {marginSummary === null ? '—' : formatCurrency(marginSummary)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                por maple, vs. precio activo actual
              </Typography>
            </MuiCard>
          </Box>

          {/* Filters */}
          <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'center', flexWrap: 'wrap', flexDirection: { xs: 'column', sm: 'row' } }}>
            <MuiTextField
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(e.target.value)}
              select
              sx={{ minWidth: 200 }}
              slotProps={{ select: { displayEmpty: true } }}
            >
              <MenuItem value="">Todos los proveedores</MenuItem>
              {suppliers.map((s) => (
                <MenuItem key={s._id} value={s._id}>
                  {s.name}
                </MenuItem>
              ))}
            </MuiTextField>
            <MuiTextField
              type="date"
              label="Desde"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              sx={{ maxWidth: 180 }}
            />
            <MuiTextField
              type="date"
              label="Hasta"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              sx={{ maxWidth: 180 }}
            />
          </Box>

          {(readError || actionError) && (
            <Alert severity="error" sx={{ mb: 3 }}>{readError ?? actionError}</Alert>
          )}

          {/* Purchase list */}
          {purchases.length === 0 ? (
            <EmptyState
              title="No se encontraron compras"
              subtitle="Registrá tu primera compra a un proveedor para actualizar stock y costos."
              action={
                <MuiButton variant="primary" startIcon={<IconPlus />} onClick={() => setShowCreate(true)}>
                  Registrar compra
                </MuiButton>
              }
            />
          ) : (
            <MuiCard variant="elevated" sx={{ p: 0, overflow: 'hidden', '& .MuiCardContent-root': { p: 0, '&:last-child': { pb: 0 } } }}>
              {purchases.map((purchase) => (
                <Box
                  key={purchase._id}
                  onClick={() => navigate(`/compras/${purchase._id}`)}
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: { xs: 'flex-start', sm: 'center' },
                    px: 3,
                    py: 2,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    '&:last-child': { borderBottom: 'none' },
                    flexDirection: { xs: 'column', sm: 'row' },
                    gap: 2,
                    cursor: 'pointer',
                    transition: 'background-color 0.15s ease',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
                      <Typography variant="body1" sx={{ fontWeight: 600 }}>
                        {supplierNameOf(purchase)}
                      </Typography>
                      <MuiChip label={purchase.purchaseNumber} color="primary" size="small" variant="outlined" />
                      <PurchaseStatusChip status={purchase.status} />
                      <PurchasePaymentChip status={purchase.paymentStatus} />
                    </Box>
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography variant="body2" color="text.secondary">
                        {formatDate(purchase.date)}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {purchase.items.map(itemQtyLabel).join(', ')}
                      </Typography>
                      {purchase.notes && (
                        <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 220 }}>
                          {purchase.notes}
                        </Typography>
                      )}
                    </Box>
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0 }}>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography variant="body1" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {formatCurrency(purchase.totalCost)}
                      </Typography>
                      {purchase.paymentStatus !== 'paid' && (
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                          saldo {formatCurrency(balanceOf(purchase))}
                        </Typography>
                      )}
                    </Box>
                    {purchase.status !== 'delivered' && (
                      <IconButton
                        color="error"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFromList(purchase);
                        }}
                        aria-label="Eliminar compra"
                      >
                        <IconDelete size={18} />
                      </IconButton>
                    )}
                  </Box>
                </Box>
              ))}
            </MuiCard>
          )}

          {/* Create dialog (shared form) */}
          <PurchaseFormDialog
            open={showCreate}
            mode="create"
            editId={null}
            editDetail={null}
            suppliers={suppliers}
            products={products}
            onClose={() => setShowCreate(false)}
            onSaved={handleCreateSaved}
          />
        </>
      )}

      {tab === 1 && <SuppliersPage />}

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