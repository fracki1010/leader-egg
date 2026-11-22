import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import type { CreateOrderPayload, InitialPaymentPayload } from '../api/orders.ts';
import { productsApi } from '../api/products.ts';
import { geocode, reverseGeocode } from '../api/geocode.ts';
import { geocodeCityProvince } from '../lib/geocode-hint.ts';
import { applyPromoPrice, pickBestPromo, promoShortLabel } from '../lib/promos.ts';
import { PRODUCT_UNIT_OPTIONS, unitLabel, unitToMaples } from '../lib/units.ts';
import { isOnline, onOfflineStatusChange } from '../lib/offline-status.ts';
import { ApiError } from '../api/client.ts';
import { useAuthStore } from '../stores/authStore.ts';
import {
  useCustomers,
  useProducts,
  useActivePromotions,
  useInventory,
  useCustomerOutstanding,
} from '../hooks/queries/index.ts';
import { useCreateOrder } from '../hooks/mutations/index.ts';
import { isOfflineQueuedError } from '../hooks/use-offline-mutation.ts';
import {
  DuplicateWarningDialog,
  getDuplicateRecordInfo,
  type DuplicateRecordInfo,
} from '../components/common/DuplicateWarningDialog.tsx';
import { useSmartBack } from '../hooks/useSmartBack.ts';
import { queryKeys } from '../hooks/query-keys.ts';
import type { Customer, LatLng, OrderChannel, PaymentPreference, PriceUnit, Product, Promotion, SalesChannel, BonificationType, SurchargeType } from '../types/index.ts';
import { PRODUCT_VARIETIES, VARIETY_LABELS } from '../types/index.ts';
import { MuiButton, MuiCard, MuiChip, MuiTextField, LoadingState, MapView } from '../components/ui/index.ts';
import {
  PaymentLinesEditor,
  newPaymentLine,
  toPaymentLines,
  totalOfLines,
  type PaymentLineDraft,
} from '../components/purchase/PaymentLinesEditor.tsx';
import {
  IconArrowBack,
  IconBox,
  IconCheck,
  IconChevronRight,
  IconCircleCheck,
  IconCustomer,
  IconDiscount,
  IconEgg,
  IconEvent,
  IconFlag,
  IconInfo,
  IconLocation,
  IconMapPin,
  IconMinus,
  IconMoney,
  IconPayments,
  IconPhone,
  IconPlus,
  IconPointOfSale,
  IconPromo,
  IconQrCode,
  IconReceiptLong,
  IconSearch,
  IconStore,
  IconStorefront,
  IconSwapHoriz,
  IconTruck,
  IconTrendingUp,
  IconWallet,
  IconWarning,
  IconWhatsapp,
  IconX,
  IconMore,
  IconMyLocation,
} from '../components/ui/icons.tsx';
import { m3Shape } from '../theme/index.ts';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import Menu from '@mui/material/Menu';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import ListSubheader from '@mui/material/ListSubheader';
import CircularProgress from '@mui/material/CircularProgress';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';

/* ── Types ──────────────────────────────────── */

interface ItemRow {
  productId: string;
  /** Quantity in the row's own unit (maple | medio_cajon | cajon). */
  quantity: number;
  unit: PriceUnit;
  /** Base active price for the row's unit (promos are applied live). */
  unitPrice: number;
}

/** Active price per unit for a product. */
interface ProductPrices {
  maple?: { price: number };
  medio_cajon?: { price: number };
  cajon?: { price: number };
}

interface RowPricing {
  promo: Promotion | null;
  basePrice: number;
  qty: number;
  unitPrice: number;
  subtotal: number;
}

/* ── Constants ───────────────────────────────── */

const channelLabels: Record<OrderChannel, string> = {
  phone: 'Telefónico',
  whatsapp: 'WhatsApp',
  driver_visit: 'Visita',
  walk_in: 'Mostrador',
};

const channelIcons: Record<OrderChannel, ReactNode> = {
  phone: <IconPhone size={16} />,
  whatsapp: <IconWhatsapp size={16} />,
  driver_visit: <IconTruck size={16} />,
  walk_in: <IconStorefront size={16} />,
};

/** Pending preferences — how the customer is expected to pay when the sale is left open. */
const paymentOptions: { value: PaymentPreference; label: string; icon: ReactNode }[] = [
  { value: 'cash', label: 'Efectivo', icon: <IconPointOfSale size={22} /> },
  { value: 'transfer', label: 'Transf./QR', icon: <IconQrCode size={22} /> },
  { value: 'credit', label: 'Cta. Cte.', icon: <IconWallet size={22} /> },
  { value: 'cod', label: 'Contra reembolso', icon: <IconTruck size={22} /> },
];

/** Where the sale was made — distinct from the contact channel (Card 1). */
const salesChannelOptions: { value: SalesChannel; label: string; icon: ReactNode }[] = [
  { value: 'reparto', label: 'Reparto', icon: <IconTruck size={22} /> },
  { value: 'puesto', label: 'Puesto', icon: <IconStorefront size={22} /> },
  { value: 'whatsapp', label: 'WhatsApp', icon: <IconWhatsapp size={22} /> },
  { value: 'otro', label: 'Otro', icon: <IconMore size={22} /> },
];

/**
 * System B2C customer seeded by the backend as the default counter client.
 * Puesto users start a sale pre-selected on this customer ("venta de mostrador").
 */
const WALK_IN_CUSTOMER_NAME = 'Puesto (mostrador)';

/* ── Helpers ────────────────────────────────── */

