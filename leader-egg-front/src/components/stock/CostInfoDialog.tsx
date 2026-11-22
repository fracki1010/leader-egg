import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import { MuiButton, MuiDialog } from '../ui/index.ts';
import { IconInfo } from '../ui/icons.tsx';

interface CostInfoButtonProps {
  /** Button label. Defaults to "¿Cómo se calcula?". */
  label?: string;
}

/**
 * CostExplanationContent — the shared body of the cost/margin help dialog.
 *
 * Explains in plain Spanish how the WEIGHTED AVERAGE COST is computed on
 * delivery and how the margin is derived from it, using real app numbers.
 * Kept as its own export so it can be unit-tested and reused standalone.
 */
export function CostExplanationContent() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* ── Costo ─────────────────────────────── */}
      <Box>
        <Typography variant="titleSmall" sx={{ fontWeight: 700, color: 'onSurface', mb: 0.5 }}>
          Costo
        </Typography>
        <Typography variant="body2" color="onSurfaceVariant">
          Es el <Box component="span" sx={{ fontWeight: 700 }}>costo promedio ponderado</Box> de tus
          compras. Cada vez que ENTREGÁS una compra, se recalcula mezclando lo que ya tenías con lo
          nuevo.
        </Typography>
      </Box>

      {/* ── Example (highlighted) ─────────────── */}
      <Box
        sx={{
          px: 2,
          py: 1.5,
          borderRadius: 2,
          bgcolor: 'primaryContainer',
          borderLeft: '4px solid',
          borderColor: 'primary.main',
        }}
      >
        <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, color: 'onPrimaryContainer', mb: 0.5 }}>
          Ejemplo
        </Typography>
        <Typography variant="body2" sx={{ color: 'onPrimaryContainer' }}>
          Tenés 12 maples a $4.416,67 y comprás 12 más a $4.750:
        </Typography>
        <Typography
          variant="body2"
          sx={{
            mt: 0.5,
            fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 700,
            color: 'onPrimaryContainer',
          }}
        >
          (12 × 4.416,67 + 12 × 4.750) ÷ 24 = $4.583,34 por maple
        </Typography>
      </Box>

      <Divider />

      {/* ── Ganancia y margen ─────────────────── */}
      <Box>
        <Typography variant="titleSmall" sx={{ fontWeight: 700, color: 'onSurface', mb: 0.5 }}>
          Ganancia y margen
        </Typography>
        <Typography variant="body2" color="onSurfaceVariant">
          Ganancia = Precio de venta − Costo.
        </Typography>
        <Typography variant="body2" color="onSurfaceVariant">
          Margen % = Ganancia ÷ Precio de venta.
        </Typography>
      </Box>

      {/* ── Note ──────────────────────────────── */}
      <Typography variant="caption" color="onSurfaceVariant" sx={{ display: 'block' }}>
        El costo se actualiza cuando <Box component="span" sx={{ fontWeight: 700 }}>entregás</Box> la
        compra (no al cargarla).
      </Typography>
    </Box>
  );
}

/**
 * CostInfoButton — an info affordance that opens the cost/margin help dialog.
 *
 * Used from ProductDetailPage's Ganancia card so the explanation is always one
 * tap away. The button is intentionally quiet (ghost, primary accent) so it
 * never competes with the primary actions.
 */
export function CostInfoButton({ label = '¿Cómo se calcula?' }: CostInfoButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <MuiButton
        variant="ghost"
        size="sm"
        startIcon={<IconInfo size={16} />}
        onClick={() => setOpen(true)}
        sx={{ color: 'primary.main', fontWeight: 600 }}
      >
        {label}
      </MuiButton>
      <MuiDialog
        open={open}
        onClose={() => setOpen(false)}
        title="¿Cómo se calcula?"
        maxWidth="xs"
      >
        <CostExplanationContent />
      </MuiDialog>
    </>
  );
}
