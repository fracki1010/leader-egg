import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProducts, useInventory, useProductOptions } from '../hooks/queries/index.ts';
import { useClassifyInventory, useCreateProduct } from '../hooks/mutations/index.ts';
import { useAuthStore } from '../stores/authStore.ts';
import { isOfflineQueuedError } from '../hooks/use-offline-mutation.ts';
import {
  MuiButton,
  MuiDialog,
  MuiSnackbar,
  MuiTextField,
  MuiIconButton,
  PageHeader,
  LoadingState,
  EmptyState,
} from '../components/ui/index.ts';
import {
  IconSync,
  IconBox,
  IconChevronRight,
  IconSwapVert,
  IconPlus,
  IconDelete,
  IconWarning,
  IconCheck,
} from '../components/ui/icons.tsx';
import {
  getStockStatus,
  inventoryProductId,
} from '../components/stock/StockStatusChips.tsx';
import type { StockStatus } from '../components/stock/StockStatusChips.tsx';
import { m3Shape } from '../theme/index.ts';
import {
  PRODUCT_VARIETIES,
  PRODUCT_CALIBERS,
  CALIBER_LABELS,
  VARIETY_LABELS,
} from '../types/index.ts';
import type {
  InventoryItem,
  Product,
  ProductCaliber,
  ProductVariety,
} from '../types/index.ts';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import MuiAlert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';

/* ── Types ──────────────────────────────────── */

interface StockItem extends Product {
  inventory: InventoryItem | null;
}

/** One target row of the classify dialog (product select + maples). */
interface ClassifyRow {
  productId: string;
  quantity: string;
}

type StockFilter = 'all' | ProductVariety | 'low';

/** Presentation tone: healthy stock is success, low stock is error. */
type StockTone = 'success' | 'error' | 'neutral';

const DEFAULT_LOW_STOCK_THRESHOLD = 20;

/** Product-level threshold wins; fall back to the inventory snapshot. */
function itemThreshold(item: StockItem): number {
  return item.lowStockThreshold ?? item.inventory?.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
}

/** Status is null when the product has no inventory record yet. */
function itemStatus(item: StockItem): StockStatus | null {
  if (!item.inventory) return null;
  return getStockStatus(item.inventory.quantity, itemThreshold(item));
}

/* ── Filter chips ───────────────────────────── */

interface StockFilterChipsProps {
  value: StockFilter;
  counts: { blanco: number; castano: number; low: number };
  onChange: (value: StockFilter) => void;
}

/**
 * StockFilterChips — local, client-side filters. Chips always wrap: the app
 * removed horizontal scrolling, so this row must never become a scroller.
 */
function StockFilterChips({ value, counts, onChange }: StockFilterChipsProps) {
  const options: { value: StockFilter; label: string; ariaLabel: string }[] = [
    { value: 'all', label: 'Todos', ariaLabel: 'Mostrar todos los calibres' },
    { value: 'blanco', label: `Blanco (${counts.blanco})`, ariaLabel: `Blanco: ${counts.blanco} calibres` },
    { value: 'castaño', label: `Castaño (${counts.castano})`, ariaLabel: `Castaño: ${counts.castano} calibres` },
    { value: 'low', label: 'Stock Bajo', ariaLabel: `Stock bajo: ${counts.low} calibres` },
  ];

  return (
    <Box
      role="group"
      aria-label="Filtrar stock por variedad o nivel"
      sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 3 }}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <Chip
            key={option.value}
            clickable
            label={option.label}
            aria-label={option.ariaLabel}
            aria-pressed={active}
            color={active ? 'primary' : 'default'}
            variant="filled"
            onClick={() => onChange(option.value)}
            sx={{
              height: 38,
              border: '1px solid',
              borderColor: active
                ? 'transparent'
                : (t: Theme) => alpha(t.palette.outlineVariant, 0.9),
              '& .MuiChip-label': { px: 1.5, fontWeight: 700 },
              '&.Mui-focusVisible': {
                outline: (t: Theme) => `2px solid ${alpha(t.palette.primary.main, 0.6)}`,
                outlineOffset: 2,
              },
            }}
          />
        );
      })}
    </Box>
  );
}

