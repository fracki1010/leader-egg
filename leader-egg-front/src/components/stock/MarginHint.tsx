import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { PriceUnit } from '../../types/index.ts';
import { formatPrice } from './StockStatusChips.tsx';
import { computeMargin, formatMarginPct } from '../../lib/margin.ts';

interface MarginHintProps {
  /** Live sale price for the unit (undefined/NaN when the field is empty). */
  price: number | undefined;
  /** Product cost PER MAPLE (null when no cost is loaded). */
  costPrice: number | null | undefined;
  unit: PriceUnit;
  maplesPerCajon: number;
}

/**
 * MarginHint — compact live "Costo / Ganancia" readout shown under a price
 * input so the user can set prices WITH the margin visible.
 *
 * NULL-safe by design: a missing cost renders "sin costo" (warning) and a
 * missing/invalid price renders "sin precio" — never a fake numeric margin.
 */
export function MarginHint({ price, costPrice, unit, maplesPerCajon }: MarginHintProps) {
  if (costPrice == null) {
    return (
      <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.5 }}>
        sin costo
      </Typography>
    );
  }

  if (price == null || !Number.isFinite(price) || price <= 0) {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        sin precio
      </Typography>
    );
  }

  const breakdown = computeMargin(price, costPrice, unit, maplesPerCajon);
  if (!breakdown) return null;

  const color = breakdown.margin > 0 ? 'success.main' : 'error.main';

  return (
    <Box sx={{ mt: 0.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        Costo: {formatPrice(breakdown.cost)}
      </Typography>
      <Typography
        variant="caption"
        sx={{
          display: 'block',
          color,
          fontWeight: 700,
          fontFamily: 'var(--font-mono)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        Ganancia: {formatPrice(breakdown.margin)} ({formatMarginPct(breakdown.marginPct)})
      </Typography>
    </Box>
  );
}
