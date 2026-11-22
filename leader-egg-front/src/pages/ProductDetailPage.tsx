import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { AdjustStockPayload, CreateInventoryPayload } from '../api/inventory.ts';
import type { CreatePricePayload } from '../api/products.ts';
import { useProduct, useInventoryByProduct, useActivePrice, useProductPrices, useInventoryTransactions } from '../hooks/queries/index.ts';
import {
  useUpdateProduct,
  useCreatePrice,
  useAdjustStock,
  useIncrementStock,
  useDecrementStock,
  useCreateInventory,
  useDeleteInventory,
} from '../hooks/mutations/index.ts';
import { isOfflineQueuedError } from '../hooks/use-offline-mutation.ts';
import { useSmartBack } from '../hooks/useSmartBack.ts';
import {
  MuiButton,
  MuiTextField,
  MuiCard,
  MuiDialog,
  MuiSnackbar,
  MuiChip,
  MuiTable,
  PageHeader,
  LoadingState,
  EmptyState,
} from '../components/ui/index.ts';
import {
  IconPlus,
  IconMinus,
  IconEdit,
  IconDelete,
  IconHistory,
  IconMoney,
  IconChart,
  IconSync,
  IconBox,
  IconArrowBack,
} from '../components/ui/icons.tsx';
import {
  getStockStatus,
  STATUS_META,
  StockStatusChip,
  NoInventoryChip,
  txColumns,
  formatPrice,
} from '../components/stock/StockStatusChips.tsx';
import { m3Shape } from '../theme/index.ts';
import { CALIBER_LABELS, VARIETY_LABELS } from '../types/index.ts';
import type { PriceUnit } from '../types/index.ts';
import { computeMargin, formatMarginPct } from '../lib/margin.ts';
import { PRODUCT_UNIT_OPTIONS, unitLabel } from '../lib/units.ts';
import { CostInfoButton } from '../components/stock/CostInfoDialog.tsx';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import MuiAlert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import InputLabel from '@mui/material/InputLabel';
import FormControl from '@mui/material/FormControl';

/* ── Section heading helper (matches detail-page pattern) ── */

function SectionHeading({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 32,
          borderRadius: '10px',
          bgcolor: 'secondaryContainer',
          color: 'onSecondaryContainer',
        }}
      >
        {icon}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
        {label}
      </Typography>
    </Box>
  );
}

/* ── ProductDetailPage ───────────────────────── */

/**
 * ProductDetailPage — dedicated management page for a single product's stock.
 *
 * Replaces the per-card action buttons + modals that used to live in
 * StockPage: stock hero, cajón edit, prices, entry/exit/adjust dialogs,
 * transaction history and the danger zone (create / delete inventory).
 */