/* ── Variety section header ─────────────────── */

interface VarietyHeaderProps {
  variety: ProductVariety;
  label: string;
  count: number;
}

function VarietyHeader({ variety, label, count }: VarietyHeaderProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 2 }}>
      <Box
        aria-hidden
        sx={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          flexShrink: 0,
          // Blanco = neutral-light chip; Castaño = warm amber/brown tone.
          ...(variety === 'blanco'
            ? { bgcolor: 'surfaceContainerHighest', border: '1px solid', borderColor: 'outline' }
            : { bgcolor: 'tertiary.main' }),
        }}
      />
      <Typography
        component="h6"
        variant="subtitle2"
        sx={{ fontWeight: 700, fontSize: '1rem', color: 'onSurface' }}
      >
        {label}
      </Typography>
      <Typography
        variant="labelMedium"
        color="onSurfaceVariant"
        sx={{ ml: 'auto', fontVariantNumeric: 'tabular-nums' }}
      >
        {count} {count === 1 ? 'calibre' : 'calibres'}
      </Typography>
    </Box>
  );
}

/* ── Status badge ───────────────────────────── */

function StockBadge({ status }: { status: StockStatus | null }) {
  if (status === null) {
    return (
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          height: 24,
          px: 1,
          borderRadius: '999px',
          flexShrink: 0,
          bgcolor: 'surfaceContainerHigh',
          border: '1px solid',
          borderColor: (t: Theme) => alpha(t.palette.outlineVariant, 0.6),
          color: 'onSurfaceVariant',
        }}
      >
        <Typography component="span" variant="labelMedium" sx={{ fontWeight: 600, lineHeight: 1, color: 'inherit' }}>
          Sin inventario
        </Typography>
      </Box>
    );
  }

  const isLow = status === 'bajo';
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        height: 24,
        px: 1,
        borderRadius: '999px',
        flexShrink: 0,
        bgcolor: isLow ? 'errorContainer' : 'successContainer',
        color: isLow ? 'onErrorContainer' : 'onSuccessContainer',
      }}
    >
      {isLow ? <IconWarning size={13} /> : <IconCheck size={13} />}
      <Typography component="span" variant="labelMedium" sx={{ fontWeight: 700, lineHeight: 1, color: 'inherit' }}>
        {isLow ? 'Bajo' : 'OK'}
      </Typography>
    </Box>
  );
}

/* ── Stock meter ────────────────────────────── */

function StockMeter({ stock, tone }: { stock: number | null; tone: StockTone }) {
  const isNeutral = tone === 'neutral';
  const role = tone === 'error' ? 'error' : 'success';

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 1,
        px: 1.75,
        py: 1.5,
        mb: 1.5,
        borderRadius: m3Shape.medium,
        ...(isNeutral
          ? {
              bgcolor: 'surfaceContainerHigh',
              border: '1px solid',
              borderColor: (t: Theme) => alpha(t.palette.outlineVariant, 0.5),
            }
          : {
              background: (t: Theme) =>
                `linear-gradient(135deg, ${alpha(t.palette[role].main, 0.16)}, ${alpha(t.palette[role].main, 0.02)})`,
              border: '1px solid',
              borderColor: (t: Theme) => alpha(t.palette[role].main, 0.22),
            }),
      }}
    >
      <Typography
        component="div"
        sx={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1.875rem',
          fontWeight: 800,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
          color: isNeutral ? 'onSurfaceVariant' : role === 'error' ? 'error.main' : 'success.main',
        }}
      >
        {stock ?? '—'}
      </Typography>
      <Typography variant="bodySmall" color="onSurfaceVariant" sx={{ fontWeight: 600 }}>
        maples disponibles
      </Typography>
    </Box>
  );
}

