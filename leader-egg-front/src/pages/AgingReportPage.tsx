import { useNavigate } from 'react-router-dom';
import { useAgingReport, useOverdueOrders } from '../hooks/queries/index.ts';
import { useSmartBack } from '../hooks/useSmartBack.ts';
import type { AgingBucketLabel } from '../types/index.ts';
import {
  MuiButton,
  MuiChip,
  MuiCard,
  PageHeader,
  LoadingState,
  EmptyState,
} from '../components/ui/index.ts';
import { IconArrowBack, IconWallet, IconWarning } from '../components/ui/icons.tsx';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import Alert from '@mui/material/Alert';

/* ── Bucket color config (M3 tonal containers) ─── */

interface BucketCfg {
  bg: string;
  text: string;
  dot: string;
  chipBg: string;
  chipText: string;
}

const bucketConfig: Record<AgingBucketLabel, BucketCfg> = {
  current: { bg: 'successContainer', text: 'onSuccessContainer', dot: 'success.main', chipBg: 'successContainer', chipText: 'onSuccessContainer' },
  '1-30': { bg: 'warningContainer', text: 'onWarningContainer', dot: 'warning.main', chipBg: 'warningContainer', chipText: 'onWarningContainer' },
  '31-60': { bg: 'warningContainer', text: 'onWarningContainer', dot: 'warning.main', chipBg: 'warningContainer', chipText: 'onWarningContainer' },
  '61-90': { bg: 'errorContainer', text: 'onErrorContainer', dot: 'error.main', chipBg: 'errorContainer', chipText: 'onErrorContainer' },
  '90+': { bg: 'errorContainer', text: 'onErrorContainer', dot: 'error.main', chipBg: 'errorContainer', chipText: 'onErrorContainer' },
};

const bucketLabels: Record<AgingBucketLabel, string> = {
  current: 'Al día',
  '1-30': '1–30 días',
  '31-60': '31–60 días',
  '61-90': '61–90 días',
  '90+': '+90 días',
};

/* ── AgingReportPage ──────────────────────────── */

export function AgingReportPage() {
  const navigate = useNavigate();
  const goBack = useSmartBack('/dashboard');

  // Reads — aging buckets + the overdue-orders list (parallel, same as before).
  const agingQuery = useAgingReport();
  const overdueQuery = useOverdueOrders();
  const buckets = agingQuery.data?.buckets ?? [];
  const totalOverdue = agingQuery.data?.totalOverdue ?? 0;
  const overdueOrders = overdueQuery.data ?? [];
  const loading = agingQuery.isLoading || overdueQuery.isLoading;

  const loadError = agingQuery.error ?? overdueQuery.error;
  const error = loadError
    ? loadError instanceof Error
      ? loadError.message
      : 'Error al cargar reporte'
    : null;

  const fmtMoney = (val: number) =>
    `$ ${val.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

  if (loading) {
    return <LoadingState label="Cargando reporte de antigüedad…" />;
  }

  if (error) {
    return (
      <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
        <MuiButton variant="ghost" onClick={goBack} startIcon={<IconArrowBack />} sx={{ mb: 2 }}>
          Volver
        </MuiButton>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  const totalOverdueCount = buckets
    .filter(b => b.label !== 'current')
    .reduce((sum, b) => sum + b.count, 0);

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
      {/* Back */}
      <MuiButton variant="ghost" onClick={goBack} startIcon={<IconArrowBack />} sx={{ mb: 2 }}>
        Volver
      </MuiButton>

      {/* Header */}
      <PageHeader
        title="Reporte de Antigüedad"
        subtitle="Análisis de saldos vencidos por rango"
        icon={<IconWallet size={22} />}
      />

      {/* Summary cards */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 3, mb: 4 }}>
        <MuiCard variant="elevated" sx={{ height: '100%' }}>
          <Typography variant="overline" color="onSurfaceVariant" sx={{ display: 'block', mb: 0.5 }}>
            Total Vencido
          </Typography>
          <Typography variant="h5" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'error.main', fontVariantNumeric: 'tabular-nums' }}>
            {fmtMoney(totalOverdue)}
          </Typography>
        </MuiCard>
        <MuiCard variant="elevated" sx={{ height: '100%' }}>
          <Typography variant="overline" color="onSurfaceVariant" sx={{ display: 'block', mb: 0.5 }}>
            Órdenes Vencidas
          </Typography>
          <Typography variant="h5" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {totalOverdueCount}
          </Typography>
        </MuiCard>
      </Box>

      {/* Bucket breakdown */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="overline" color="onSurfaceVariant" sx={{ display: 'block', mb: 2 }}>
          Distribución por Antigüedad
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(5, 1fr)' }, gap: 2 }}>
          {buckets.map((bucket) => {
            const cfg = bucketConfig[bucket.label];
            return (
              <Box
                key={bucket.label}
                sx={{
                  bgcolor: cfg.bg,
                  borderRadius: '12px',
                  p: 2,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                  border: '1px solid',
                  borderColor: 'transparent',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: cfg.dot, flexShrink: 0 }} />
                  <Typography variant="overline" sx={{ color: cfg.text, fontWeight: 600, mb: 0 }}>
                    {bucketLabels[bucket.label]}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                  <Typography variant="h6" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: cfg.text, fontVariantNumeric: 'tabular-nums' }}>
                    {bucket.count}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    órdenes
                  </Typography>
                </Box>
                <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: cfg.text, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtMoney(bucket.totalAmount)}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* Overdue orders list */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="overline" color="onSurfaceVariant" sx={{ display: 'block', mb: 2 }}>
          Órdenes Vencidas
        </Typography>
        {overdueOrders.length === 0 ? (
          <MuiCard variant="elevated" sx={{ height: '100%' }}>
            <EmptyState
              icon={<IconWarning size={28} />}
              title="¡Todo al día!"
              subtitle="No hay órdenes vencidas en este momento."
            />
          </MuiCard>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Orden</TableCell>
                  <TableCell>Cliente</TableCell>
                  <TableCell>Vencimiento</TableCell>
                  <TableCell sx={{ textAlign: 'right' }}>Saldo</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {overdueOrders.map((order) => {
                  const daysOverdue = order.dueDate
                    ? Math.floor((Date.now() - new Date(order.dueDate).getTime()) / (1000 * 60 * 60 * 24))
                    : 0;
                  const severity: AgingBucketLabel =
                    daysOverdue > 90 ? '90+' :
                    daysOverdue > 60 ? '61-90' :
                    daysOverdue > 30 ? '31-60' :
                    daysOverdue > 0 ? '1-30' : 'current';
                  const cfg = bucketConfig[severity];
                  return (
                    <TableRow
                      key={order._id}
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/orders/${order._id}`)}
                    >
                      <TableCell sx={{ fontWeight: 500, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>{order.orderNumber}</TableCell>
                      <TableCell>{order.customerName}</TableCell>
                      <TableCell>
                        <MuiChip
                          label={order.dueDate ? new Date(order.dueDate).toLocaleDateString('es-AR') : '—'}
                          size="small"
                          sx={{
                            bgcolor: cfg.chipBg,
                            color: cfg.chipText,
                            fontFamily: 'var(--font-mono)',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        />
                      </TableCell>
                      <TableCell sx={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'error.main', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtMoney(order.balance)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>
    </Box>
  );
}