export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const goBack = useSmartBack('/products');

  // Reads — product + inventory + prices + transactions. Inventory may 404
  // (no record yet → null); each price/txn read falls back to empty.
  const productQuery = useProduct(id);
  const inventoryQuery = useInventoryByProduct(id);
  const maplePriceQuery = useActivePrice(id, 'maple');
  const medioCajonPriceQuery = useActivePrice(id, 'medio_cajon');
  const cajonPriceQuery = useActivePrice(id, 'cajon');
  const priceHistoryQuery = useProductPrices(id);
  const transactionsQuery = useInventoryTransactions(id);

  const product = productQuery.data ?? null;
  const inventory = inventoryQuery.data ?? null;
  const activePrice = maplePriceQuery.data;
  const medioCajonPrice = medioCajonPriceQuery.data;
  const cajonPrice = cajonPriceQuery.data;
  const priceHistory = priceHistoryQuery.data ?? [];
  const transactions = transactionsQuery.data ?? [];

  const loading =
    productQuery.isLoading ||
    inventoryQuery.isLoading ||
    maplePriceQuery.isLoading ||
    medioCajonPriceQuery.isLoading ||
    cajonPriceQuery.isLoading ||
    priceHistoryQuery.isLoading ||
    transactionsQuery.isLoading;

  const queryError = productQuery.error;
  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : 'Error al cargar el producto'
    : null;

  // Writes — offline-aware; every mutation invalidates inventory/products/
  // dashboard so the reads above refetch automatically.
  const updateProduct = useUpdateProduct();
  const createPrice = useCreatePrice();
  const adjustStock = useAdjustStock();
  const incrementStock = useIncrementStock();
  const decrementStock = useDecrementStock();
  const createInventory = useCreateInventory();
  const deleteInventory = useDeleteInventory();
  const priceSubmitting = createPrice.isPending;
  const cajonSubmitting = updateProduct.isPending;
  const adjustSubmitting = adjustStock.isPending;
  const stockSubmitting = incrementStock.isPending || decrementStock.isPending;
  const createSubmitting = createInventory.isPending;
  const deleteSubmitting = deleteInventory.isPending;

  // Price form state
  const [priceOpen, setPriceOpen] = useState(false);
  const [newPrice, setNewPrice] = useState('');
  const [priceUnit, setPriceUnit] = useState<PriceUnit>('maple');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [priceFormError, setPriceFormError] = useState<string | null>(null);

  // Adjustment dialog state
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustQuantity, setAdjustQuantity] = useState('');
  const [adjustNotes, setAdjustNotes] = useState('');
  const [adjustError, setAdjustError] = useState<string | null>(null);

  // Entry / Exit dialog state
  const [stockMode, setStockMode] = useState<'entry' | 'exit'>('entry');
  const [stockOpen, setStockOpen] = useState(false);
  const [stockQty, setStockQty] = useState('');
  const [stockNotes, setStockNotes] = useState('');
  const [stockError, setStockError] = useState<string | null>(null);

  // Cajón edit dialog state
  const [cajonOpen, setCajonOpen] = useState(false);
  const [cajonValue, setCajonValue] = useState('');
  const [cajonError, setCajonError] = useState<string | null>(null);

  // Cost / low-stock-threshold edit dialog state
  const [costOpen, setCostOpen] = useState(false);
  const [costValue, setCostValue] = useState('');
  const [thresholdValue, setThresholdValue] = useState('');
  const [costError, setCostError] = useState<string | null>(null);

  // Create inventory dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [createQty, setCreateQty] = useState('');
  const [createThreshold, setCreateThreshold] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  // Delete confirm state
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Snackbar
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  const refreshAll = () => {
    void productQuery.refetch();
    void inventoryQuery.refetch();
    void maplePriceQuery.refetch();
    void medioCajonPriceQuery.refetch();
    void cajonPriceQuery.refetch();
    void priceHistoryQuery.refetch();
    void transactionsQuery.refetch();
  };

  const hasInventory = inventory !== null;
  const stock = inventory?.quantity ?? 0;
  const threshold = product?.lowStockThreshold ?? inventory?.lowStockThreshold ?? 20;
  const status = hasInventory ? getStockStatus(stock, threshold) : null;
  const meta = status ? STATUS_META[status] : null;
  const maplesPerCajon = product?.maplesPerCajon ?? 12;

  /* ── Price management ─────────────────────── */

  const openPriceDialog = () => {
    setNewPrice('');
    setPriceUnit('maple');
    setEffectiveFrom('');
    setEffectiveTo('');
    setPriceFormError(null);
    setPriceOpen(true);
  };