/* ── Spec row ───────────────────────────────── */

interface SpecRowProps {
  label: string;
  value: ReactNode;
  mono?: boolean;
  muted?: boolean;
  italic?: boolean;
  /** Draw a hairline above this row (used for every row after the first). */
  divider?: boolean;
}

function SpecRow({ label, value, mono = false, muted = false, italic = false, divider = false }: SpecRowProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        py: 0.75,
        ...(divider
          ? {
              borderTop: '1px solid',
              borderColor: (t: Theme) => alpha(t.palette.outlineVariant, 0.45),
            }
          : {}),
      }}
    >
      <Typography variant="bodySmall" color="onSurfaceVariant" sx={{ flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography
        component="div"
        variant="bodySmall"
        noWrap
        sx={{
          minWidth: 0,
          textAlign: 'right',
          fontFamily: mono ? 'var(--font-mono)' : undefined,
          fontWeight: mono ? 700 : 600,
          fontVariantNumeric: mono ? 'tabular-nums' : undefined,
          color: muted ? 'onSurfaceVariant' : 'onSurface',
          fontStyle: italic ? 'italic' : 'normal',
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

/* ── Product card ───────────────────────────── */

interface StockCardProps {
  item: StockItem;
  onOpen: () => void;
  onClassify: (item: StockItem) => void;
}

function StockCard({ item, onOpen, onClassify }: StockCardProps) {
  const stock = item.inventory?.quantity ?? 0;
  const hasInventory = item.inventory !== null;
  const threshold = itemThreshold(item);
  const status = itemStatus(item);
  const maplesPerCajon = item.maplesPerCajon ?? 12;
  // Equivalence shown to the user is always floored ("tirando para abajo"):
  // 18 maples → 1 cajón and 3 medios cajones.
  const cajones = Math.floor(stock / maplesPerCajon);
  const mediosCajones = Math.floor(stock / (maplesPerCajon / 2));
  const isSurtido = item.caliber === 'surtido';
  const isLow = status === 'bajo';
  const tone: StockTone = status === null ? 'neutral' : isLow ? 'error' : 'success';
  const canClassify = hasInventory && stock > 0;

  return (
    <Card
      elevation={0}
      onClick={onOpen}
      sx={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        p: 2,
        borderRadius: '22px',
        bgcolor: isSurtido ? 'surfaceContainerLow' : 'surfaceContainer',
        border: '1px solid',
        borderStyle: isSurtido ? 'dashed' : 'solid',
        borderColor: isSurtido
          ? (t: Theme) => alpha(t.palette.outline, 0.7)
          : (t: Theme) => alpha(t.palette.outlineVariant, 0.7),
        // Soft status ring; surtido keeps its dashed shell.
        boxShadow:
          tone === 'neutral'
            ? 'none'
            : (t: Theme) =>
                `0 0 0 1px ${alpha(
                  t.palette[tone === 'error' ? 'error' : 'success'].main,
                  tone === 'error' ? 0.3 : 0.22,
                )}`,
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
        transition: 'background-color 0.18s, transform 0.18s cubic-bezier(0.2, 0, 0, 1)',
        '&:hover': {
          bgcolor: isSurtido ? 'surfaceContainer' : 'surfaceContainerHigh',
          transform: 'translateY(-1px)',
        },
        '@media (prefers-reduced-motion: reduce)': {
          transition: 'none',
          '&:hover': { transform: 'none' },
        },
      }}
    >
      {/* Caliber + status badge */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, mb: isSurtido ? 0.5 : 1.5 }}>
        <Box
          aria-hidden
          sx={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            flexShrink: 0,
            bgcolor:
              tone === 'neutral' ? 'outline' : tone === 'error' ? 'error.main' : 'success.main',
            ...(isLow
              ? {
                  animation: 'stockPulse 1.6s ease-in-out infinite',
                  '@keyframes stockPulse': {
                    '0%, 100%': { opacity: 1, transform: 'scale(1)' },
                    '50%': { opacity: 0.45, transform: 'scale(0.82)' },
                  },
                  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                }
              : {}),
          }}
        />
        <Typography
          component="div"
          variant="body1"
          noWrap
          sx={{
            minWidth: 0,
            flex: 1,
            fontWeight: isLow ? 700 : 600,
            color: 'onSurface',
          }}
        >
          {CALIBER_LABELS[item.caliber]}
        </Typography>
        <StockBadge status={status} />
      </Box>

      {isSurtido && (
        <Typography
          variant="bodySmall"
          color="onSurfaceVariant"
          sx={{ display: 'block', fontStyle: 'italic', mb: 1.5 }}
        >
          Sin clasificar
        </Typography>
      )}

      <StockMeter stock={hasInventory ? stock : null} tone={tone} />

      {/* Specs — label left, value right, hairline dividers */}
      <Box sx={{ mb: 1 }}>
        <SpecRow label="Umbral" value={threshold} mono />
        <SpecRow
          label="Cajones"
          value={hasInventory ? cajones : '—'}
          mono={hasInventory}
          muted={!hasInventory}
          divider
        />
        <SpecRow
          label="Medios cajones"
          value={hasInventory ? mediosCajones : '—'}
          mono={hasInventory}
          muted={!hasInventory}
          divider
        />
        <SpecRow label="1 cajón" value={`${maplesPerCajon} maples`} mono divider />
      </Box>

      {/* Actions — Clasificar (when there is stock) + detail affordance */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          mt: 'auto',
          pt: 1.5,
        }}
      >
        {canClassify ? (
          <Box onClick={(event) => event.stopPropagation()}>
            <MuiButton
              variant="ghost"
              size="sm"
              startIcon={<IconSwapVert size={16} />}
              onClick={() => onClassify(item)}
              sx={{ minHeight: 36, px: 1 }}
            >
              Clasificar
            </MuiButton>
          </Box>
        ) : (
          <Box />
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'onSurfaceVariant', flexShrink: 0 }}>
          <Typography variant="labelMedium" sx={{ fontWeight: 600, color: 'inherit' }}>
            Ver detalle
          </Typography>
          <IconChevronRight size={16} />
        </Box>
      </Box>
    </Card>
  );
}

