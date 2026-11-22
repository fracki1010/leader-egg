import { useLocation, useNavigate } from 'react-router-dom';
import { alpha } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { IconPayments, IconWallet } from '../ui/icons.tsx';

/* ── Accounts section tabs ─────────────────────
   Segmented pill control shared by the two "Cuentas" screens:
   Resumen (balances) and Movimientos (cash ledger). The active tab is
   derived from the URL, so deep links and the browser back button always
   keep the control in sync with the rendered page. */

const MOVIMIENTOS_PATH = '/cuentas/movimientos';
const RESUMEN_PATH = '/cuentas';

type AccountsTabValue = 'resumen' | 'movimientos';

export function AccountsTabs() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const value: AccountsTabValue = pathname.startsWith(MOVIMIENTOS_PATH) ? 'movimientos' : 'resumen';

  return (
    <Box sx={{ mb: 2 }}>
      <Tabs
        value={value}
        onChange={(_, next: AccountsTabValue) => {
          // Clicking the already-active tab should not push a duplicate entry.
          if (next === value) return;
          navigate(next === 'movimientos' ? MOVIMIENTOS_PATH : RESUMEN_PATH);
        }}
        variant="fullWidth"
        aria-label="Sección de cuentas"
        sx={{
          minHeight: 0,
          p: '3px',
          bgcolor: 'surfaceContainerLow',
          borderRadius: '999px',
          border: 1,
          borderColor: (theme) => alpha(theme.palette.outlineVariant, 0.4),
          '& .MuiTabs-indicator': { display: 'none' },
          '& .MuiTabs-flexContainer': { gap: '3px' },
          '& .MuiTabs-scroller': { overflow: 'visible !important' },
          '& .MuiTab-root': {
            minHeight: 38,
            minWidth: 0,
            px: 2,
            gap: 0.75,
            borderRadius: '999px',
            color: 'onSurfaceVariant',
            fontWeight: 700,
            fontSize: '0.8125rem',
            textTransform: 'none',
            transition: 'background-color 180ms ease, color 180ms ease',
          },
          '& .MuiTab-root .MuiTab-iconWrapper': { margin: 0 },
          '& .MuiTab-root.Mui-selected': {
            bgcolor: 'primary.main',
            color: 'onPrimary',
            boxShadow: 1,
          },
        }}
      >
        <Tab value="resumen" label="Resumen" icon={<IconWallet size={16} />} iconPosition="start" />
        <Tab value="movimientos" label="Movimientos" icon={<IconPayments size={16} />} iconPosition="start" />
      </Tabs>
    </Box>
  );
}