const handleSetPrice = (e: FormEvent) => {
    e.preventDefault();
    setPriceFormError(null);

    if (!product || !newPrice || !effectiveFrom) {
      setPriceFormError('El precio y la fecha son obligatorios');
      return;
    }

    if (Number(newPrice) <= 0) {
      setPriceFormError('El precio debe ser mayor a 0');
      return;
    }

    const payload: CreatePricePayload = {
      price: Number(newPrice),
      unit: priceUnit,
      effectiveFrom: new Date(effectiveFrom).toISOString(),
      effectiveTo: effectiveTo ? new Date(effectiveTo).toISOString() : undefined,
    };

    createPrice.mutate(
      { productId: product._id, data: payload },
      {
        onSuccess: () => {
          setPriceOpen(false);
          setSnackbar({ open: true, message: 'Precio actualizado', severity: 'success' });
        },
        onError: (err) => {
          // Offline queued write: normal outcome, the OfflineBanner confirmed it.
          if (isOfflineQueuedError(err)) {
            setPriceOpen(false);
            setSnackbar({ open: true, message: 'Precio actualizado (offline)', severity: 'success' });
            return;
          }
          setPriceFormError(err instanceof Error ? err.message : 'Error al establecer precio');
        },
      },
    );
  };

  /* ── Cajón edit ───────────────────────────── */

  const openCajonDialog = () => {
    setCajonValue(String(maplesPerCajon));
    setCajonError(null);
    setCajonOpen(true);
  };

  const handleCajonSave = (e: FormEvent) => {
    e.preventDefault();
    setCajonError(null);

    if (!product) return;

    const value = Number(cajonValue);
    if (isNaN(value) || !Number.isInteger(value) || value < 1) {
      setCajonError('El cajón debe contener al menos 1 maple (número entero)');
      return;
    }

    updateProduct.mutate(
      { id: product._id, data: { maplesPerCajon: value } },
      {
        onSuccess: () => {
          setCajonOpen(false);
          setSnackbar({ open: true, message: 'Cajón actualizado', severity: 'success' });
        },
        onError: (err) => {
          if (isOfflineQueuedError(err)) {
            setCajonOpen(false);
            setSnackbar({ open: true, message: 'Cajón actualizado (offline)', severity: 'success' });
            return;
          }
          setCajonError(err instanceof Error ? err.message : 'Error al actualizar el cajón');
        },
      },
    );
  };

  /* ── Cost / low-stock-threshold edit ──────── */

  const openCostDialog = () => {
    setCostValue(product?.costPrice != null ? String(product.costPrice) : '');
    setThresholdValue(product ? String(threshold) : '');
    setCostError(null);
    setCostOpen(true);
  };

  const handleCostSave = (e: FormEvent) => {
    e.preventDefault();
    setCostError(null);
    if (!product) return;

    const cost = costValue === '' ? null : Number(costValue);
    if (cost !== null && (isNaN(cost) || cost < 0)) {
      setCostError('El costo debe ser un número no negativo');
      return;
    }
    const thr = thresholdValue === '' ? undefined : Number(thresholdValue);
    if (thr !== undefined && (isNaN(thr) || thr < 0)) {
      setCostError('El umbral debe ser un número no negativo');
      return;
    }

    updateProduct.mutate(
      {
        id: product._id,
        data: { costPrice: cost, ...(thr !== undefined ? { lowStockThreshold: thr } : {}) },
      },
      {
        onSuccess: () => {
          setCostOpen(false);
          setSnackbar({ open: true, message: 'Producto actualizado', severity: 'success' });
        },
        onError: (err) => {
          if (isOfflineQueuedError(err)) {
            setCostOpen(false);
            setSnackbar({ open: true, message: 'Producto actualizado (offline)', severity: 'success' });
            return;
          }
          setCostError(err instanceof Error ? err.message : 'Error al actualizar el producto');
        },
      },
    );
  };

  /* ── Stock adjustment (absolute quantity) ─── */

  const openAdjustDialog = () => {
    setAdjustQuantity(String(stock));
    setAdjustNotes('');
    setAdjustError(null);
    setAdjustOpen(true);
  };

  const handleAdjust = (e: FormEvent) => {
    e.preventDefault();
    setAdjustError(null);

    if (!product) return;

    const qty = Number(adjustQuantity);
    if (isNaN(qty) || qty < 0) {
      setAdjustError('La cantidad debe ser un número positivo');
      return;
    }

    const payload: AdjustStockPayload = {
      quantity: qty,
      notes: adjustNotes || 'Ajuste manual desde ProductDetailPage',
    };
    adjustStock.mutate(
      { productId: product._id, data: payload },
      {
        onSuccess: () => {
          setAdjustOpen(false);
          setSnackbar({ open: true, message: 'Stock ajustado', severity: 'success' });
        },
        onError: (err) => {
          if (isOfflineQueuedError(err)) {
            setAdjustOpen(false);
            setSnackbar({ open: true, message: 'Stock ajustado (offline)', severity: 'success' });
            return;
          }
          const msg = err instanceof Error ? err.message : 'Error al ajustar stock';
          setAdjustError(msg.includes('404') ? 'Producto no encontrado en inventario' : msg);
        },
      },
    );
  };

  /* ── Entry / Exit (increment / decrement) ─── */

  const openStockDialog = (mode: 'entry' | 'exit') => {
    setStockMode(mode);
    setStockQty('');
    setStockNotes('');
    setStockError(null);
    setStockOpen(true);
  };

  const handleStockSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!product) return;
    setStockError(null);

    const qty = Number(stockQty);
    if (isNaN(qty) || qty <= 0) {
      setStockError('La cantidad debe ser mayor a 0');
      return;
    }

    if (stockMode === 'exit' && qty > stock) {
      setStockError(`No hay stock suficiente. Actual: ${stock} maples`);
      return;
    }

    const payload: AdjustStockPayload = { quantity: qty, notes: stockNotes || undefined };
    const mutation = stockMode === 'entry' ? incrementStock : decrementStock;
    mutation.mutate(
      { productId: product._id, data: payload },
      {
        onSuccess: () => {
          setSnackbar({
            open: true,
            message: stockMode === 'entry' ? 'Entrada registrada' : 'Salida registrada',
            severity: 'success',
          });
          setStockOpen(false);
        },
        onError: (err) => {
          if (isOfflineQueuedError(err)) {
            setSnackbar({
              open: true,
              message: stockMode === 'entry' ? 'Entrada registrada (offline)' : 'Salida registrada (offline)',
              severity: 'success',
            });
            setStockOpen(false);
            return;
          }
          setStockError(err instanceof Error ? err.message : 'Error al registrar movimiento');
        },
      },
    );
  };

  /* ── Create inventory ─────────────────────── */

  const openCreateDialog = () => {
    setCreateQty('');
    setCreateThreshold('');
    setCreateError(null);
    setCreateOpen(true);
  };

  const handleCreate = (e: FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    if (!product) return;

    const qty = createQty === '' ? 0 : Number(createQty);
    if (isNaN(qty) || qty < 0) {
      setCreateError('La cantidad inicial debe ser un número no negativo');
      return;
    }
    const threshold = createThreshold === '' ? undefined : Number(createThreshold);
    if (threshold !== undefined && (isNaN(threshold) || threshold <= 0)) {
      setCreateError('El umbral debe ser mayor a 0');
      return;
    }

    const payload: CreateInventoryPayload = { productId: product._id, quantity: qty };
    if (threshold !== undefined) payload.lowStockThreshold = threshold;
    createInventory.mutate(payload, {
      onSuccess: () => {
        setSnackbar({ open: true, message: 'Inventario creado', severity: 'success' });
        setCreateOpen(false);
      },
      onError: (err) => {
        if (isOfflineQueuedError(err)) {
          setSnackbar({ open: true, message: 'Inventario creado (offline)', severity: 'success' });
          setCreateOpen(false);
          return;
        }
        setCreateError(err instanceof Error ? err.message : 'Error al crear inventario');
      },
    });
  };

  /* ── Delete inventory ─────────────────────── */

  const handleDelete = () => {
    if (!product) return;
    deleteInventory.mutate(product._id, {
      onSuccess: () => {
        setSnackbar({ open: true, message: 'Inventario eliminado', severity: 'success' });
        setDeleteOpen(false);
        navigate('/products');
      },
      onError: (err) => {
        if (isOfflineQueuedError(err)) {
          setSnackbar({ open: true, message: 'Inventario eliminado (offline)', severity: 'success' });
          setDeleteOpen(false);
          navigate('/products');
          return;
        }
        setSnackbar({
          open: true,
          message: err instanceof Error ? err.message : 'Error al eliminar inventario',
          severity: 'error',
        });
        setDeleteOpen(false);
      },
    });
  };

  /* ── Render ────────────────────────────────── */

  if (loading) {
    return <LoadingState label="Cargando producto…" />;
  }

  if (error && !product) {
    return (
      <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
        <MuiButton variant="ghost" onClick={goBack} startIcon={<IconArrowBack />}>
          Volver a Stock
        </MuiButton>
        <MuiAlert severity="error" sx={{ mt: 2 }}>{error}</MuiAlert>
      </Box>
    );
  }

  if (!product) return null;

  const stockValue = product.costPrice != null ? stock * product.costPrice : null;

  // Units with an active price — the Ganancia card renders one row per unit.
  const marginUnits: { unit: PriceUnit; label: string; price: number }[] = [];
  if (activePrice) marginUnits.push({ unit: 'maple', label: unitLabel('maple'), price: activePrice.price });
  if (medioCajonPrice) marginUnits.push({ unit: 'medio_cajon', label: unitLabel('medio_cajon'), price: medioCajonPrice.price });
  if (cajonPrice) marginUnits.push({ unit: 'cajon', label: unitLabel('cajon'), price: cajonPrice.price });

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
      {/* Header — back + identity + status chips */}
      <Box sx={{ mb: 6 }}>
        <MuiButton variant="ghost" onClick={goBack} startIcon={<IconArrowBack />} sx={{ mb: 3 }}>
          Volver a Stock
        </MuiButton>
        <PageHeader
          title={product.displayName}
          subtitle={`${maplesPerCajon} maples por cajón · ${product.eggsPerMaple} huevos por maple`}
          icon={<IconBox size={22} />}
          actions={
            <>
              {status ? <StockStatusChip status={status} /> : <NoInventoryChip />}
              <MuiButton
                variant="secondary"
                size="sm"
                startIcon={<IconSync />}
                onClick={() => refreshAll()}
              >
                Actualizar
              </MuiButton>
            </>
          }
        />
        <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap' }}>
          <MuiChip label={`Variedad: ${VARIETY_LABELS[product.variety]}`} size="small" />
          <MuiChip label={`Calibre: ${CALIBER_LABELS[product.caliber]}`} size="small" />
          {product.caliber === 'surtido' && (
            <MuiChip label="Sin clasificar" size="small" color="warning" />
          )}
        </Box>
      </Box>

      {error && (
        <MuiAlert severity="error" sx={{ mb: 3 }} action={
          <MuiButton variant="ghost" size="sm" onClick={() => refreshAll()}>
            Reintentar
          </MuiButton>
        }>
          {error}
        </MuiAlert>
      )}

      {/* ── Stock hero card ───────────────────── */}
      <MuiCard variant="elevated" sx={{ mb: 4 }}>
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2 }}>
            <SectionHeading icon={<IconBox size={18} />} label="Stock" />
            <MuiButton variant="secondary" size="sm" startIcon={<IconEdit />} onClick={openCostDialog}>
              Editar
            </MuiButton>
          </Box>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 1,
              mb: 2,
              px: 2,
              py: 2,
              borderRadius: m3Shape.medium,
              bgcolor: meta ? meta.container : 'surfaceContainerHighest',
            }}
          >
            <Typography
              variant="h2"
              sx={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: meta ? meta.onContainer : 'onSurfaceVariant', lineHeight: 1 }}
            >
              {hasInventory ? stock : '—'}
            </Typography>
            <Typography variant="body2" color="text.secondary">maples</Typography>
          </Box>
          <Grid container spacing={2}>
            <Grid size={{ xs: 4 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Umbral
              </Typography>
              <Typography variant="body1" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {hasInventory ? threshold : '—'}
              </Typography>
            </Grid>
            <Grid size={{ xs: 4 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Valor de stock
              </Typography>
              <Typography variant="body1" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {stockValue != null ? formatPrice(stockValue) : '—'}
              </Typography>
            </Grid>
            <Grid size={{ xs: 4 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Costo/maple
              </Typography>
              <Typography variant="body1" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {product.costPrice != null ? formatPrice(product.costPrice) : '—'}
              </Typography>
            </Grid>
          </Grid>
        </Box>
      </MuiCard>

      {/* ── Cajón card ────────────────────────── */}
      <MuiCard variant="elevated" sx={{ mb: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
          <Box sx={{ minWidth: 0 }}>
            <SectionHeading icon={<IconBox size={18} />} label="Cajón" />
            <Typography variant="body1" sx={{ fontWeight: 600 }}>
              1 cajón = {maplesPerCajon} maples
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {product.eggsPerMaple} huevos por maple → {maplesPerCajon * product.eggsPerMaple} huevos por cajón
            </Typography>
          </Box>
          <MuiButton variant="secondary" size="sm" startIcon={<IconEdit />} onClick={openCajonDialog}>
            Editar
          </MuiButton>
        </Box>
      </MuiCard>

      {/* ── Prices card ───────────────────────── */}
      <MuiCard variant="elevated" sx={{ mb: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
          <Box sx={{ minWidth: 0 }}>
            <SectionHeading icon={<IconMoney size={18} />} label="Precios" />
            <Grid container spacing={2}>
              <Grid size={{ xs: 4 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {unitLabel('maple')}
                </Typography>
                <Typography variant="body1" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {activePrice ? formatPrice(activePrice.price) : 'Sin precio'}
                </Typography>
              </Grid>
              <Grid size={{ xs: 4 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {unitLabel('medio_cajon')}
                </Typography>
                <Typography variant="body1" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {medioCajonPrice ? formatPrice(medioCajonPrice.price) : 'Sin precio'}
                </Typography>
              </Grid>
              <Grid size={{ xs: 4 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {unitLabel('cajon')}
                </Typography>
                <Typography variant="body1" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {cajonPrice ? formatPrice(cajonPrice.price) : 'Sin precio'}
                </Typography>
              </Grid>
            </Grid>
          </Box>
          <MuiButton variant="primary" size="sm" startIcon={<IconMoney />} onClick={openPriceDialog}>
            Establecer precio
          </MuiButton>
        </Box>
      </MuiCard>

      {/* ── Ganancia card ─────────────────────── */}
      <MuiCard variant="elevated" sx={{ mb: 4 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
            <SectionHeading icon={<IconChart size={18} />} label="Ganancia" />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CostInfoButton />
              <MuiButton variant="secondary" size="sm" startIcon={<IconEdit />} onClick={openCostDialog}>
                Editar costo
              </MuiButton>
            </Box>
          </Box>

          {marginUnits.length === 0 ? (
            <EmptyState
              icon={<IconMoney size={30} />}
              title="Sin precios cargados"
              subtitle="Cargá un precio para ver la ganancia."
              action={
                <MuiButton variant="primary" size="sm" startIcon={<IconMoney />} onClick={openPriceDialog}>
                  Cargar precio
                </MuiButton>
              }
            />
          ) : product.costPrice == null ? (
            <>
              <Typography variant="body2" color="text.secondary">
                Cargá un costo para ver la ganancia.
              </Typography>
              <MuiChip label="Sin costo" color="warning" size="small" sx={{ mt: 1 }} />
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 2 }}>
                {marginUnits.map(({ unit, label, price }) => (
                  <Box key={unit} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 2 }}>
                    <Typography variant="caption" color="text.secondary">
                      {label} — precio de venta
                    </Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {formatPrice(price)}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {marginUnits.map(({ unit, label, price }) => {
                const breakdown = computeMargin(price, product.costPrice, unit, maplesPerCajon);
                const marginColor =
                  breakdown && breakdown.margin > 0
                    ? 'success.main'
                    : breakdown && breakdown.margin < 0
                      ? 'error.main'
                      : 'text.secondary';
                const chipColor =
                  breakdown && breakdown.margin > 0
                    ? 'success'
                    : breakdown && breakdown.margin < 0
                      ? 'error'
                      : 'default';

                return (
                  <Box
                    key={unit}
                    sx={{
                      px: 2,
                      py: 2,
                      borderRadius: m3Shape.medium,
                      bgcolor: 'surfaceContainerHighest',
                    }}
                  >
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}
                    >
                      {label}
                    </Typography>
                    <Grid container spacing={2} sx={{ mt: 0.5 }}>
                      <Grid size={{ xs: 6, sm: 3 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          Precio de venta
                        </Typography>
                        <Typography variant="body1" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          {formatPrice(price)}
                        </Typography>
                      </Grid>
                      <Grid size={{ xs: 6, sm: 3 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          Costo
                        </Typography>
                        <Typography variant="body1" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          {breakdown ? formatPrice(breakdown.cost) : '—'}
                        </Typography>
                      </Grid>
                      <Grid size={{ xs: 6, sm: 3 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          Ganancia
                        </Typography>
                        <Typography
                          variant="body1"
                          sx={{
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 700,
                            fontVariantNumeric: 'tabular-nums',
                            color: marginColor,
                          }}
                        >
                          {breakdown ? formatPrice(breakdown.margin) : '—'}
                        </Typography>
                      </Grid>
                      <Grid size={{ xs: 6, sm: 3 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          Margen
                        </Typography>
                        {breakdown ? (
                          <MuiChip label={formatMarginPct(breakdown.marginPct)} color={chipColor} />
                        ) : (
                          <Typography variant="body2" color="text.secondary">—</Typography>
                        )}
                      </Grid>
                    </Grid>
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>
      </MuiCard>

      {/* ── Stock actions card ────────────────── */}
      {hasInventory && (
        <MuiCard variant="elevated" sx={{ mb: 4 }}>
          <Box>
            <SectionHeading icon={<IconPlus size={18} />} label="Movimientos de stock" />
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <MuiButton variant="secondary" size="sm" startIcon={<IconPlus />} onClick={() => openStockDialog('entry')}>
                Entrada
              </MuiButton>
              <MuiButton variant="secondary" size="sm" startIcon={<IconMinus />} onClick={() => openStockDialog('exit')}>
                Salida
              </MuiButton>
              <MuiButton variant="secondary" size="sm" startIcon={<IconEdit />} onClick={openAdjustDialog}>
                Ajustar
              </MuiButton>
            </Box>
          </Box>
        </MuiCard>
      )}

      {/* ── Historial card ────────────────────── */}
      <MuiCard variant="elevated" sx={{ mb: 4, p: 0, overflow: 'hidden', '& .MuiCardContent-root': { p: 0, '&:last-child': { pb: 0 } } }}>
        <Box sx={{ p: 2, pb: 0 }}>
          <SectionHeading icon={<IconHistory size={18} />} label="Historial de movimientos" />
        </Box>
        {transactions.length === 0 ? (
          <Box sx={{ p: 2 }}>
            <EmptyState
              title="Sin movimientos"
              subtitle="Las entradas, salidas y ajustes de este producto aparecerán acá."
            />
          </Box>
        ) : (
          <MuiTable
            columns={txColumns}
            rows={transactions}
            onRowClick={(row) => {
              if (row.purchaseId) navigate(`/compras/${row.purchaseId}`);
            }}
            isRowClickable={(row) => Boolean(row.purchaseId)}
            containerSx={{ boxShadow: 'none', border: 0, borderTop: 1, borderColor: 'divider' }}
          />
        )}
      </MuiCard>

      {/* ── Danger zone ───────────────────────── */}
      <MuiCard variant="outlined" sx={{ mb: 4 }}>
        <Box>
          <SectionHeading icon={<IconDelete size={18} />} label="Zona de riesgo" />
          {hasInventory ? (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
              <Typography variant="body2" color="text.secondary">
                Eliminar el inventario borra el registro de stock actual. No se puede deshacer.
              </Typography>
              <MuiButton variant="danger" size="sm" startIcon={<IconDelete />} onClick={() => setDeleteOpen(true)}>
                Eliminar inventario
              </MuiButton>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
              <Typography variant="body2" color="text.secondary">
                Este producto todavía no tiene inventario. Creá uno para empezar a registrar stock.
              </Typography>
              <MuiButton variant="primary" size="sm" startIcon={<IconPlus />} onClick={openCreateDialog}>
                Crear inventario
              </MuiButton>
            </Box>
          )}
        </Box>
      </MuiCard>

      {/* ── Cost / Threshold Edit Dialog ──────── */}
      <MuiDialog
        open={costOpen}
        onClose={() => setCostOpen(false)}
        title={`Costo y umbral — ${product.displayName}`}
        actions={
          <>
            <MuiButton variant="ghost" onClick={() => setCostOpen(false)} disabled={cajonSubmitting}>Cancelar</MuiButton>
            <MuiButton variant="primary" isLoading={cajonSubmitting} disabled={cajonSubmitting} onClick={() => {
              const form = document.querySelector('[data-cost-form]') as HTMLFormElement;
              form?.requestSubmit();
            }}>
              {cajonSubmitting ? 'Guardando...' : 'Guardar'}
            </MuiButton>
          </>
        }
      >
        <Box component="form" data-cost-form onSubmit={handleCostSave} sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {costError && <MuiAlert severity="error">{costError}</MuiAlert>}
          <Typography variant="body2" color="text.secondary">
            El costo por maple alimenta el valor de stock y los márgenes. El umbral define cuándo la alerta de stock bajo se activa.
          </Typography>
          <MuiTextField
            label="Costo por maple ($)"
            type="number"
            value={costValue}
            onChange={(e) => setCostValue(e.target.value)}
            placeholder="Opcional"
            slotProps={{ htmlInput: { min: 0, step: '0.01' } }}
          />
          <MuiTextField
            label="Umbral de stock bajo"
            type="number"
            value={thresholdValue}
            onChange={(e) => setThresholdValue(e.target.value)}
            placeholder="20"
            slotProps={{ htmlInput: { min: 0, step: 1 } }}
          />
        </Box>
      </MuiDialog>

      {/* ── Cajón Edit Dialog ─────────────────── */}
      <MuiDialog
        open={cajonOpen}
        onClose={() => setCajonOpen(false)}
        title={`Editar cajón — ${product.displayName}`}
        actions={
          <>
            <MuiButton variant="ghost" onClick={() => setCajonOpen(false)} disabled={cajonSubmitting}>Cancelar</MuiButton>
            <MuiButton variant="primary" isLoading={cajonSubmitting} disabled={cajonSubmitting} onClick={() => {
              const form = document.querySelector('[data-cajon-form]') as HTMLFormElement;
              form?.requestSubmit();
            }}>
              {cajonSubmitting ? 'Guardando...' : 'Guardar'}
            </MuiButton>
          </>
        }
      >
        <Box component="form" data-cajon-form onSubmit={handleCajonSave} sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {cajonError && <MuiAlert severity="error">{cajonError}</MuiAlert>}
          <Typography variant="body2" color="text.secondary">
            ¿Cuántos maples entran en un cajón de {product.displayName}? Se usa para convertir ventas y compras en cajones.
          </Typography>
          <MuiTextField
            label="Maples por cajón"
            type="number"
            value={cajonValue}
            onChange={(e) => setCajonValue(e.target.value)}
            required
            autoFocus
            placeholder="12"
          />
        </Box>
      </MuiDialog>

      {/* ── Price Dialog ──────────────────────── */}
      <MuiDialog
        open={priceOpen}
        onClose={() => setPriceOpen(false)}
        title={`Precios — ${product.displayName}`}
        maxWidth="md"
      >
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Establecer nuevo precio</Typography>
          <Box component="form" onSubmit={handleSetPrice} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {priceFormError && <MuiAlert severity="error">{priceFormError}</MuiAlert>}
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 3 }}>
                <MuiTextField label="Precio ($)" type="number" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} required placeholder="0.00" />
              </Grid>
              <Grid size={{ xs: 12, sm: 3 }}>
                <FormControl variant="filled" fullWidth>
                  <InputLabel id="price-unit-label">Unidad</InputLabel>
                  <Select
                    labelId="price-unit-label"
                    value={priceUnit}
                    onChange={(e) => setPriceUnit(e.target.value as PriceUnit)}
                    label="Unidad"
                  >
                    {PRODUCT_UNIT_OPTIONS.map((opt) => (
                      <MenuItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 3 }}>
                <MuiTextField label="Vigente desde" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required />
              </Grid>
              <Grid size={{ xs: 12, sm: 3 }}>
                <MuiTextField label="Vigente hasta" type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
              </Grid>
            </Grid>
            <MuiButton variant="primary" type="submit" isLoading={priceSubmitting} disabled={priceSubmitting} sx={{ alignSelf: 'flex-start' }}>
              {priceSubmitting ? 'Guardando...' : 'Establecer Precio'}
            </MuiButton>
          </Box>
        </Box>

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Historial de precios</Typography>
        {priceHistory.length === 0 ? (
          <Typography variant="body2" color="text.secondary">No hay precios registrados.</Typography>
        ) : (
          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '0.7fr 1fr 1fr 1fr 1fr', p: 1, bgcolor: 'action.hover' }}>
              {['Unidad', 'Precio', 'Desde', 'Hasta', 'Estado'].map(h => (
                <Typography key={h} variant="caption" color="text.secondary" sx={{ fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {h}
                </Typography>
              ))}
            </Box>
            {priceHistory.map((entry) => {
              const now = new Date();
              const from = new Date(entry.effectiveFrom);
              const to = entry.effectiveTo ? new Date(entry.effectiveTo) : null;
              const isActive = from <= now && (!to || to >= now);

              return (
                <Box key={entry._id} sx={{ display: 'grid', gridTemplateColumns: '0.7fr 1fr 1fr 1fr 1fr', p: 1, borderTop: '1px solid', borderColor: 'divider', alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, textTransform: 'capitalize' }}>
                    {unitLabel(entry.unit ?? 'maple')}
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {formatPrice(entry.price)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {from.toLocaleDateString('es-AR')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {to ? to.toLocaleDateString('es-AR') : 'Indefinido'}
                  </Typography>
                  <MuiChip
                    label={isActive ? 'Activo' : 'Inactivo'}
                    color={isActive ? 'success' : 'default'}
                    size="small"
                  />
                </Box>
              );
            })}
          </Box>
        )}
      </MuiDialog>

      {/* ── Adjustment Dialog ──────────────────── */}
      <MuiDialog
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        title={`Ajustar stock — ${product.displayName}`}
        actions={
          <>
            <MuiButton variant="ghost" onClick={() => setAdjustOpen(false)}>Cancelar</MuiButton>
            <MuiButton variant="primary" isLoading={adjustSubmitting} disabled={adjustSubmitting} onClick={() => {
              const form = document.querySelector('[data-adjust-form]') as HTMLFormElement;
              form?.requestSubmit();
            }}>
              {adjustSubmitting ? 'Guardando...' : 'Guardar ajuste'}
            </MuiButton>
          </>
        }
      >
        <Box component="form" data-adjust-form onSubmit={handleAdjust} sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {adjustError && <MuiAlert severity="error">{adjustError}</MuiAlert>}

          <Box>
            <Typography variant="caption" color="text.secondary">Cantidad actual (maples)</Typography>
            <Typography variant="h5" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {stock}
            </Typography>
          </Box>

          <MuiTextField
            label="Nueva cantidad (maples)"
            type="number"
            value={adjustQuantity}
            onChange={(e) => setAdjustQuantity(e.target.value)}
            required
          />

          <MuiTextField
            label="Notas (opcional)"
            value={adjustNotes}
            onChange={(e) => setAdjustNotes(e.target.value)}
            placeholder="Motivo del ajuste..."
          />
        </Box>
      </MuiDialog>

      {/* ── Entry / Exit Dialog ────────────────── */}
      <MuiDialog
        open={stockOpen}
        onClose={() => setStockOpen(false)}
        title={`${stockMode === 'entry' ? 'Entrada' : 'Salida'} de stock — ${product.displayName}`}
        actions={
          <>
            <MuiButton variant="ghost" onClick={() => setStockOpen(false)} disabled={stockSubmitting}>Cancelar</MuiButton>
            <MuiButton variant="primary" isLoading={stockSubmitting} disabled={stockSubmitting} onClick={() => {
              const form = document.querySelector('[data-stock-form]') as HTMLFormElement;
              form?.requestSubmit();
            }}>
              {stockSubmitting ? 'Guardando...' : stockMode === 'entry' ? 'Registrar entrada' : 'Registrar salida'}
            </MuiButton>
          </>
        }
      >
        <Box component="form" data-stock-form onSubmit={handleStockSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {stockError && <MuiAlert severity="error">{stockError}</MuiAlert>}

          <Box>
            <Typography variant="caption" color="text.secondary">Stock actual (maples)</Typography>
            <Typography variant="h5" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {stock}
            </Typography>
          </Box>

          <MuiTextField
            label="Cantidad (maples)"
            type="number"
            value={stockQty}
            onChange={(e) => setStockQty(e.target.value)}
            required
            autoFocus
            placeholder={stockMode === 'entry' ? 'Cantidad a ingresar' : 'Cantidad a egresar'}
          />

          <MuiTextField
            label="Notas (opcional)"
            value={stockNotes}
            onChange={(e) => setStockNotes(e.target.value)}
            placeholder="Motivo del movimiento..."
          />
        </Box>
      </MuiDialog>

      {/* ── Create Inventory Dialog ────────────── */}
      <MuiDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={`Nuevo inventario — ${product.displayName}`}
        actions={
          <>
            <MuiButton variant="ghost" onClick={() => setCreateOpen(false)} disabled={createSubmitting}>Cancelar</MuiButton>
            <MuiButton
              variant="primary"
              isLoading={createSubmitting}
              disabled={createSubmitting}
              onClick={() => {
                const form = document.querySelector('[data-create-form]') as HTMLFormElement;
                form?.requestSubmit();
              }}
            >
              {createSubmitting ? 'Guardando...' : 'Crear inventario'}
            </MuiButton>
          </>
        }
      >
        <Box component="form" data-create-form onSubmit={handleCreate} sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {createError && <MuiAlert severity="error">{createError}</MuiAlert>}

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <MuiTextField
                label="Cantidad inicial (maples)"
                type="number"
                value={createQty}
                onChange={(e) => setCreateQty(e.target.value)}
                placeholder="0"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <MuiTextField
                label="Umbral de stock"
                type="number"
                value={createThreshold}
                onChange={(e) => setCreateThreshold(e.target.value)}
                placeholder="20"
              />
            </Grid>
          </Grid>
        </Box>
      </MuiDialog>

      {/* ── Delete Confirm Dialog ──────────────── */}
      <MuiDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Eliminar inventario"
        actions={
          <>
            <MuiButton variant="ghost" onClick={() => setDeleteOpen(false)} disabled={deleteSubmitting}>Cancelar</MuiButton>
            <MuiButton variant="danger" isLoading={deleteSubmitting} disabled={deleteSubmitting} onClick={handleDelete}>
              {deleteSubmitting ? 'Eliminando...' : 'Eliminar'}
            </MuiButton>
          </>
        }
      >
        <Typography variant="body2">
          ¿Seguro que querés eliminar el inventario de <strong>{product.displayName}</strong>? Se perderá el registro de stock actual y no se podrá deshacer.
        </Typography>
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