const fmtMoney = (val: number) =>
  `$ ${val.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

/** Rounds to cents — matches the backend money rounding. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Today's calendar date in YYYY-MM-DD (local time) — seed for the delivery date input. */
const todayISO = (): string => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

/**
 * Converts a customer's GeoJSON Point (coordinates [lng, lat]) to the
 * map's { lat, lng } shape. Returns null when the customer has no location.
 */
const customerLocationToLatLng = (location: Customer['location']): LatLng | null => {
  if (!location || location.type !== 'Point') return null;
  const [lng, lat] = location.coordinates;
  return { lat, lng };
};

const maplesPerCajonFor = (product: Product | undefined): number => product?.maplesPerCajon ?? 12;

/** Active price for a product + unit (undefined when the unit has no price). */
const priceForUnit = (prices: ProductPrices | undefined, unit: PriceUnit): number | undefined =>
  prices?.[unit]?.price;

/* ── Section header (icon chip + title + actions) ── */

function SectionHeader({
  icon,
  title,
  actions,
  iconSx,
}: {
  icon: ReactNode;
  title: string;
  actions?: ReactNode;
  iconSx?: Record<string, unknown>;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: '10px',
          bgcolor: 'primaryContainer',
          color: 'onPrimaryContainer',
          flexShrink: 0,
          ...iconSx,
        }}
      >
        {icon}
      </Box>
      <Typography variant="titleMedium" sx={{ fontWeight: 700, color: 'onSurface', flex: 1, minWidth: 0 }}>
        {title}
      </Typography>
      {actions}
    </Box>
  );
}

/* ── Tactile quantity stepper ────────────────── */

function QtyStepper({
  value,
  unitLabel,
  onDecrement,
  onIncrement,
  disabled = false,
}: {
  value: number;
  unitLabel: string;
  onDecrement: () => void;
  onIncrement: () => void;
  disabled?: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
      <IconButton
        aria-label="Disminuir cantidad"
        onClick={onDecrement}
        disabled={disabled || value <= 0}
        sx={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          bgcolor: 'surfaceContainer',
          color: 'onSurface',
          border: 1,
          borderColor: 'outlineVariant',
          '&:hover': { bgcolor: 'surfaceContainerHigh' },
          '&:disabled': { bgcolor: 'surfaceContainer', color: 'outline', opacity: 0.5 },
        }}
      >
        <IconMinus size={20} />
      </IconButton>
      <Box sx={{ textAlign: 'center', minWidth: 64 }}>
        <Typography
          variant="h6"
          sx={{
            fontFamily: 'var(--font-mono)',
            fontWeight: 800,
            letterSpacing: '-0.02em',
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1.15,
            color: 'onSurface',
          }}
        >
          {value}
        </Typography>
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            fontWeight: 600,
            color: 'onSurfaceVariant',
          }}
        >
          {unitLabel}
        </Typography>
      </Box>
      <IconButton
        aria-label="Aumentar cantidad"
        onClick={onIncrement}
        disabled={disabled}
        sx={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          bgcolor: 'primaryContainer',
          color: 'onPrimaryContainer',
          '&:hover': { filter: 'brightness(0.96)' },
          '&:disabled': { bgcolor: 'surfaceContainer', color: 'outline', opacity: 0.5 },
        }}
      >
        <IconPlus size={20} />
      </IconButton>
    </Box>
  );
}

/* ── Compact per-row unit segmented control ──── */

/**
 * Small M3 segmented pill that switches ONE product row between its sellable
 * units (Maple / Medio cajón / Cajón). Kept compact so it fits inside a row.
 */
function UnitSegmented({
  value,
  onChange,
}: {
  value: PriceUnit;
  onChange: (unit: PriceUnit) => void;
}) {
  return (
    <Box
      role="group"
      aria-label="Unidad de venta"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        bgcolor: 'surfaceContainer',
        borderRadius: 9999,
        p: 0.25,
        flexShrink: 0,
      }}
    >
      {PRODUCT_UNIT_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <Box
            key={opt.value}
            component="button"
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            sx={{
              px: 1,
              py: 0.25,
              borderRadius: 9999,
              border: 'none',
              cursor: 'pointer',
              bgcolor: active ? 'surfaceContainerLowest' : 'transparent',
              color: active ? 'primary.main' : 'onSurfaceVariant',
              fontWeight: 700,
              fontSize: '0.6875rem',
              lineHeight: 1.5,
              whiteSpace: 'nowrap',
              fontFamily: 'inherit',
              boxShadow: active ? 1 : 'none',
              transition: 'background-color 0.15s, box-shadow 0.15s',
            }}
          >
            {opt.label}
          </Box>
        );
      })}
    </Box>
  );
}

/* ── Planificación de entrega cell ───────────── */

function PlanCell({
  icon,
  label,
  value,
  onClick,
  withChevron = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  onClick?: (e: ReactMouseEvent<HTMLButtonElement>) => void;
  withChevron?: boolean;
}) {
  const inner = (
    <>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: '10px',
          bgcolor: 'surfaceContainerHighest',
          color: 'onSurfaceVariant',
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="onSurfaceVariant" sx={{ display: 'block', fontWeight: 500 }}>
          {label}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
          <Typography
            variant="body2"
            sx={{ fontWeight: 700, color: 'onSurface', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {value}
          </Typography>
          {withChevron && <IconChevronRight size={15} style={{ color: 'var(--mui-palette-onSurfaceVariant)', flexShrink: 0 }} />}
        </Box>
      </Box>
    </>
  );

  if (onClick) {
    return (
      <Box
        component="button"
        type="button"
        onClick={onClick}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          p: 1.5,
          borderRadius: '12px',
          bgcolor: 'surfaceContainerLow',
          border: 1,
          borderColor: 'outlineVariant',
          cursor: 'pointer',
          textAlign: 'left',
          width: '100%',
          font: 'inherit',
          color: 'inherit',
          transition: 'background-color 0.15s',
          '&:hover': { bgcolor: 'surfaceContainerHigh' },
        }}
      >
        {inner}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        p: 1.5,
        borderRadius: '12px',
        bgcolor: 'surfaceContainerLow',
        border: 1,
        borderColor: 'outlineVariant',
      }}
    >
      {inner}
    </Box>
  );
}

/* ── Product row (Carga de Mercadería) ───────── */

interface StockCheck {
  availableMaples: number | null;
  requestedMaples: number;
  error: string | null;
}

/**
 * Stock gate for a row. Quantity is compared in maples via the shared unit
 * helper (a medio cajón needs maplesPerCajon / 2, a full cajón the whole
 * amount). `allowPreSale` relaxes ONLY the stock gate — the price gate is
 * enforced elsewhere. A full cajón is rejected when the remaining stock is
 * smaller than one cajón, even if some maples are still sellable.
 */
function evaluateStock(
  row: ItemRow,
  product: Product | undefined,
  availableMaples: number | null,
  allowPreSale: boolean,
): StockCheck {
  const maplesPerCajon = maplesPerCajonFor(product);
  const requestedMaples =
    row.quantity > 0 ? unitToMaples(row.quantity, row.unit, maplesPerCajon) : 0;

  let error: string | null = null;
  if (!allowPreSale && row.productId && row.quantity > 0 && availableMaples != null) {
    if (availableMaples <= 0) {
      error = 'Sin stock disponible';
    } else if (row.unit === 'cajon' && maplesPerCajon > 0 && availableMaples < maplesPerCajon) {
      error = `No hay cajones completos — disponible: ${availableMaples.toLocaleString('es-AR')} maples`;
    } else if (requestedMaples > availableMaples) {
      error = `Solo tenés ${availableMaples.toLocaleString('es-AR')} maples`;
    }
  }

  return { availableMaples, requestedMaples, error };
}

/* ── Manual row ("Agregar Producto") ─────────── */

function ManualRow({
  row,
  products,
  priceMap,
  inventoryByProduct,
  requestedByProduct,
  unit,
  pricing,
  allowPreSale,
  onSelectProduct,
  onAdjust,
  onRemove,
  onUnitChange,
  onGoToPrices,
}: {
  row: ItemRow;
  products: Product[];
  /** Active price per unit — used to flag products with no price. */
  priceMap: Record<string, ProductPrices>;
  /** Available stock per product, in maples. */
  inventoryByProduct: Record<string, number>;
  /** Total maples requested per product across every row (this row included). */
  requestedByProduct: Map<string, number>;
  unit: PriceUnit;
  pricing: RowPricing;
  /** Relaxes the stock gate only (preventa) — the price gate always applies. */
  allowPreSale: boolean;
  onSelectProduct: (productId: string) => void;
  onAdjust: (delta: number) => void;
  onRemove: () => void;
  onUnitChange: (unit: PriceUnit) => void;
  /** Opens the Stock page, where a product's price is loaded. */
  onGoToPrices: () => void;
}) {
  const product = products.find((p) => p._id === row.productId);
  const maplesPerCajon = maplesPerCajonFor(product);
  const noPrice = !!row.productId && !(row.unitPrice > 0);
  // Maples this row contributes, so the shared product total can be adjusted
  // back out when computing what this row actually has available.
  const thisRowMaples =
    row.productId && row.quantity > 0
      ? unitToMaples(row.quantity, row.unit, maplesPerCajon)
      : 0;
  const otherRowsMaples = (productId: string): number => {
    const total = requestedByProduct.get(productId) ?? 0;
    return Math.max(0, total - (productId === row.productId ? thisRowMaples : 0));
  };
  const remainingFor = (productId: string): number =>
    Math.max(0, (inventoryByProduct[productId] ?? 0) - otherRowsMaples(productId));

  const availableMaples = row.productId ? remainingFor(row.productId) : null;
  const stock = evaluateStock(row, product, availableMaples, allowPreSale);

  const descParts = [
    product?.eggsPerMaple ? `${product.eggsPerMaple} huevos/maple` : null,
    maplesPerCajon ? `${maplesPerCajon} maples/cajón` : null,
  ].filter(Boolean);

  // A product may legitimately appear in more than one row (e.g. 1 cajón +
  // 2 maples), so every product stays selectable. Stock is evaluated in
  // aggregate: `requestedByProduct` already includes the other rows.
  const selectable = products;

  return (
    <Box
      sx={{
        bgcolor: 'surfaceContainerLow',
        borderRadius: '16px',
        border: 1,
        borderColor: stock.error ? 'error.main' : 'outlineVariant',
        p: 2,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
        <MuiTextField
          label="Producto"
          value={row.productId}
          onChange={(e) => onSelectProduct(e.target.value)}
          select
          sx={{ flex: 1 }}
          slotProps={{ select: { displayEmpty: true } }}
        >
          <MenuItem value="" disabled>
            Seleccionar producto...
          </MenuItem>
          {PRODUCT_VARIETIES.flatMap((variety) => {
            const group = selectable.filter((p) => p.variety === variety);
            if (group.length === 0) return [];
            return [
              <ListSubheader key={`header-${variety}`}>{VARIETY_LABELS[variety]}</ListSubheader>,
              ...group.map((p) => {
                const prices = priceMap[p._id];
                const hasPrice =
                  prices?.maple != null || prices?.medio_cajon != null || prices?.cajon != null;
                const stockQty = remainingFor(p._id);
                const hasStock = allowPreSale || stockQty > 0;
                const disabled = !hasPrice || !hasStock;
                const suffix = !hasPrice && !hasStock
                  ? ' — sin stock ni precio'
                  : !hasPrice
                    ? ' — sin precio'
                    : !hasStock
                      ? ' — sin stock'
                      : '';
                const stockNote = hasPrice ? ` (${stockQty.toLocaleString('es-AR')} maples)` : '';
                return (
                  <MenuItem key={p._id} value={p._id} disabled={disabled}>
                    {`${p.displayName}${stockNote}${suffix}`}
                  </MenuItem>
                );
              }),
            ];
          })}
          {selectable.length === 0 && (
            <MenuItem value="" disabled>
              No hay más productos disponibles
            </MenuItem>
          )}
        </MuiTextField>
        <IconButton
          onClick={onRemove}
          aria-label="Quitar producto"
          sx={{
            width: 40,
            height: 40,
            borderRadius: '12px',
            bgcolor: 'surfaceContainer',
            color: 'onSurfaceVariant',
            '&:hover': { bgcolor: 'errorContainer', color: 'onErrorContainer' },
          }}
        >
          <IconX size={18} />
        </IconButton>
      </Box>

      {product && (
        <>
          {/* Identity + price */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mt: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, minWidth: 0 }}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 44,
                  height: 44,
                  borderRadius: '12px',
                  bgcolor: 'primaryContainer',
                  color: 'onPrimaryContainer',
                  flexShrink: 0,
                }}
              >
                <IconEgg size={20} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  variant="subtitle2"
                  sx={{ fontWeight: 700, color: 'onSurface', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {product.displayName}
                </Typography>
                {descParts.length > 0 && (
                  <Typography variant="caption" color="onSurfaceVariant" sx={{ display: 'block' }}>
                    {descParts.join(' · ')}
                  </Typography>
                )}
              </Box>
            </Box>
            <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
              <Typography
                variant="h6"
                sx={{
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 800,
                  letterSpacing: '-0.02em',
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: 1.15,
                  color: noPrice ? 'onSurfaceVariant' : 'primary.main',
                }}
              >
                {noPrice ? 'Sin precio' : fmtMoney(pricing.unitPrice)}
              </Typography>
              <Typography variant="caption" color="onSurfaceVariant" sx={{ display: 'block' }}>
                x {unitLabel(unit)}
              </Typography>
              {pricing.promo && !noPrice && (
                <MuiChip
                  size="small"
                  color="primary"
                  variant="filled"
                  icon={<IconPromo size={12} />}
                  label={`PROMO ${promoShortLabel(pricing.promo)}`}
                  sx={{ mt: 0.5 }}
                />
              )}
              {pricing.promo && !noPrice && (
                <Typography variant="caption" color="onSurfaceVariant" sx={{ textDecoration: 'line-through', display: 'block' }}>
                  {fmtMoney(pricing.basePrice)}
                </Typography>
              )}
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.75 }}>
                <UnitSegmented
                  value={unit}
                  onChange={onUnitChange}
                />
              </Box>
            </Box>
          </Box>

          {/* Stock disponible */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5, mt: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: availableMaples == null || availableMaples <= 0 ? 'outline' : 'success.main',
                  flexShrink: 0,
                }}
              />
              <Typography
                variant="caption"
                sx={{ fontWeight: 600, color: 'onSurface', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {availableMaples == null
                  ? 'Sin stock registrado'
                  : `Disponible: ${availableMaples.toLocaleString('es-AR')} maples`}
              </Typography>
            </Box>
            {allowPreSale && (
              <MuiChip size="small" color="warning" label="Preventa" sx={{ flexShrink: 0 }} />
            )}
          </Box>
        </>
      )}

      {/* Stepper + subtotal */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 2, mt: 1.5 }}>
        <QtyStepper
          value={row.quantity}
          unitLabel={unitLabel(unit, { plural: true })}
          onDecrement={() => onAdjust(-1)}
          onIncrement={() => onAdjust(1)}
          disabled={!row.productId || noPrice}
        />
        <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
          <Typography variant="caption" color="onSurfaceVariant" sx={{ display: 'block' }}>
            {row.quantity > 0 && product
              ? unit === 'maple'
                ? `${Math.floor(row.quantity / maplesPerCajon)} cajones cerrados`
                : `${row.quantity} ${unitLabel(unit, { plural: true }).toLowerCase()} = ${stock.requestedMaples.toLocaleString('es-AR')} maples`
              : '—'}
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              fontVariantNumeric: 'tabular-nums',
              color: 'onSurface',
            }}
          >
            {fmtMoney(pricing.subtotal)}
          </Typography>
        </Box>
      </Box>

      {stock.error && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 1, px: 1.5, py: 1, borderRadius: '10px', bgcolor: 'errorContainer', color: 'onErrorContainer' }}>
          <IconWarning size={16} style={{ flexShrink: 0 }} />
          <Typography variant="caption" sx={{ fontWeight: 700 }}>
            {stock.error}
          </Typography>
        </Box>
      )}

      {noPrice && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 1 }}>
          <Typography variant="caption" color="warning.main" sx={{ fontWeight: 600 }}>
            Sin precio activo en {unitLabel(unit, { plural: true }).toLowerCase()} — cargalo en el producto.
          </Typography>
          <MuiButton
            variant="ghost"
            size="sm"
            onClick={onGoToPrices}
            startIcon={<IconMoney size={14} />}
            sx={{ minHeight: 0, py: 0.25 }}
          >
            Ir a Productos
          </MuiButton>
        </Box>
      )}
    </Box>
  );
}

/* ── Credit stat cell ────────────────────────── */

function CreditStat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warning' | 'error' }) {
  const color = tone === 'error' ? 'error.main' : tone === 'warning' ? 'warning.main' : tone === 'ok' ? 'success.main' : 'onSurface';
  return (
    <Box
      sx={{
        p: 1.25,
        borderRadius: '10px',
        bgcolor: 'surfaceContainerLowest',
        border: 1,
        borderColor: 'outlineVariant',
      }}
    >
      <Typography variant="caption" color="onSurfaceVariant" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color }}
      >
        {value}
      </Typography>
    </Box>
  );
}

/* ── NewOrderPage ───────────────────────────── */

export function NewOrderPage() {
  const navigate = useNavigate();
  const goBack = useSmartBack('/orders');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const successTimer = useRef<number | null>(null);

  const { user } = useAuthStore();
  /** Puesto mode — locked to stall sales: salesChannel 'puesto', channel 'walk_in'. */
  const isPuesto = user?.role === 'puesto';

  // Preselected customer via URL (?customer=:id) — used by the "+ Pedido"
  // quick action on the customers list (CustomersPage).
  const [searchParams] = useSearchParams();
  const preselectedCustomerId = searchParams.get('customer');

  // Reads — customers, products, active promos and inventory feed the 5-card
  // layout; per-product active prices (maple / medio cajón / cajón) come from a
  // fan-out (each lookup caught: a missing price just hides that unit's price).
  const customersQuery = useCustomers(true);
  const productsQuery = useProducts();
  const promotionsQuery = useActivePromotions();
  const inventoryQuery = useInventory();

  const customers = customersQuery.data ?? [];
  const products = productsQuery.data ?? [];
  const activePromos = promotionsQuery.data ?? [];
  const inventory = inventoryQuery.data ?? [];

  // One price query per unit, in PRODUCT_UNIT_OPTIONS order (3 per product).
  const priceQueries = useQueries({
    queries: products.flatMap((p) =>
      PRODUCT_UNIT_OPTIONS.map((opt) => ({
        queryKey: queryKeys.products.activePrice(p._id, opt.value),
        queryFn: () => productsApi.getActivePrice(p._id, opt.value).catch(() => undefined),
      })),
    ),
  });

  const priceMap: Record<string, ProductPrices> = {};
  products.forEach((p, i) => {
    const entries: ProductPrices = {};
    PRODUCT_UNIT_OPTIONS.forEach((opt, u) => {
      const entry = priceQueries[i * PRODUCT_UNIT_OPTIONS.length + u]?.data;
      if (entry) entries[opt.value] = { price: entry.price };
    });
    priceMap[p._id] = entries;
  });

  const dataLoading =
    customersQuery.isLoading ||
    productsQuery.isLoading ||
    promotionsQuery.isLoading ||
    inventoryQuery.isLoading ||
    priceQueries.some((q) => q.isLoading);

  const loadError =
    customersQuery.error ?? productsQuery.error ?? promotionsQuery.error ?? inventoryQuery.error;

  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [channel, setChannel] = useState<OrderChannel>(isPuesto ? 'walk_in' : 'phone');
  // Business/sale date (YYYY-MM-DD) — when the sale happened. Defaults to today.
  const [orderDate, setOrderDate] = useState<string>(todayISO);
  // Initial status — "Ya entregado" creates the order delivered and the backend
  // deducts the stock immediately. Defaults to the normal pending flow.
  const [initialStatus, setInitialStatus] = useState<'pending' | 'delivered'>('pending');
  // Date the customer wants the delivery (YYYY-MM-DD, defaults to today; empty → backend stores null).
  const [deliveryDate, setDeliveryDate] = useState<string>(todayISO);
  const [items, setItems] = useState<ItemRow[]>([]);
  // "Permitir preventa" — admin/superadmin escape hatch that relaxes ONLY the
  // stock gate (price is always enforced). Default OFF.
  const [allowPreSale, setAllowPreSale] = useState(false);
  const canPreSale = user?.role === 'admin' || user?.role === 'superadmin';
  // Pending preference — how the customer is expected to pay (no payment registered).
  const [paymentMethod, setPaymentMethod] = useState<PaymentPreference>('cash');
  const [salesChannel, setSalesChannel] = useState<SalesChannel>(isPuesto ? 'puesto' : 'reparto');
  // Order-level bonification (discount). 'amount' = fixed $, 'percent' = % of subtotal.
  const [bonificationType, setBonificationType] = useState<BonificationType>('amount');
  const [bonificationValue, setBonificationValue] = useState('');
  // Order-level surcharge (added to the total). 'amount' = fixed $, 'percent' = % of subtotal.
  const [surchargeType, setSurchargeType] = useState<SurchargeType>('amount');
  const [surchargeValue, setSurchargeValue] = useState('');
  // "Paga ahora" — register REAL Payment doc(s) inline at creation. Default OFF
  // (most sales are left pending and collected later).
  const [payNow, setPayNow] = useState(false);
  // Inline payment line(s). Seeded with a single line for the order total when
  // "Paga ahora" is picked; the user can lower it (partial) or split methods.
  const [paymentLines, setPaymentLines] = useState<PaymentLineDraft[]>([newPaymentLine()]);
  // Stops the total-sync effect from overwriting a manual amount once edited.
  const paymentLinesTouched = useRef(false);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [deliveryLocation, setDeliveryLocation] = useState<LatLng | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  // Manual point mode — fallback when geocoding fails or the address is not found
  const [selectingManual, setSelectingManual] = useState(false);
  // Manual-mode map center — geocoded "Ciudad, Provincia" hint for the
  // selected customer so the manual map opens near their zone.
  const [manualCenter, setManualCenter] = useState<LatLng | null>(null);
  const [manualHintLoading, setManualHintLoading] = useState(false);
  // Device GPS state — "Mi ubicación" button (non-blocking)
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  /**
   * Changing the business date keeps the one-edit flow: the delivery plan
   * follows it while it was empty or still mirrored the previous business date.
   * A delivery date the user deliberately set elsewhere is never overwritten.
   */
  const handleOrderDateChange = (value: string) => {
    const previousOrderDate = orderDate;
    setOrderDate(value);
    setDeliveryDate((currentDeliveryDate) =>
      !currentDeliveryDate || currentDeliveryDate === previousOrderDate ? value : currentDeliveryDate
    );
  };

  // Outstanding balance follows the selected customer — enabled only when one
  // is chosen (query re-keys and refetches on change).
  const outstandingQuery = useCustomerOutstanding(selectedCustomerId || undefined);
  const outstanding = outstandingQuery.data ?? null;

  // A read failure is surfaced through the shared form error (same as the old
  // loadData catch), so the form still renders with empty lists.
  useEffect(() => {
    if (!loadError) return;
    setFormError(loadError instanceof Error ? loadError.message : 'Error al cargar datos');
  }, [loadError]);

  // Channel picker menu (Turno/Franja cell in Card 1)
  const [channelMenuAnchor, setChannelMenuAnchor] = useState<HTMLElement | null>(null);

  const [online, setOnline] = useState<boolean>(isOnline());

  // Preselect the customer from ?customer=:id once the customer list is
  // loaded (mirrors selectCustomer so the address/map states follow).
  useEffect(() => {
    if (!preselectedCustomerId || dataLoading || selectedCustomerId) return;
    const c = customers.find((x) => x._id === preselectedCustomerId);
    if (!c) return;
    setSelectedCustomerId(c._id);
    setDeliveryAddress(c.address);
    setDeliveryLocation(customerLocationToLatLng(c.location));
    setGeocodeError(null);
    setSelectingManual(false);
    setManualCenter(null);
    setManualHintLoading(false);
    setCustomerSearch('');
    setShowCustomerDropdown(false);
  }, [preselectedCustomerId, dataLoading, customers, selectedCustomerId]);

  // Puesto mode — default to the walk-in counter customer once the list
  // loads (the puesto user can still switch to a known client via the
  // selector). The backend seeds "Puesto (mostrador)" idempotently.
  const walkInCustomer = useMemo(
    () => (isPuesto ? customers.find((c) => c.name === WALK_IN_CUSTOMER_NAME) ?? null : null),
    [isPuesto, customers],
  );

  useEffect(() => {
    if (!isPuesto || dataLoading || selectedCustomerId || !walkInCustomer) return;
    setSelectedCustomerId(walkInCustomer._id);
    setDeliveryAddress(walkInCustomer.address);
    setCustomerSearch('');
    setShowCustomerDropdown(false);
    setGeocodeError(null);
    setSelectingManual(false);
    setManualCenter(null);
    setManualHintLoading(false);
  }, [isPuesto, dataLoading, selectedCustomerId, walkInCustomer]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowCustomerDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Online indicator (sub-header pill)
  useEffect(() => onOfflineStatusChange(({ online: o }) => setOnline(o)), []);

  // Clean up the success-navigation timer on unmount
  useEffect(
    () => () => {
      if (successTimer.current) window.clearTimeout(successTimer.current);
    },
    []
  );

  /* ── Derived data ──────────────────────────── */

  const inventoryByProduct: Record<string, number> = {};
  for (const inv of inventory) {
    const pid = typeof inv.productId === 'string' ? inv.productId : inv.productId?._id;
    if (pid) inventoryByProduct[pid] = inv.quantity;
  }

  const filteredCustomers = customers.filter((c) => {
    if (!customerSearch) return true;
    return c.name.toLowerCase().includes(customerSearch.toLowerCase());
  });

  const selectedCustomer = customers.find((c) => c._id === selectedCustomerId);

  /** Effective line pricing: base (active) price, then the best applicable
   *  promo (mirrored client-side for display — the server re-resolves
   *  atomically at creation). */
  const itemPricing = (item: ItemRow): RowPricing => {
    const qty = item.quantity || 0;
    const basePrice = item.unitPrice;
    const promo = pickBestPromo(activePromos, item.productId, item.unit, qty, basePrice);
    const effective = promo ? applyPromoPrice(basePrice, promo, qty) : null;
    return {
      promo,
      basePrice,
      qty,
      unitPrice: effective ? effective.unitPrice : basePrice,
      subtotal: effective ? effective.subtotal : basePrice * qty,
    };
  };

  // Order-level subtotal (Σ line subtotals) BEFORE any bonification.
  const subtotal = items.reduce((sum, item) => sum + itemPricing(item).subtotal, 0);

  // Order-level bonification: parsed and validated live. The computed money
  // discount mirrors the backend (amount = value, or subtotal * value / 100).
  const bonificationNumeric = Number(bonificationValue.replace(',', '.'));
  const bonificationEntered = bonificationValue.trim() !== '';
  const bonificationError = (() => {
    if (!bonificationEntered) return null;
    if (!Number.isFinite(bonificationNumeric)) return 'Ingresá un número válido';
    if (bonificationNumeric <= 0) return 'La bonificación debe ser mayor a 0';
    if (bonificationType === 'amount' && bonificationNumeric > subtotal) {
      return `No puede superar el subtotal (${fmtMoney(subtotal)})`;
    }
    if (bonificationType === 'percent' && bonificationNumeric > 100) {
      return 'El porcentaje no puede superar 100%';
    }
    return null;
  })();
  const bonificationAmount =
    bonificationEntered && !bonificationError
      ? bonificationType === 'amount'
        ? round2(bonificationNumeric)
        : round2((subtotal * bonificationNumeric) / 100)
      : 0;

  // Order-level surcharge: parsed and validated live. The computed money amount
  // mirrors the backend (amount = value, or subtotal * value / 100).
  const surchargeNumeric = Number(surchargeValue.replace(',', '.'));
  const surchargeEntered = surchargeValue.trim() !== '';
  const surchargeError = (() => {
    if (!surchargeEntered) return null;
    if (!Number.isFinite(surchargeNumeric)) return 'Ingresá un número válido';
    if (surchargeNumeric <= 0) return 'El recargo debe ser mayor a 0';
    if (surchargeType === 'percent' && surchargeNumeric > 100) {
      return 'El porcentaje no puede superar 100%';
    }
    return null;
  })();
  const surchargeAmount =
    surchargeEntered && !surchargeError
      ? surchargeType === 'amount'
        ? round2(surchargeNumeric)
        : round2((subtotal * surchargeNumeric) / 100)
      : 0;

  /** Final amount to collect (subtotal − bonification + surcharge), never below zero. */
  const total = round2(Math.max(0, subtotal - bonificationAmount + surchargeAmount));

  /** Amount paid inline right now (0 when the order is left pending). */
  const payNowTotal = payNow ? totalOfLines(paymentLines) : 0;
  /** Amount still owed after the inline payment. */
  const pendingTotal = Math.max(0, round2(total - payNowTotal));
  const payNowExceedsTotal = payNow && payNowTotal > total + 0.005;

  // While "Paga ahora" is active and the user has NOT edited the lines, keep the
  // single line synced to the order total so the common case is a one-tap payment.
  useEffect(() => {
    if (!payNow || paymentLinesTouched.current) return;
    setPaymentLines([{ ...newPaymentLine(), amount: total > 0 ? String(total) : '' }]);
  }, [payNow, total]);

  /** Total maples across rows (unit-aware conversion). */
  const totalMaples = items.reduce((sum, item) => {
    if (!item.productId || item.quantity <= 0) return sum;
    const product = products.find((p) => p._id === item.productId);
    const mpc = maplesPerCajonFor(product);
    return sum + unitToMaples(item.quantity, item.unit, mpc);
  }, 0);

  /** Full cajones across rows (row maples ÷ its own cajón size, floored). */
  const totalCajones = items.reduce((sum, item) => {
    if (!item.productId || item.quantity <= 0) return sum;
    const product = products.find((p) => p._id === item.productId);
    const mpc = maplesPerCajonFor(product);
    return sum + Math.floor(unitToMaples(item.quantity, item.unit, mpc) / mpc);
  }, 0);

  // Equivalence banner text — real product values when they agree, fallback otherwise
  const bannerText = (() => {
    const cajonSizes = new Set(products.filter((p) => p.maplesPerCajon).map((p) => p.maplesPerCajon));
    const eggSizes = new Set(products.filter((p) => p.eggsPerMaple).map((p) => p.eggsPerMaple));
    if (cajonSizes.size === 1) {
      const c = [...cajonSizes][0] ?? 12;
      if (eggSizes.size === 1) {
        const e = [...eggSizes][0] ?? 30;
        return `1 Cajón = ${c} maples = ${c * e} huevos`;
      }
      return `1 Cajón = ${c} maples`;
    }
    return '1 Cajón = 12 maples (equivalencia estándar)';
  })();

  // Credit info computations (kept from the original page)
  const termDays = selectedCustomer?.creditConfig?.termDays ?? 0;
  const creditLimit = selectedCustomer?.creditConfig?.limit ?? 0;
  const hasCredit = termDays > 0 && creditLimit > 0;

  const computedDueDate = hasCredit ? (() => {
    const d = new Date();
    d.setDate(d.getDate() + termDays);
    return d;
  })() : null;

  const projectedBalance = hasCredit && outstanding
    ? outstanding.outstandingBalance + total
    : 0;
  const exceedsLimit = hasCredit && projectedBalance > creditLimit;

  /* ── Handlers ──────────────────────────────── */

  // Write — offline-aware create invalidates orders + linked domains.
  const createOrder = useCreateOrder();
  const submitting = createOrder.isPending;

  // Duplicate protection: the exact payload is kept so "Crear igual" can
  // resubmit it with forceDuplicate without re-reading the form, and a ref
  // lock blocks a double click before React re-renders `isPending`.
  const submitLock = useRef(false);
  const lastPayloadRef = useRef<CreateOrderPayload | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateRecordInfo | null>(null);

  const submitPayload = (payload: CreateOrderPayload) => {
    lastPayloadRef.current = payload;
    createOrder.mutate(payload, {
      onSuccess: (order) => {
        submitLock.current = false;
        lastPayloadRef.current = null;
        setDuplicate(null);
        setSuccess(true);
        successTimer.current = window.setTimeout(() => {
          navigate(`/orders/${order._id}`, { replace: true });
        }, 900);
      },
      onError: (err) => {
        submitLock.current = false;
        // Offline queued write: normal outcome, the OfflineBanner confirmed
        // it — there is no server id yet, so head back to the list.
        if (isOfflineQueuedError(err)) {
          setSuccess(true);
          successTimer.current = window.setTimeout(() => {
            navigate('/orders', { replace: true });
          }, 900);
          return;
        }
        const duplicateInfo = getDuplicateRecordInfo(err);
        if (duplicateInfo) {
          setDuplicate(duplicateInfo);
          return;
        }
        setFormError(err instanceof Error ? err.message : 'Error al crear la orden');
      },
    });
  };

  /** Resubmits the SAME payload with the explicit force flag. */
  const handleForceDuplicate = () => {
    const payload = lastPayloadRef.current;
    if (!payload || submitLock.current) return;
    submitLock.current = true;
    setDuplicate(null);
    submitPayload({ ...payload, forceDuplicate: true });
  };

  const handleViewDuplicate = () => {
    const info = duplicate;
    setDuplicate(null);
    submitLock.current = false;
    lastPayloadRef.current = null;
    if (info) navigate(`/orders/${info.existingId}`);
  };

  const handleCancelDuplicate = () => {
    setDuplicate(null);
    submitLock.current = false;
    lastPayloadRef.current = null;
  };

  /** Toggle "Paga ahora" / "Queda pendiente". Leaving resets the default seed. */
  const handlePayNowChange = (next: boolean) => {
    if (!next) paymentLinesTouched.current = false;
    setPayNow(next);
  };

  /** Marks the lines as user-edited so the total-sync effect backs off. */
  const handlePaymentLinesChange = (lines: PaymentLineDraft[]) => {
    paymentLinesTouched.current = true;
    setPaymentLines(lines);
  };

  const selectCustomer = (c: Customer) => {
    setSelectedCustomerId(c._id);
    setDeliveryAddress(c.address);
    // Auto-fill the delivery point from the customer's geocoded location
    setDeliveryLocation(customerLocationToLatLng(c.location));
    setGeocodeError(null);
    setSelectingManual(false);
    setManualCenter(null);
    setManualHintLoading(false);
    setCustomerSearch('');
    setShowCustomerDropdown(false);
  };

  const clearCustomer = () => {
    setSelectedCustomerId('');
    setCustomerSearch('');
    setDeliveryAddress('');
    setDeliveryLocation(null);
    setGeocodeError(null);
    setSelectingManual(false);
    setManualCenter(null);
    setManualHintLoading(false);
  };

  /** Per-row unit: re-units ONE row, re-prices it for the new unit and RESETS
   *  its quantity to 0 — a quantity entered in one unit can never silently
   *  become another (which would multiply that line ~Nx). Each row is
   *  independent, so one line can be maples and another cajones in the order. */
  const setRowUnit = (index: number, unit: PriceUnit) => {
    setItems((rows) => rows.map((r, i) => {
      if (i !== index || r.unit === unit) return r;
      return {
        ...r,
        unit,
        quantity: 0,
        unitPrice: priceForUnit(priceMap[r.productId], unit) ?? 0,
      };
    }));
  };

  const adjustQty = (index: number, delta: number) => {
    setItems((rows) => rows.map((r, i) =>
      i === index ? { ...r, quantity: Math.max(0, r.quantity + delta) } : r
    ));
  };

  const addManualRow = () => {
    setItems((rows) => [...rows, { productId: '', quantity: 0, unit: 'maple', unitPrice: 0 }]);
  };

  const removeManualRow = (index: number) => {
    setItems((rows) => rows.filter((_, i) => i !== index));
  };

  const updateManualProduct = (index: number, productId: string) => {
    setItems((rows) => rows.map((r, i) => {
      if (i !== index) return r;
      const prices = priceMap[productId];
      // Keep the current unit when it has a price; otherwise switch to the
      // first unit that does, so the row never lands on an unusable zero-price
      // state.
      let unit: PriceUnit = r.unit;
      if (priceForUnit(prices, unit) == null) {
        const fallback = PRODUCT_UNIT_OPTIONS.find((opt) => priceForUnit(prices, opt.value) != null);
        if (fallback) unit = fallback.value;
      }
      return {
        ...r,
        productId,
        quantity: 0,
        unit,
        unitPrice: priceForUnit(prices, unit) ?? 0,
      };
    }));
  };

  const handleGeocode = async () => {
    const address = deliveryAddress.trim();
    if (!address) return;
    setGeocoding(true);
    setGeocodeError(null);
    setSelectingManual(false);
    try {
      const result = await geocode(address);
      setDeliveryLocation({ lat: result.lat, lng: result.lng });
    } catch (err) {
      setDeliveryLocation(null);
      setGeocodeError(
        err instanceof ApiError
          ? err.status === 404
            ? 'Dirección no encontrada'
            : err.status === 502
              ? 'No se pudo contactar el servicio de mapas'
              : err.message
          : 'Error al buscar la dirección',
      );
    } finally {
      setGeocoding(false);
    }
  };

  /** Switches the map to click-to-select mode (fallback when geocoding fails). */
  const handleStartManual = () => {
    setSelectingManual(true);
    setDeliveryLocation(null);
    setGeocodeError(null);
    setManualCenter(null);
    // Best-effort: center the manual map near the selected customer's
    // city + province (or the typed address as fallback) instead of the
    // default center. The full address may fail to geocode, but the
    // city + province almost always resolves.
    setManualHintLoading(true);
    void (async () => {
      const detail = selectedCustomer?.addressDetail;
      let hint: LatLng | null = null;
      if (detail?.city || detail?.province) {
        hint = await geocodeCityProvince(detail.city ?? '', detail.province ?? '');
      }
      if (!hint) {
        const addr = deliveryAddress.trim();
        if (addr) {
          try {
            const result = await geocode(addr);
            hint = { lat: result.lat, lng: result.lng };
          } catch {
            hint = null; // fall back to default center
          }
        }
      }
      setManualCenter(hint);
      setManualHintLoading(false);
    })();
  };

  /**
   * "Mi ubicación" → marks the device GPS position on the map and fills the
   * delivery address from it (reverse geocode). GPS failure NEVER blocks the
   * form: it only shows an inline message and the user keeps the manual map /
   * typed-address fallback.
   */
  const handleUseMyLocation = () => {
    setLocateError(null);
    if (!navigator.geolocation) {
      setLocateError('No pudimos obtener tu ubicación — marcá el punto en el mapa o completá la dirección');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        // Show the map with the GPS pin, mirroring the manual-mark flow.
        setSelectingManual(true);
        setDeliveryLocation(point);
        setGeocodeError(null);
        setManualCenter(null);
        setManualHintLoading(false);
        setLocating(false);
        // Best-effort reverse geocode → fill the free-text address (editable).
        void (async () => {
          try {
            const result = await reverseGeocode(point.lat, point.lng);
            const streetLine = [result.street, result.number].filter(Boolean).join(' ');
            const composed = [streetLine, result.neighborhood, result.city, result.province]
              .filter(Boolean)
              .join(', ');
            const address = composed || result.displayName || '';
            if (address) setDeliveryAddress(address);
          } catch {
            // Non-blocking: keep the pin and whatever address was already typed.
          }
        })();
      },
      () => {
        setLocateError('No pudimos obtener tu ubicación — marcá el punto en el mapa o completá la dirección');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    // Hard lock: a double click cannot fire two mutations even before the
    // mutation state re-renders. Released on every exit path.
    if (submitLock.current) return;
    submitLock.current = true;
    setFormError(null);

    if (!selectedCustomerId) {
      setFormError('Seleccioná un cliente');
      submitLock.current = false;
      return;
    }

    const validItems = items.filter((item) => item.productId && item.quantity > 0);
    if (validItems.length === 0) {
      setFormError('Agregá al menos un producto con cantidad');
      submitLock.current = false;
      return;
    }

    // Client-side price guard: the backend rejects items whose unit has no
    // active price (404), so catch it here with a clearer message.
    for (const item of validItems) {
      if (!(item.unitPrice > 0)) {
        const product = products.find((p) => p._id === item.productId);
        setFormError(`"${product?.displayName ?? 'Producto'}" no tiene precio activo en ${unitLabel(item.unit, { plural: true }).toLowerCase()}`);
        submitLock.current = false;
        return;
      }
    }

    // Client-side stock gate: hard-block the submit when the rows for a product
    // request more maples than the warehouse has. A product can appear in
    // several rows, so each line is checked against what the OTHER lines leave.
    // Relaxed only by "Permitir preventa".
    const requestedByProduct = new Map<string, number>();
    for (const item of validItems) {
      const itemProduct = products.find((p) => p._id === item.productId);
      const maples = unitToMaples(item.quantity, item.unit, maplesPerCajonFor(itemProduct));
      requestedByProduct.set(item.productId, (requestedByProduct.get(item.productId) ?? 0) + maples);
    }
    for (const item of validItems) {
      const product = products.find((p) => p._id === item.productId);
      const thisLineMaples = unitToMaples(
        item.quantity,
        item.unit,
        maplesPerCajonFor(product),
      );
      const otherLinesMaples = Math.max(
        0,
        (requestedByProduct.get(item.productId) ?? 0) - thisLineMaples,
      );
      const availableMaples = Math.max(
        0,
        (inventoryByProduct[item.productId] ?? 0) - otherLinesMaples,
      );
      const stockError = evaluateStock(item, product, availableMaples, canPreSale && allowPreSale).error;
      if (stockError) {
        setFormError(`"${product?.displayName ?? 'Producto'}": ${stockError}`);
        submitLock.current = false;
        return;
      }
    }

    // Client-side bonification gate: block submit while the discount is invalid
    // (the backend re-validates against the priced subtotal).
    if (bonificationError) {
      setFormError(bonificationError);
      submitLock.current = false;
      return;
    }

    // Client-side surcharge gate: block submit while the surcharge is invalid
    // (the backend re-validates against the priced subtotal).
    if (surchargeError) {
      setFormError(surchargeError);
      submitLock.current = false;
      return;
    }

    // "Paga ahora": register the inline payment line(s) as REAL Payment docs.
    // Σ must be > 0 and ≤ total — the backend re-validates before creating.
    let initialPayments: InitialPaymentPayload[] | undefined;
    let effectivePreference: PaymentPreference = paymentMethod;
    if (payNow) {
      const lines = toPaymentLines(paymentLines);
      if (lines.length === 0) {
        setFormError('Ingresá al menos un monto para pagar ahora');
        submitLock.current = false;
        return;
      }
      const paidNow = round2(lines.reduce((sum, line) => sum + line.amount, 0));
      if (paidNow > total + 0.005) {
        setFormError(`El pago no puede superar el total (${fmtMoney(total)})`);
        submitLock.current = false;
        return;
      }
      initialPayments = lines;
      // The preference mirrors how the order settles: fully paid now with one
      // method keeps cash/transfer; a partial or split payment is 'partial'.
      effectivePreference =
        paidNow + 0.005 >= total && lines.length === 1
          ? lines[0]?.method === 'cash'
            ? 'cash'
            : 'transfer'
          : 'partial';
    }

    const payload: CreateOrderPayload = {
        customerId: selectedCustomerId,
        channel,
        deliveryAddress: deliveryAddress.trim(),
        deliveryNotes: deliveryNotes.trim() || undefined,
        deliveryLocation: deliveryLocation ?? undefined,
        // Business/sale date — when the sale happened (reports group by this).
        orderDate: orderDate || undefined,
        // Stall sales happen at the counter — no delivery date to plan.
        deliveryDate: isPuesto ? undefined : deliveryDate || undefined,
        // Real payment preference — no longer captured into the notes.
        paymentPreference: effectivePreference,
        // Canal de venta — where the sale was made (default 'reparto').
        salesChannel,
        // Initial status — 'delivered' means the stock leaves the warehouse now.
        status: initialStatus,
        // Order-level bonification — omitted when empty/zero (previous behavior).
        ...(bonificationEntered && !bonificationError && bonificationAmount > 0
          ? { bonification: { type: bonificationType, value: bonificationNumeric } }
          : {}),
        // Order-level surcharge — omitted when empty/zero (previous behavior).
        ...(surchargeEntered && !surchargeError && surchargeAmount > 0
          ? { surcharge: { type: surchargeType, value: surchargeNumeric } }
          : {}),
        ...(initialPayments ? { initialPayments } : {}),
        items: validItems.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unit: item.unit ?? 'maple',
        })),
      };

      submitPayload(payload);
  };

  if (dataLoading) {
    return <LoadingState label="Preparando el formulario…" />;
  }

  // One row per added product — the order starts empty and grows as the user
  // adds products (single row component handles everything).
  const rows = items.map((row, index) => ({ row, index }));

  // Total maples requested per product across all rows. A product may repeat
  // with different units, so stock must be evaluated in aggregate.
  const requestedByProduct = new Map<string, number>();
  for (const item of items) {
    if (!item.productId || item.quantity <= 0) continue;
    const itemProduct = products.find((p) => p._id === item.productId);
    const maples = unitToMaples(item.quantity, item.unit, maplesPerCajonFor(itemProduct));
    requestedByProduct.set(item.productId, (requestedByProduct.get(item.productId) ?? 0) + maples);
  }

  // Whether any product has an active price in any unit (drives the empty-state
  // link to the Stock page when nothing is sellable yet).
  const hasAnyPricedProduct = products.some(
    (p) =>
      priceMap[p._id]?.maple != null ||
      priceMap[p._id]?.medio_cajon != null ||
      priceMap[p._id]?.cajon != null,
  );

  const preSaleEnabled = canPreSale && allowPreSale;

  const goToPrices = () => navigate('/products');

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      {/* 1 — Sub-header: round back button + title + status pill */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: 3 }}>
        <IconButton
          onClick={goBack}
          aria-label="Volver a órdenes"
          sx={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            bgcolor: 'surfaceContainer',
            color: 'onSurface',
            border: 1,
            borderColor: 'outlineVariant',
            boxShadow: 1,
            '&:hover': { bgcolor: 'surfaceContainerHigh' },
          }}
        >
          <IconArrowBack size={22} />
        </IconButton>
        <Box sx={{ flex: 1, minWidth: 0, mt: 0.25 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: '-0.02em', color: 'onSurface', lineHeight: 1.2 }}>
            {isPuesto ? 'Vender en el Puesto' : 'Nuevo Pedido'}
          </Typography>
          <Typography variant="caption" color="onSurfaceVariant" sx={{ display: 'block', mt: 0.25 }}>
            {isPuesto ? 'Venta de mostrador — efectivo o transferencia' : 'Asignación rápida de stock y cliente'}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.75, flexShrink: 0 }}>
          <Box sx={{ px: 1.5, py: 0.5, borderRadius: 9999, bgcolor: 'surfaceContainerHigh' }}>
            <Typography variant="caption" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'primary.main', letterSpacing: '0.02em' }}>
              #ORD
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: online ? 'success.main' : 'outline', flexShrink: 0 }} />
            <Typography variant="caption" color="onSurfaceVariant" sx={{ fontWeight: 600 }}>
              {online ? 'En línea' : 'Sin conexión'}
            </Typography>
          </Box>
        </Box>
      </Box>

      <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {formError && <Alert severity="error">{formError}</Alert>}

        {/* ── Card 1 — Cliente ─────────────────────────── */}
        <MuiCard>
          <SectionHeader
            icon={<IconStore size={20} />}
            title={selectedCustomer ? `Cliente ${selectedCustomer.type === 'B2C' ? 'Minorista' : 'Mayorista'}` : 'Cliente'}
            iconSx={{ bgcolor: 'surfaceContainerLow', color: 'primary.main' }}
            actions={
              selectedCustomer ? (
                <MuiButton variant="ghost" size="sm" onClick={clearCustomer} startIcon={<IconSwapHoriz size={16} />}>
                  Cambiar
                </MuiButton>
              ) : undefined
            }
          />

          {selectedCustomer ? (
            <Box sx={{ bgcolor: 'surfaceContainerLow', borderRadius: '12px', border: 1, borderColor: 'outlineVariant', p: 2 }}>
              {/* Identity row: name + badge + account pill */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedCustomer.name}
                </Typography>
                <MuiChip
                  label={selectedCustomer.type}
                  size="small"
                  sx={{
                    bgcolor: selectedCustomer.type === 'B2B' ? 'primaryFixed' : 'secondaryContainer',
                    color: selectedCustomer.type === 'B2B' ? 'onPrimaryFixed' : 'onSecondaryContainer',
                  }}
                />
                <Box sx={{ ml: 'auto', px: 1.25, py: 0.375, borderRadius: 9999, bgcolor: 'surfaceContainerHighest', flexShrink: 0 }}>
                  <Typography variant="caption" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'onSurfaceVariant' }}>
                    Cta. #{selectedCustomer._id.slice(-4).toUpperCase()}
                  </Typography>
                </Box>
              </Box>

              {/* Address line */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 1, minWidth: 0 }}>
                <IconLocation size={14} color="var(--mui-palette-onSurfaceVariant)" style={{ flexShrink: 0 }} />
                <Typography variant="body2" color="onSurfaceVariant" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedCustomer.address || 'Sin dirección cargada'}
                </Typography>
              </Box>

              {/* 2-col grid: contacto directo | estado cuenta */}
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mt: 1.5 }}>
                <Box sx={{ p: 1.25, borderRadius: '10px', bgcolor: 'surfaceContainerLowest', border: 1, borderColor: 'outlineVariant', minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                    <IconCustomer size={14} color="var(--mui-palette-onSurfaceVariant)" />
                    <Typography variant="caption" color="onSurfaceVariant" sx={{ fontWeight: 600 }}>
                      Contacto Directo
                    </Typography>
                  </Box>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: 'onSurface', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedCustomer.name}
                  </Typography>
                  <Typography variant="caption" color="onSurfaceVariant">
                    {selectedCustomer.phone}
                  </Typography>
                </Box>
                <Box sx={{ p: 1.25, borderRadius: '10px', bgcolor: 'surfaceContainerLowest', border: 1, borderColor: 'outlineVariant', minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                    <IconCircleCheck size={14} color="var(--mui-palette-onSurfaceVariant)" />
                    <Typography variant="caption" color="onSurfaceVariant" sx={{ fontWeight: 600 }}>
                      Estado Cuenta
                    </Typography>
                  </Box>
                  {outstanding === null ? (
                    <Typography variant="body2" sx={{ fontWeight: 700, color: 'onSurfaceVariant' }}>
                      Sin datos
                    </Typography>
                  ) : outstanding.outstandingBalance > 0 ? (
                    <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'error.main' }}>
                      {fmtMoney(outstanding.outstandingBalance)}
                    </Typography>
                  ) : (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <IconCircleCheck size={16} color="var(--mui-palette-success-main)" />
                      <Typography variant="body2" sx={{ fontWeight: 700, color: 'success.main', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                        $0.00 al día
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Box>
            </Box>
          ) : (
            <>
              <Box sx={{ position: 'relative', mb: 2 }} ref={dropdownRef}>
                <MuiTextField
                  placeholder="Buscar cliente por nombre..."
                  value={customerSearch}
                  onChange={(e) => {
                    setCustomerSearch(e.target.value);
                    setSelectedCustomerId('');
                    setShowCustomerDropdown(true);
                  }}
                  onFocus={() => setShowCustomerDropdown(true)}
                  fullWidth
                  slotProps={{
                    htmlInput: { id: 'neworder-customer-search' },
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <IconSearch size={18} />
                        </InputAdornment>
                      ),
                    },
                  }}
                />
                {showCustomerDropdown && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      bgcolor: 'background.paper',
                      border: 1,
                      borderColor: 'divider',
                      borderRadius: 1,
                      boxShadow: 3,
                      maxHeight: 200,
                      overflowY: 'auto',
                      zIndex: 100,
                    }}
                  >
                    {filteredCustomers.length === 0 ? (
                      <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
                        No se encontraron clientes
                      </Typography>
                    ) : (
                      filteredCustomers.map((c) => (
                        <Box
                          key={c._id}
                          component="button"
                          type="button"
                          onClick={() => selectCustomer(c)}
                          sx={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            width: '100%',
                            p: 1.5,
                            px: 2,
                            background: 'none',
                            border: 'none',
                            borderBottom: 1,
                            borderColor: 'divider',
                            cursor: 'pointer',
                            textAlign: 'left',
                            '&:hover': { bgcolor: 'action.hover' },
                          }}
                        >
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>{c.name}</Typography>
                          <Typography variant="caption" color="text.secondary">{c.type} · {c.phone}</Typography>
                        </Box>
                      ))
                    )}
                  </Box>
                )}
              </Box>

              {/* Empty state — Seleccioná un cliente */}
              {!showCustomerDropdown && (
                <Box
                  onClick={() => {
                    const el = document.getElementById('neworder-customer-search');
                    if (el) {
                      el.focus();
                      setShowCustomerDropdown(true);
                    }
                  }}
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 1,
                    p: 3,
                    borderRadius: '12px',
                    border: 1,
                    borderStyle: 'dashed',
                    borderColor: 'outlineVariant',
                    bgcolor: 'surfaceContainerLow',
                    cursor: 'pointer',
                    textAlign: 'center',
                  }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 44,
                      height: 44,
                      borderRadius: '12px',
                      bgcolor: 'surfaceContainerHighest',
                      color: 'onSurfaceVariant',
                    }}
                  >
                    <IconStore size={22} />
                  </Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'onSurface' }}>
                    Seleccioná un cliente
                  </Typography>
                  <Typography variant="caption" color="onSurfaceVariant">
                    Buscá por nombre para asignar el pedido y ver su estado de cuenta.
                  </Typography>
                  <MuiButton variant="secondary" size="sm" startIcon={<IconSearch size={16} />} sx={{ mt: 0.5 }}>
                    Buscar cliente
                  </MuiButton>
                </Box>
              )}
            </>
          )}

          {/* Fecha del pedido — the business date (used by every date-based view) */}
          <Box sx={{ mt: 2.5 }}>
            <Typography variant="caption" color="onSurfaceVariant" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, display: 'block', mb: 1 }}>
              Datos del Pedido
            </Typography>
            <MuiTextField
              type="date"
              size="small"
              label="Fecha del pedido"
              value={orderDate}
              onChange={(e) => handleOrderDateChange(e.target.value)}
              fullWidth
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <IconEvent size={18} />
                    </InputAdornment>
                  ),
                },
              }}
              sx={{
                // Matches the delivery plan field: ~44px tall, surface-container bg, rounded 12px.
                '& .MuiOutlinedInput-root.MuiOutlinedInput-root': {
                  height: 44,
                  bgcolor: 'surfaceContainer',
                },
              }}
            />
            <Typography variant="caption" color="onSurfaceVariant" sx={{ display: 'block', mt: 0.75 }}>
              Fecha real de la venta — es el día en que se reporta el pedido.
            </Typography>

            {/* Estado inicial — a sale can be entered as already delivered, which
                consumes stock immediately on the backend. */}
            <Box sx={{ mt: 2.5 }}>
              <Typography variant="caption" color="onSurfaceVariant" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, display: 'block', mb: 1 }}>
                Estado inicial
              </Typography>
              <Box
                role="group"
                aria-label="Estado inicial del pedido"
                sx={{
                  display: 'flex',
                  width: 'fit-content',
                  maxWidth: '100%',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 0.5,
                  bgcolor: 'surfaceContainer',
                  borderRadius: 9999,
                  p: 0.5,
                }}
              >
                {([
                  { value: 'pending', label: 'Pendiente de entrega' },
                  { value: 'delivered', label: 'Ya entregado' },
                ] as const).map((opt) => {
                  const active = initialStatus === opt.value;
                  return (
                    <Box
                      key={opt.value}
                      component="button"
                      type="button"
                      onClick={() => setInitialStatus(opt.value)}
                      aria-pressed={active}
                      sx={{
                        px: 2,
                        py: 0.75,
                        borderRadius: 9999,
                        border: 'none',
                        cursor: 'pointer',
                        bgcolor: active ? 'surfaceContainerLowest' : 'transparent',
                        color: active ? 'primary.main' : 'onSurfaceVariant',
                        fontWeight: 700,
                        fontSize: '0.8125rem',
                        fontFamily: 'inherit',
                        whiteSpace: 'nowrap',
                        boxShadow: active ? 1 : 'none',
                        transition: 'background-color 0.15s, box-shadow 0.15s',
                      }}
                    >
                      {opt.label}
                    </Box>
                  );
                })}
              </Box>
              {initialStatus === 'delivered' && (
                <Alert severity="warning" sx={{ mt: 1.5 }}>
                  Se va a descontar el stock ahora.
                </Alert>
              )}
            </Box>
          </Box>

          {/* Planificación de Entrega — hidden for stall sales (counter, no delivery) */}
          {!isPuesto && (
            <Box sx={{ mt: 2.5 }}>
              <Typography variant="caption" color="onSurfaceVariant" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, display: 'block', mb: 1 }}>
                Planificación de Entrega
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr' }, gap: 1.5 }}>
                <MuiTextField
                  type="date"
                  size="small"
                  label="Día de Entrega"
                  placeholder="Fecha de entrega"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <IconEvent size={18} />
                        </InputAdornment>
                      ),
                    },
                  }}
                  sx={{
                    // Matches the PlanCell look: ~44px tall, surface-container bg, rounded 12px (wrapper).
                    '& .MuiOutlinedInput-root.MuiOutlinedInput-root': {
                      height: 44,
                      bgcolor: 'surfaceContainer',
                    },
                  }}
                />
                <PlanCell
                  icon={channelIcons[channel]}
                  label="Turno/Franja"
                  value={channelLabels[channel]}
                  withChevron
                  onClick={(e) => setChannelMenuAnchor(e.currentTarget)}
                />
              </Box>
            </Box>
          )}

          {/* Credit info (kept from the original page, restyled compact) — hidden for stall sales */}
          {!isPuesto && selectedCustomer && hasCredit && (
            <Box sx={{ mt: 2.5 }}>
              <Typography variant="caption" color="onSurfaceVariant" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, display: 'block', mb: 1 }}>
                Crédito disponible
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                <CreditStat label="Límite" value={fmtMoney(creditLimit)} />
                <CreditStat
                  label="Saldo pendiente"
                  value={fmtMoney(outstanding?.outstandingBalance ?? 0)}
                  tone={outstanding && outstanding.outstandingBalance > 0 ? 'warning' : 'ok'}
                />
                <CreditStat label="Proyectado" value={fmtMoney(projectedBalance)} tone={exceedsLimit ? 'error' : 'ok'} />
                <CreditStat
                  label="Vencimiento"
                  value={computedDueDate ? computedDueDate.toLocaleDateString('es-AR') : '—'}
                />
              </Box>
              {exceedsLimit && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 1.5, px: 1.5, py: 1, borderRadius: '10px', bgcolor: 'errorContainer', color: 'onErrorContainer' }}>
                  <IconWarning size={16} />
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    Supera el límite por {fmtMoney(projectedBalance - creditLimit)}
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </MuiCard>

        {/* Channel picker menu (Turno/Franja) — hidden for stall sales (channel is forced to walk_in) */}
        {!isPuesto && (
          <Menu anchorEl={channelMenuAnchor} open={Boolean(channelMenuAnchor)} onClose={() => setChannelMenuAnchor(null)}>
            {(Object.keys(channelLabels) as OrderChannel[]).map((ch) => (
              <MenuItem
                key={ch}
                selected={ch === channel}
                onClick={() => {
                  setChannel(ch);
                  setChannelMenuAnchor(null);
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>{channelIcons[ch]}{channelLabels[ch]}</Box>
              </MenuItem>
            ))}
          </Menu>
        )}

        {/* ── Card 2 — Carga de Mercadería ──────────────── */}
        <MuiCard>
          <SectionHeader
            icon={<IconEgg size={20} />}
            title="Carga de Mercadería"
            actions={
              <Typography
                variant="caption"
                color="onSurfaceVariant"
                sx={{ fontWeight: 600, flexShrink: 0, display: { xs: 'none', sm: 'block' } }}
              >
                Unidad por producto
              </Typography>
            }
          />

          {/* Equivalence banner */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              px: 2,
              py: 1.5,
              mb: 2.5,
              borderRadius: '12px',
              bgcolor: 'color-mix(in srgb, var(--mui-palette-primaryFixed) 30%, transparent)',
              color: 'onPrimaryFixed',
            }}
          >
            <IconInfo size={18} style={{ flexShrink: 0 }} />
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{bannerText}</Typography>
          </Box>

          {/* Preventa escape hatch — admin/superadmin only. Relaxes ONLY the
              stock gate (the price gate is always enforced). */}
          {canPreSale && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                flexWrap: 'wrap',
                px: 1.5,
                py: 1,
                mb: 2.5,
                borderRadius: '12px',
                bgcolor: 'surfaceContainer',
                border: 1,
                borderColor: preSaleEnabled ? 'warning.main' : 'outlineVariant',
              }}
            >
              <FormControlLabel
                control={
                  <Switch
                    checked={allowPreSale}
                    onChange={(e) => setAllowPreSale(e.target.checked)}
                    size="small"
                  />
                }
                label="Permitir preventa"
                slotProps={{ typography: { sx: { fontWeight: 600, color: 'onSurface' } } }}
                sx={{ mr: 0 }}
              />
              {preSaleEnabled && (
                <MuiChip
                  size="small"
                  color="warning"
                  statusIcon
                  label="Vendiendo sin stock"
                  sx={{ ml: 'auto' }}
                />
              )}
            </Box>
          )}

          {/* Product rows — the order starts empty; one row per added product */}
          {rows.length === 0 ? (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                p: 3,
                gap: 1,
                bgcolor: 'surfaceContainerLow',
                borderRadius: '16px',
                border: 1,
                borderStyle: 'dashed',
                borderColor: 'outlineVariant',
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 48,
                  height: 48,
                  borderRadius: '14px',
                  bgcolor: 'primaryContainer',
                  color: 'onPrimaryContainer',
                }}
              >
                <IconEgg size={24} />
              </Box>
              <Typography variant="body2" sx={{ fontWeight: 700, color: 'onSurface' }}>
                Agregá un producto al pedido
              </Typography>
              <Typography variant="caption" color="onSurfaceVariant" sx={{ display: 'block' }}>
                Elegí el producto y la cantidad para empezar la carga de mercadería.
              </Typography>
              <MuiButton
                variant="primary"
                size="sm"
                onClick={addManualRow}
                startIcon={<IconPlus size={16} />}
                sx={{ mt: 1 }}
              >
                Agregar Producto
              </MuiButton>
              {!hasAnyPricedProduct && (
                <MuiButton
                  variant="ghost"
                  size="sm"
                  onClick={goToPrices}
                  startIcon={<IconMoney size={14} />}
                  sx={{ minHeight: 0, py: 0.25 }}
                >
                  Cargar precios en Productos
                </MuiButton>
              )}
            </Box>
          ) : (
            <>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {rows.map(({ row, index }) => (
                  <ManualRow
                    key={`row-${index}`}
                    row={row}
                    products={products}
                    priceMap={priceMap}
                    inventoryByProduct={inventoryByProduct}
                    requestedByProduct={requestedByProduct}
                    unit={row.unit}
                    pricing={itemPricing(row)}
                    allowPreSale={preSaleEnabled}
                    onSelectProduct={(productId) => updateManualProduct(index, productId)}
                    onAdjust={(delta) => adjustQty(index, delta)}
                    onRemove={() => removeManualRow(index)}
                    onUnitChange={(u) => setRowUnit(index, u)}
                    onGoToPrices={goToPrices}
                  />
                ))}
              </Box>

              {/* Agregar Producto */}
              <MuiButton
                variant="secondary"
                size="md"
                fullWidth
                onClick={addManualRow}
                startIcon={<IconPlus size={18} />}
                sx={{ mt: 2.5, minHeight: 48 }}
              >
                Agregar Otro Producto
              </MuiButton>
            </>
          )}
        </MuiCard>

        {/* ── Card 3 — Logística y Despacho ───────────────
            Hidden for stall sales: no delivery address/map, no channel
            pills (forced 'puesto'), no route assignment. */}
        {!isPuesto && (
        <MuiCard>
          <SectionHeader icon={<IconTruck size={20} />} title="Logística y Despacho" />

          <MuiTextField
            label="Dirección de entrega"
            value={deliveryAddress}
            onChange={(e) => {
              setDeliveryAddress(e.target.value);
              setDeliveryLocation(null);
              setGeocodeError(null);
              setSelectingManual(false);
              setManualCenter(null);
              setManualHintLoading(false);
            }}
            fullWidth
            placeholder={selectedCustomer ? 'Se usa la dirección del cliente' : 'Dirección donde se entrega'}
            slotProps={{
              input: { startAdornment: <IconLocation size={16} style={{ marginRight: 8, color: 'var(--mui-palette-onSurfaceVariant)' }} /> },
            }}
            sx={{ mb: 2 }}
          />

          {/* Buscar en mapa — geocode the address and show a single-marker map */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <MuiButton
              variant="secondary"
              size="sm"
              onClick={handleGeocode}
              isLoading={geocoding}
              disabled={!deliveryAddress.trim() || geocoding}
              startIcon={<IconMapPin size={16} />}
            >
              Buscar en mapa
            </MuiButton>
            {/* Device GPS — marks the exact current point (delivery / pickup) */}
            <MuiButton
              variant="secondary"
              size="sm"
              onClick={handleUseMyLocation}
              isLoading={locating}
              startIcon={<IconMyLocation size={16} />}
            >
              Mi ubicación
            </MuiButton>
            {deliveryLocation && (
              <Typography variant="caption" color="success.main" sx={{ fontWeight: 600 }}>
                Ubicación confirmada
              </Typography>
            )}
          </Box>

          {/* Device GPS — loading + non-blocking error message */}
          {locating && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">
                Obteniendo ubicación…
              </Typography>
            </Box>
          )}

          {locateError && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {locateError}
            </Alert>
          )}

          {geocodeError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {geocodeError}
            </Alert>
          )}

          {geocodeError && (
            <MuiButton
              variant="ghost"
              size="sm"
              onClick={handleStartManual}
              startIcon={<IconMapPin size={14} />}
              sx={{ mb: 2 }}
            >
              Marcar en el mapa manualmente
            </MuiButton>
          )}

          {/* Manual selection — success chip + remove action once a point exists */}
          {selectingManual && deliveryLocation && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
              <MuiChip
                color="success"
                size="small"
                variant="filled"
                icon={<IconMapPin size={14} />}
                label={`Punto marcado: ${deliveryLocation.lat.toFixed(5)}, ${deliveryLocation.lng.toFixed(5)}`}
              />
              <MuiButton
                variant="ghost"
                size="sm"
                onClick={() => setDeliveryLocation(null)}
                startIcon={<IconX size={14} />}
              >
                Quitar punto
              </MuiButton>
            </Box>
          )}

          {/* Manual hint loading — brief "Buscando la zona..." while geocoding city + province */}
          {selectingManual && manualHintLoading && (
            <Box
              sx={{
                height: 220,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: m3Shape.medium,
                border: 1,
                borderColor: 'outlineVariant',
                bgcolor: 'surfaceContainerLow',
                mb: 3,
              }}
            >
              <Typography variant="body2" color="onSurfaceVariant">
                Buscando la zona...
              </Typography>
            </Box>
          )}

          {(deliveryLocation || (selectingManual && !manualHintLoading)) && (
            <Box sx={{ mb: 3 }}>
              <MapView
                markers={!selectingManual && deliveryLocation ? [{ lat: deliveryLocation.lat, lng: deliveryLocation.lng }] : []}
                selectable={selectingManual}
                selectedMarker={selectingManual ? deliveryLocation : null}
                onSelect={
                  selectingManual
                    ? (marker) => setDeliveryLocation({ lat: marker.lat, lng: marker.lng })
                    : undefined
                }
                selectHint="Tocá el mapa para marcar la dirección de entrega"
                height={220}
                center={
                  selectingManual
                    ? (customerLocationToLatLng(selectedCustomer?.location) ?? manualCenter ?? undefined)
                    : undefined
                }
              />
            </Box>
          )}

          <MuiTextField
            label="Notas de envío (opcional)"
            value={deliveryNotes}
            onChange={(e) => setDeliveryNotes(e.target.value)}
            fullWidth
            placeholder="Referencias, horario, instrucciones al repartidor..."
            multiline
            rows={2}
          />

          {/* Canal de Venta — where the sale was made (distinct from the contact channel) */}
          <Box sx={{ mt: 2.5, pt: 2.5, borderTop: 1, borderColor: 'outlineVariant' }}>
            <Typography variant="caption" color="onSurfaceVariant" sx={{ display: 'block', mb: 1.5, fontWeight: 600 }}>
              Canal de Venta
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' }, gap: 1.5 }}>
              {salesChannelOptions.map((opt) => {
                const active = salesChannel === opt.value;
                return (
                  <Box
                    key={opt.value}
                    component="button"
                    type="button"
                    onClick={() => setSalesChannel(opt.value)}
                    aria-pressed={active}
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 0.75,
                      p: 1.5,
                      borderRadius: '12px',
                      border: 1,
                      cursor: 'pointer',
                      borderColor: active ? 'primary.main' : 'outlineVariant',
                      bgcolor: active ? 'color-mix(in srgb, var(--mui-palette-primary-main) 10%, transparent)' : 'surfaceContainer',
                      color: active ? 'primary.main' : 'onSurfaceVariant',
                      fontWeight: 700,
                      fontSize: '0.8125rem',
                      fontFamily: 'inherit',
                      transition: 'background-color 0.15s, border-color 0.15s',
                      '&:hover': { borderColor: active ? 'primary.main' : 'outline' },
                    }}
                  >
                    {opt.icon}
                    {opt.label}
                  </Box>
                );
              })}
            </Box>
          </Box>

          {/* Asignación de reparto — honest display (route is created later) */}
          <Box sx={{ mt: 2.5, pt: 2.5, borderTop: 1, borderColor: 'outlineVariant' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
              <IconTruck size={18} color="var(--mui-palette-onSurfaceVariant)" style={{ flexShrink: 0 }} />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" color="onSurfaceVariant" sx={{ display: 'block' }}>
                  Unidad de Reparto Asignada
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 700, color: 'onSurface' }}>
                  Sin asignar
                </Typography>
                <Typography variant="caption" color="onSurfaceVariant" sx={{ display: 'block' }}>
                  Se asigna al crear la ruta
                </Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, borderRadius: '12px', bgcolor: 'surfaceContainerLow', border: 1, borderColor: 'outlineVariant' }}>
                <IconFlag size={18} color="var(--mui-palette-onSurfaceVariant)" style={{ flexShrink: 0 }} />
                <Box>
                  <Typography variant="caption" color="onSurfaceVariant" sx={{ display: 'block' }}>Prioridad</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: 'onSurface' }}>Normal</Typography>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, borderRadius: '12px', bgcolor: 'surfaceContainerLow', border: 1, borderColor: 'outlineVariant' }}>
                <IconBox size={18} color="var(--mui-palette-onSurfaceVariant)" style={{ flexShrink: 0 }} />
                <Box>
                  <Typography variant="caption" color="onSurfaceVariant" sx={{ display: 'block' }}>Capacidad Furgón</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: 'onSurface' }}>Se calcula en la ruta</Typography>
                </Box>
              </Box>
            </Box>
          </Box>
        </MuiCard>
        )}

        {/* ── Card 4 — Forma de Pago y Descuento ────────── */}
        <MuiCard>
          <SectionHeader icon={<IconPayments size={20} />} title="Forma de Pago" />

          {/* 2-way choice: register the payment inline now, or leave it pending. */}
          <Box
            role="group"
            aria-label="Momento del pago"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              bgcolor: 'surfaceContainer',
              borderRadius: 9999,
              p: 0.5,
              mb: 2.5,
            }}
          >
            {([
              { value: true, label: 'Paga ahora' },
              { value: false, label: 'Queda pendiente' },
            ] as const).map((opt) => {
              const active = payNow === opt.value;
              return (
                <Box
                  key={String(opt.value)}
                  component="button"
                  type="button"
                  onClick={() => handlePayNowChange(opt.value)}
                  aria-pressed={active}
                  sx={{
                    px: 2,
                    py: 0.75,
                    borderRadius: 9999,
                    border: 'none',
                    cursor: 'pointer',
                    bgcolor: active ? 'surfaceContainerLowest' : 'transparent',
                    color: active ? 'primary.main' : 'onSurfaceVariant',
                    fontWeight: 700,
                    fontSize: '0.8125rem',
                    fontFamily: 'inherit',
                    boxShadow: active ? 1 : 'none',
                    transition: 'background-color 0.15s, box-shadow 0.15s',
                  }}
                >
                  {opt.label}
                </Box>
              );
            })}
          </Box>

          {payNow ? (
            <>
              {/* Inline payment line(s) — defaults to the order total; lower it for
                  a partial payment, or add lines to split across methods. */}
              <PaymentLinesEditor
                lines={paymentLines}
                onChange={handlePaymentLinesChange}
                cap={total > 0 ? total : null}
                capLabel="Total"
              />
              {payNowExceedsTotal && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  El pago no puede superar el total ({fmtMoney(total)})
                </Alert>
              )}
            </>
          ) : (
            <>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.5 }}>
                {paymentOptions
                  // Stall sales: only Efectivo / Transferencia (no Cta. Cte. ni reembolso).
                  .filter((opt) => !isPuesto || opt.value === 'cash' || opt.value === 'transfer')
                  .map((opt) => {
                    const active = paymentMethod === opt.value;
                    return (
                      <Box
                        key={opt.value}
                        component="button"
                        type="button"
                        onClick={() => setPaymentMethod(opt.value)}
                        aria-pressed={active}
                        sx={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 0.75,
                          p: 1.5,
                          borderRadius: '12px',
                          border: 1,
                          cursor: 'pointer',
                          borderColor: active ? 'primary.main' : 'outlineVariant',
                          bgcolor: active ? 'color-mix(in srgb, var(--mui-palette-primary-main) 10%, transparent)' : 'surfaceContainer',
                          color: active ? 'primary.main' : 'onSurfaceVariant',
                          fontWeight: 700,
                          fontSize: '0.8125rem',
                          fontFamily: 'inherit',
                          transition: 'background-color 0.15s, border-color 0.15s',
                          '&:hover': { borderColor: active ? 'primary.main' : 'outline' },
                        }}
                      >
                        {opt.icon}
                        {opt.label}
                      </Box>
                    );
                  })}
              </Box>

              {/* Contra reembolso — the client pays the previous balance on the NEXT delivery */}
              {paymentMethod === 'cod' && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 1.5, px: 1.5, py: 1, borderRadius: '10px', bgcolor: 'secondaryContainer', color: 'onSecondaryContainer' }}>
                  <IconInfo size={16} style={{ flexShrink: 0 }} />
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    El cliente paga los pendientes en la próxima entrega.
                  </Typography>
                </Box>
              )}
            </>
          )}

          {/* Resulting state — always visible so the split stays unambiguous. */}
          <Box
            sx={{
              mt: 2.5,
              px: 2,
              py: 1.25,
              borderRadius: '12px',
              bgcolor: 'surfaceContainerLow',
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              flexWrap: 'wrap',
            }}
          >
            <IconReceiptLong size={16} color="var(--mui-palette-onSurfaceVariant)" style={{ flexShrink: 0 }} />
            <Typography
              variant="caption"
              sx={{
                fontFamily: 'var(--font-mono)',
                fontVariantNumeric: 'tabular-nums',
                fontWeight: 600,
                color: 'onSurface',
              }}
            >
              Total {fmtMoney(total)} · Paga {fmtMoney(payNowTotal)} ahora · Queda {fmtMoney(pendingTotal)} pendiente
            </Typography>
          </Box>

          {/* Bonificación — order-level discount (fixed $ or % of the subtotal) */}
          <Box
            sx={{
              mt: 2.5,
              pt: 2.5,
              borderTop: 1,
              borderColor: 'outlineVariant',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
              <IconDiscount size={18} color="var(--mui-palette-onSurfaceVariant)" style={{ flexShrink: 0 }} />
              <Typography variant="body2" sx={{ fontWeight: 700, flex: 1, minWidth: 0 }}>
                Bonificación
              </Typography>
              {bonificationAmount > 0 && (
                <Typography
                  variant="body2"
                  sx={{
                    fontFamily: 'var(--font-mono)',
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 700,
                    color: 'success.main',
                    flexShrink: 0,
                  }}
                >
                  -{fmtMoney(bonificationAmount)}
                </Typography>
              )}
            </Box>

            {/* Tipo — segmented control: fixed amount vs percentage */}
            <Box
              role="group"
              aria-label="Tipo de bonificación"
              sx={{
                display: 'inline-flex',
                p: 0.5,
                mb: 1.5,
                gap: 0.5,
                borderRadius: 9999,
                bgcolor: 'surfaceContainerHigh',
              }}
            >
              {([
                { value: 'amount', label: 'Monto ($)' },
                { value: 'percent', label: 'Porcentaje (%)' },
              ] as Array<{ value: BonificationType; label: string }>).map((opt) => {
                const active = bonificationType === opt.value;
                return (
                  <Box
                    key={opt.value}
                    component="button"
                    type="button"
                    onClick={() => setBonificationType(opt.value)}
                    aria-pressed={active}
                    sx={{
                      px: 2,
                      py: 0.75,
                      borderRadius: 9999,
                      border: 'none',
                      cursor: 'pointer',
                      bgcolor: active ? 'surfaceContainerLowest' : 'transparent',
                      color: active ? 'primary.main' : 'onSurfaceVariant',
                      fontWeight: 700,
                      fontSize: '0.8125rem',
                      fontFamily: 'inherit',
                      boxShadow: active ? 1 : 'none',
                      transition: 'background-color 0.15s, box-shadow 0.15s',
                    }}
                  >
                    {opt.label}
                  </Box>
                );
              })}
            </Box>

            <MuiTextField
              label="Valor de bonificación (opcional)"
              type="number"
              size="small"
              value={bonificationValue}
              onChange={(event) => setBonificationValue(event.target.value)}
              error={Boolean(bonificationError)}
              helperText={bonificationError ?? 'Dejalo vacío para no aplicar descuento.'}
              slotProps={{ htmlInput: { min: 0, step: 0.01, inputMode: 'decimal' } }}
            />
          </Box>

          {/* Recargo — order-level surcharge (fixed $ or % of the subtotal) */}
          <Box
            sx={{
              mt: 2.5,
              pt: 2.5,
              borderTop: 1,
              borderColor: 'outlineVariant',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
              <IconTrendingUp size={18} color="var(--mui-palette-onSurfaceVariant)" style={{ flexShrink: 0 }} />
              <Typography variant="body2" sx={{ fontWeight: 700, flex: 1, minWidth: 0 }}>
                Recargo
              </Typography>
              {surchargeAmount > 0 && (
                <Typography
                  variant="body2"
                  sx={{
                    fontFamily: 'var(--font-mono)',
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 700,
                    color: 'warning.main',
                    flexShrink: 0,
                  }}
                >
                  +{fmtMoney(surchargeAmount)}
                </Typography>
              )}
            </Box>

            {/* Tipo — segmented control: fixed amount vs percentage */}
            <Box
              role="group"
              aria-label="Tipo de recargo"
              sx={{
                display: 'inline-flex',
                p: 0.5,
                mb: 1.5,
                gap: 0.5,
                borderRadius: 9999,
                bgcolor: 'surfaceContainerHigh',
              }}
            >
              {([
                { value: 'amount', label: 'Monto ($)' },
                { value: 'percent', label: 'Porcentaje (%)' },
              ] as Array<{ value: SurchargeType; label: string }>).map((opt) => {
                const active = surchargeType === opt.value;
                return (
                  <Box
                    key={opt.value}
                    component="button"
                    type="button"
                    onClick={() => setSurchargeType(opt.value)}
                    aria-pressed={active}
                    sx={{
                      px: 2,
                      py: 0.75,
                      borderRadius: 9999,
                      border: 'none',
                      cursor: 'pointer',
                      bgcolor: active ? 'surfaceContainerLowest' : 'transparent',
                      color: active ? 'primary.main' : 'onSurfaceVariant',
                      fontWeight: 700,
                      fontSize: '0.8125rem',
                      fontFamily: 'inherit',
                      boxShadow: active ? 1 : 'none',
                      transition: 'background-color 0.15s, box-shadow 0.15s',
                    }}
                  >
                    {opt.label}
                  </Box>
                );
              })}
            </Box>

            <MuiTextField
              label="Valor de recargo (opcional)"
              type="number"
              size="small"
              value={surchargeValue}
              onChange={(event) => setSurchargeValue(event.target.value)}
              error={Boolean(surchargeError)}
              helperText={surchargeError ?? 'Dejalo vacío para no aplicar recargo.'}
              slotProps={{ htmlInput: { min: 0, step: 0.01, inputMode: 'decimal' } }}
            />
          </Box>
        </MuiCard>

        {/* ── Card 5 — Resumen de la Orden (tonal, not white) ── */}
        <Box sx={{ bgcolor: 'surfaceContainer', borderRadius: '16px', border: 1, borderColor: 'outlineVariant', p: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 36,
                height: 36,
                borderRadius: '10px',
                bgcolor: 'surfaceContainerHighest',
                color: 'onSurfaceVariant',
                flexShrink: 0,
              }}
            >
              <IconReceiptLong size={20} />
            </Box>
            <Typography variant="titleMedium" sx={{ fontWeight: 700, color: 'onSurface', flex: 1 }}>
              Resumen de la Orden
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1 }}>
            <Typography variant="body2" color="onSurfaceVariant">
              Total Maples Asignados
            </Typography>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'onSurface' }}>
                {totalMaples.toLocaleString('es-AR')} maples
              </Typography>
              <Typography variant="caption" color="onSurfaceVariant" sx={{ display: 'block' }}>
                {totalCajones.toLocaleString('es-AR')} cajones cerrados
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1 }}>
            <Typography variant="body2" color="onSurfaceVariant">
              Subtotal Mercadería
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'onSurface' }}>
              {fmtMoney(subtotal)}
            </Typography>
          </Box>

          {bonificationAmount > 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1 }}>
              <Typography variant="body2" color="onSurfaceVariant">
                Bonificación
                {bonificationType === 'percent' ? ` (${bonificationNumeric}%)` : ''}
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'success.main' }}>
                -{fmtMoney(bonificationAmount)}
              </Typography>
            </Box>
          )}

          {surchargeAmount > 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1 }}>
              <Typography variant="body2" color="onSurfaceVariant">
                Recargo
                {surchargeType === 'percent' ? ` (${surchargeNumeric}%)` : ''}
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'warning.main' }}>
                +{fmtMoney(surchargeAmount)}
              </Typography>
            </Box>
          )}

          <Box sx={{ mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'outlineVariant', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <Typography variant="body1" sx={{ fontWeight: 700, color: 'onSurface' }}>
              Total a Cobrar
            </Typography>
            <Typography
              variant="h3"
              sx={{ fontFamily: 'var(--font-mono)', fontWeight: 800, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: 'primary.main', lineHeight: 1.1 }}
            >
              {fmtMoney(total)}
            </Typography>
          </Box>
        </Box>

        {/* ── Action buttons ─────────────────────────────── */}
        <MuiButton
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          disabled={submitting || success}
          isLoading={submitting}
          startIcon={success ? <IconCheck size={20} /> : <IconCircleCheck size={20} />}
          sx={{ minHeight: 56, borderRadius: '16px', fontSize: '1rem' }}
        >
          {success
            ? '¡Venta registrada!'
            : submitting
              ? 'Registrando venta...'
              : isPuesto
                ? `Vender en el Puesto (${fmtMoney(total)})`
                : `Confirmar y Generar Orden (${fmtMoney(total)})`}
        </MuiButton>
        <Box sx={{ textAlign: 'center', mt: -1 }}>
          <MuiButton variant="ghost" size="sm" onClick={() => navigate('/orders')} disabled={submitting}>
            Cancelar
          </MuiButton>
        </Box>
      </Box>

      <DuplicateWarningDialog
        open={duplicate !== null}
        resource="order"
        existingNumber={duplicate?.existingNumber ?? ''}
        existingId={duplicate?.existingId ?? ''}
        busy={submitting}
        onView={handleViewDuplicate}
        onForce={handleForceDuplicate}
        onCancel={handleCancelDuplicate}
      />
    </Box>
  );
}