/* ── StockPage — variety × caliber grouped list ── */

/**
 * StockPage — products grouped by variety (Blanco / Castaño), each with its
 * caliber rows (Chico … Surtido). Every card is clickable and opens the
 * product's detail page (/products/:id) where all management lives.
 * Admins can create a new product from the header ("Nuevo Producto").
 */
export function StockPage() {
  const navigate = useNavigate();

  // Read model — products + their inventory records.
  const productsQuery = useProducts();
  const inventoryQuery = useInventory();
  const products = productsQuery.data ?? [];
  const inventoryList = inventoryQuery.data ?? [];

  const loading = productsQuery.isLoading || inventoryQuery.isLoading;
  const loadError = productsQuery.error ?? inventoryQuery.error;
  const error = loadError
    ? loadError instanceof Error
      ? loadError.message
      : 'Error al cargar inventario'
    : null;

  /** Products merged with their inventory record (derived). */
  const items: StockItem[] = (() => {
    const inventoryMap = new Map<string, InventoryItem>();
    for (const inv of inventoryList) {
      const pid = inventoryProductId(inv);
      if (pid) inventoryMap.set(pid, inv);
    }
    return products.map((product) => ({
      ...product,
      inventory: inventoryMap.get(product._id) ?? null,
    }));
  })();

  const refetchAll = () => {
    void productsQuery.refetch();
    void inventoryQuery.refetch();
  };

  // Clasificar dialog state
  const [classifySource, setClassifySource] = useState<StockItem | null>(null);
  const [classifyRows, setClassifyRows] = useState<ClassifyRow[]>([{ productId: '', quantity: '' }]);
  const [classifyNotes, setClassifyNotes] = useState('');
  const [classifyError, setClassifyError] = useState<string | null>(null);

  // Snackbar
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  // Classify write — offline-aware: a queued write is a success, not an error.
  const classifyMutation = useClassifyInventory();
  const classifySubmitting = classifyMutation.isPending;

  /* ── Admin: create product ─────────────────── */

  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const optionsQuery = useProductOptions();
  const createMutation = useCreateProduct();
  const createSubmitting = createMutation.isPending;

  const varietyOptions = optionsQuery.data?.varieties
    ?? PRODUCT_VARIETIES.map((value) => ({ value, label: VARIETY_LABELS[value] }));
  const caliberOptions = optionsQuery.data?.calibers
    ?? PRODUCT_CALIBERS.map((value) => ({ value, label: CALIBER_LABELS[value] }));

  const [createOpen, setCreateOpen] = useState(false);
  const [newVariety, setNewVariety] = useState<ProductVariety>('blanco');
  const [newCaliber, setNewCaliber] = useState<ProductCaliber>('chico');
  const [newInitialStock, setNewInitialStock] = useState('');
  const [newCostPrice, setNewCostPrice] = useState('');
  const [newThreshold, setNewThreshold] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const openCreateDialog = () => {
    setNewVariety('blanco');
    setNewCaliber('chico');
    setNewInitialStock('');
    setNewCostPrice('');
    setNewThreshold('');
    setCreateError(null);
    setCreateOpen(true);
  };

  const handleCreateProduct = (e: FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    const initialQty = newInitialStock === '' ? 0 : Number(newInitialStock);
    if (isNaN(initialQty) || initialQty < 0) {
      setCreateError('El stock inicial debe ser un número no negativo');
      return;
    }
    const costPrice = newCostPrice === '' ? undefined : Number(newCostPrice);
    if (costPrice !== undefined && (isNaN(costPrice) || costPrice <= 0)) {
      setCreateError('El costo debe ser mayor a 0');
      return;
    }
    const threshold = newThreshold === '' ? undefined : Number(newThreshold);
    if (threshold !== undefined && (isNaN(threshold) || threshold < 0)) {
      setCreateError('El umbral debe ser un número no negativo');
      return;
    }

    createMutation.mutate(
      {
        variety: newVariety,
        caliber: newCaliber,
        ...(costPrice !== undefined ? { costPrice } : {}),
        ...(threshold !== undefined ? { lowStockThreshold: threshold } : {}),
        initialQuantity: initialQty,
      },
      {
        onSuccess: () => {
          setSnackbar({ open: true, message: 'Producto creado', severity: 'success' });
          setCreateOpen(false);
        },
        onError: (err) => {
          if (isOfflineQueuedError(err)) {
            setSnackbar({ open: true, message: 'Producto creado (offline)', severity: 'success' });
            setCreateOpen(false);
            return;
          }
          setCreateError(err instanceof Error ? err.message : 'Error al crear producto');
        },
      },
    );
  };

  // Group products by variety, calibers in canonical order (Surtido last).
  const groupedItems = PRODUCT_VARIETIES.map((variety) => ({
    variety,
    label: VARIETY_LABELS[variety],
    items: items
      .filter((it) => it.variety === variety)
      .sort((a, b) => PRODUCT_CALIBERS.indexOf(a.caliber) - PRODUCT_CALIBERS.indexOf(b.caliber)),
  }));

  /* ── Local filters ─────────────────────────── */

  const [filter, setFilter] = useState<StockFilter>('all');

  const counts = {
    blanco: items.filter((item) => item.variety === 'blanco').length,
    castano: items.filter((item) => item.variety === 'castaño').length,
    low: items.filter((item) => itemStatus(item) === 'bajo').length,
  };

  const visibleGroups = groupedItems
    .filter((group) => filter === 'all' || filter === 'low' || group.variety === filter)
    .map((group) => ({
      ...group,
      items: filter === 'low'
        ? group.items.filter((item) => itemStatus(item) === 'bajo')
        : group.items,
    }))
    .filter((group) => filter === 'all' || group.items.length > 0);

  const hasVisibleItems = visibleGroups.some((group) => group.items.length > 0);

  /* ── Clasificar dialog ─────────────────────── */

  const openClassify = (item: StockItem) => {
    setClassifySource(item);
    setClassifyRows([{ productId: '', quantity: '' }]);
    setClassifyNotes('');
    setClassifyError(null);
  };

  const updateClassifyRow = (index: number, patch: Partial<ClassifyRow>) => {
    setClassifyRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const addClassifyRow = () => {
    setClassifyRows((rows) => [...rows, { productId: '', quantity: '' }]);
  };

  const removeClassifyRow = (index: number) => {
    setClassifyRows((rows) => (rows.length === 1 ? rows : rows.filter((_, i) => i !== index)));
  };

  /** Products that can receive classified stock: any other product with an inventory record. */
  const classifyTargetOptions = classifySource
    ? items.filter((item) => item._id !== classifySource._id && item.inventory !== null)
    : [];

  const available = classifySource?.inventory?.quantity ?? 0;

  /** Live Σ of the filled rows (maples) — drives the availability hint. */
  const classifyTotal = classifyRows.reduce((sum, row) => {
    const qty = Number(row.quantity);
    return sum + (Number.isFinite(qty) && qty > 0 ? qty : 0);
  }, 0);

  const classifyExceeds = classifyTotal > available;

  const handleClassifySave = () => {
    if (!classifySource) return;
    setClassifyError(null);

    // Every row must be either complete (product + qty > 0) or fully empty.
    for (const [index, row] of classifyRows.entries()) {
      const qty = Number(row.quantity);
      if (row.productId === '' && row.quantity.trim() !== '') {
        setClassifyError(`Elegí un producto en la fila ${index + 1}`);
        return;
      }
      if (row.productId !== '' && (!Number.isFinite(qty) || qty <= 0)) {
        setClassifyError(`La cantidad de la fila ${index + 1} debe ser mayor a 0`);
        return;
      }
    }

    const to = classifyRows
      .filter((row) => row.productId !== '' && Number(row.quantity) > 0)
      .map((row) => ({ productId: row.productId, quantity: Number(row.quantity) }));

    if (to.length === 0) {
      setClassifyError('Agregá al menos un producto para clasificar');
      return;
    }

    if (classifyTotal > available) {
      setClassifyError(`No hay stock suficiente. Disponible: ${available} maples`);
      return;
    }

    classifyMutation.mutate(
      {
        fromProductId: classifySource._id,
        data: {
          to,
          notes: classifyNotes.trim() !== '' ? classifyNotes : undefined,
        },
      },
      {
        onSuccess: () => {
          // The mutation invalidates inventory/products/dashboard, so the
          // list refetches automatically.
          setSnackbar({ open: true, message: 'Surtido clasificado', severity: 'success' });
          setClassifySource(null);
        },
        onError: (err) => {
          // Offline queued write: normal outcome, the OfflineBanner already
          // confirmed it — do not show an error state.
          if (isOfflineQueuedError(err)) {
            setSnackbar({ open: true, message: 'Guardado sin conexión', severity: 'success' });
            setClassifySource(null);
            return;
          }
          setClassifyError(err instanceof Error ? err.message : 'Error al clasificar');
        },
      },
    );
  };

  if (loading) {
    return <LoadingState label="Cargando inventario…" />;
  }

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
      {/* Header — single PageHeader pattern */}
      <PageHeader
        title="Stock de Maples"
        subtitle="Inventario y movimientos por producto"
        icon={<IconBox size={22} />}
        actions={
          <>
            {isAdmin && (
              <MuiButton
                variant="primary"
                size="sm"
                startIcon={<IconPlus />}
                onClick={openCreateDialog}
              >
                Nuevo Producto
              </MuiButton>
            )}
            <MuiButton
              variant="secondary"
              size="sm"
              startIcon={<IconSync />}
              onClick={refetchAll}
            >
              Actualizar
            </MuiButton>
          </>
        }
      />

      {error && (
        <MuiAlert severity="error" sx={{ mb: 3 }} action={
          <MuiButton variant="ghost" size="sm" onClick={refetchAll}>
            Reintentar
          </MuiButton>
        }>
          {error}
        </MuiAlert>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="No hay productos"
          subtitle="Ejecutá el seed para crear productos, o creá un producto nuevo desde “Nuevo Producto”."
        />
      ) : (
        <>
          <StockFilterChips value={filter} counts={counts} onChange={setFilter} />

          {hasVisibleItems ? (
            visibleGroups.map((group) => (
              <Box key={group.variety} component="section" sx={{ mb: 4 }}>
                <VarietyHeader variety={group.variety} label={group.label} count={group.items.length} />

                {group.items.length === 0 ? (
                  <Typography variant="body2" color="onSurfaceVariant">
                    Sin calibres cargados para {group.label}.
                  </Typography>
                ) : (
                  <Grid container spacing={2.5}>
                    {group.items.map((item) => (
                      <Grid size={{ xs: 12, sm: 6 }} key={item._id} sx={{ display: 'flex' }}>
                        <StockCard
                          item={item}
                          onOpen={() => navigate(`/products/${item._id}`)}
                          onClassify={openClassify}
                        />
                      </Grid>
                    ))}
                  </Grid>
                )}
              </Box>
            ))
          ) : (
            <EmptyState
              title="Sin resultados"
              subtitle="No hay calibres que coincidan con el filtro seleccionado."
            />
          )}
        </>
      )}

      {/* ── Clasificar dialog ──────────────────── */}
      <MuiDialog
        open={classifySource !== null}
        onClose={() => setClassifySource(null)}
        title={classifySource ? `Clasificar ${classifySource.displayName}` : 'Clasificar'}
        actions={
          <>
            <MuiButton variant="ghost" onClick={() => setClassifySource(null)} disabled={classifySubmitting}>
              Cancelar
            </MuiButton>
            <MuiButton
              variant="primary"
              isLoading={classifySubmitting}
              disabled={classifySubmitting || classifyExceeds}
              onClick={handleClassifySave}
            >
              {classifySubmitting ? 'Clasificando...' : 'Clasificar'}
            </MuiButton>
          </>
        }
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {classifyError && <MuiAlert severity="error">{classifyError}</MuiAlert>}

          {/* Source availability + live Σ */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              p: 1.5,
              borderRadius: m3Shape.medium,
              bgcolor: 'surfaceContainerLow',
            }}
          >
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Disponible
              </Typography>
              <Typography variant="body1" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {available} maples
              </Typography>
            </Box>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Total a clasificar
              </Typography>
              <Typography
                variant="body1"
                sx={{
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                  color: classifyExceeds ? 'error.main' : 'onSurface',
                }}
              >
                {classifyTotal} de {available} maples
              </Typography>
            </Box>
          </Box>

          {classifyExceeds && (
            <MuiAlert severity="error">La suma supera el stock disponible del producto origen.</MuiAlert>
          )}

          {/* Target rows — product select + maples */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              ¿En qué productos se convierte?
            </Typography>
            {classifyRows.map((row, index) => (
              <Box key={index} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <MuiTextField
                  select
                  label={`Producto ${index + 1}`}
                  value={row.productId}
                  onChange={(e) => updateClassifyRow(index, { productId: e.target.value })}
                  size="small"
                  sx={{ flex: 1 }}
                >
                  {classifyTargetOptions.map((option) => (
                    <MenuItem key={option._id} value={option._id}>
                      {option.displayName}
                    </MenuItem>
                  ))}
                </MuiTextField>
                <MuiTextField
                  label={`Cantidad ${index + 1}`}
                  type="number"
                  value={row.quantity}
                  onChange={(e) => updateClassifyRow(index, { quantity: e.target.value })}
                  size="small"
                  slotProps={{ htmlInput: { min: 1, step: 1 } }}
                  sx={{ width: 140 }}
                />
                <MuiIconButton
                  aria-label={`Quitar fila ${index + 1}`}
                  onClick={() => removeClassifyRow(index)}
                  disabled={classifyRows.length === 1}
                  sx={{ mt: 0.5 }}
                >
                  <IconDelete size={18} />
                </MuiIconButton>
              </Box>
            ))}
            <MuiButton variant="ghost" size="sm" startIcon={<IconPlus size={16} />} onClick={addClassifyRow} sx={{ alignSelf: 'flex-start' }}>
              Agregar producto
            </MuiButton>
          </Box>

          <MuiTextField
            label="Notas (opcional)"
            value={classifyNotes}
            onChange={(e) => setClassifyNotes(e.target.value)}
            placeholder="Motivo de la clasificación..."
          />
        </Box>
      </MuiDialog>

      {/* ── Nuevo Producto dialog (admin) ───────── */}
      <MuiDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Nuevo Producto"
        actions={
          <>
            <MuiButton variant="ghost" onClick={() => setCreateOpen(false)} disabled={createSubmitting}>
              Cancelar
            </MuiButton>
            <MuiButton
              variant="primary"
              isLoading={createSubmitting}
              disabled={createSubmitting}
              onClick={() => {
                const form = document.querySelector('[data-create-product-form]') as HTMLFormElement;
                form?.requestSubmit();
              }}
            >
              {createSubmitting ? 'Creando...' : 'Crear producto'}
            </MuiButton>
          </>
        }
      >
        <Box
          component="form"
          data-create-product-form
          onSubmit={handleCreateProduct}
          sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}
        >
          {createError && <MuiAlert severity="error">{createError}</MuiAlert>}

          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <MuiTextField
              select
              label="Variedad"
              value={newVariety}
              onChange={(e) => setNewVariety(e.target.value as ProductVariety)}
              size="small"
              sx={{ flex: 1 }}
            >
              {varietyOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </MuiTextField>
            <MuiTextField
              select
              label="Calibre"
              value={newCaliber}
              onChange={(e) => setNewCaliber(e.target.value as ProductCaliber)}
              size="small"
              sx={{ flex: 1 }}
            >
              {caliberOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </MuiTextField>
          </Box>

          {optionsQuery.data && (
            <Typography variant="caption" color="text.secondary">
              Producto: <strong>{VARIETY_LABELS[newVariety]} {CALIBER_LABELS[newCaliber]}</strong>
            </Typography>
          )}

          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <MuiTextField
              label="Stock inicial (maples)"
              type="number"
              value={newInitialStock}
              onChange={(e) => setNewInitialStock(e.target.value)}
              size="small"
              placeholder="0"
              sx={{ flex: 1 }}
            />
            <MuiTextField
              label="Costo por maple ($)"
              type="number"
              value={newCostPrice}
              onChange={(e) => setNewCostPrice(e.target.value)}
              size="small"
              placeholder="Opcional"
              sx={{ flex: 1 }}
            />
          </Box>

          <MuiTextField
            label="Umbral de stock bajo"
            type="number"
            value={newThreshold}
            onChange={(e) => setNewThreshold(e.target.value)}
            size="small"
            placeholder="20"
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
