import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { ordersApi } from '../api/orders.ts';
import type { CustomerListFilters } from '../api/customers.ts';
import type { AccountRow, AccountSort, AccountsFilters } from '../api/accounts.ts';
import {
  useAccounts,
  useCustomersFiltered,
  useDashboardSummary,
} from '../hooks/queries/index.ts';
import { queryKeys } from '../hooks/query-keys.ts';
import type { Customer, CustomerOutstanding, CustomerType } from '../types/index.ts';
import {
  MuiButton,
  MuiSnackbar,
  MuiTextField,
  LoadingState,
  EmptyState,
} from '../components/ui/index.ts';
import {
  IconGroup,
  IconPlus,
  IconSearch,
  IconTune,
  IconChevronRight,
  IconWallet,
  IconStore,
  IconCustomer,
  IconVisibilityOff,
  IconCircleCheck,
  IconWarning,
  IconArrowLeft,
  IconArrowRight,
  IconCall,
  IconExpandMore,
} from '../components/ui/icons.tsx';
import { CustomerFormDialog } from '../components/customer/CustomerFormDialog.tsx';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import Switch from '@mui/material/Switch';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import { alpha, useTheme } from '@mui/material/styles';

/* ── Types ──────────────────────────────────── */

type TypeFilter = CustomerType | 'ALL';
type AccountFilterMode = 'all' | 'debtors' | 'overdue';

/** Aggregated counts for the type chips (unfiltered lookup). */
interface CustomerStats {
  total: number;
  b2b: number;
  b2c: number;
  active: number;
  inactive: number;
}

/**
 * One compact row in the merged Clientes/accounts list. Everything the detail
 * page shows lives behind the tap target; the list keeps only identity + saldo.
 */
interface CustomerRowData {
  id: string;
  name: string;
  type: CustomerType | null;
  phone: string | null;
  outstanding: number | null;
}

/** Palette role used to tint a KPI icon/value. */
type KpiTone = 'primary.main' | 'warning.main' | 'error.main' | 'success.main';

/* ── Constants ───────────────────────────────── */

const PAGE_SIZE = 20;

const typeFilters: { value: TypeFilter; label: string }[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'B2B', label: 'B2B Mayorista' },
  { value: 'B2C', label: 'B2C / Minorista' },
];

const accountFilters: { value: AccountFilterMode; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'debtors', label: 'Con saldo' },
  { value: 'overdue', label: 'Vencidas' },
];

const SORT_LABELS: Record<AccountSort, string> = {
  name: 'Por nombre',
  balance: 'Por saldo',
  overdue: 'Por vencido',
};

/* ── Helpers ────────────────────────────────── */

const fmtMoney = (val: number) =>
  `$ ${Math.round(val).toLocaleString('es-AR')}`;

/* ── KPI tile ─────────────────────────────────
   Compact M3 card: uppercase label + 28px tonal icon square → heavy
   tabular value → quiet sub-line. Surface container (not white) so the
   metric strip reads as one tonal band under the header CTA. */

function KpiTile({
  label,
  value,
  sub,
  icon,
  iconTone,
  valueTone = 'onSurface',
}: {
  label: string;
  value: string | number;
  sub: string;
  icon: ReactNode;
  iconTone: KpiTone;
  valueTone?: KpiTone | 'onSurface';
}) {
  return (
    <Box
      sx={{
        bgcolor: 'surfaceContainer',
        border: '1px solid',
        borderColor: (t) => alpha(t.palette.outlineVariant, 0.7),
        borderRadius: '20px',
        p: '14px',
        minWidth: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
        <Typography
          variant="overline"
          component="div"
          sx={{
            fontSize: '11px',
            lineHeight: 1.3,
            fontWeight: 800,
            letterSpacing: '0.06em',
            color: 'onSurfaceVariant',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </Typography>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            borderRadius: '8px',
            bgcolor: 'surfaceContainerHigh',
            color: iconTone,
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
      </Box>
      <Typography
        component="div"
        sx={{
          fontFamily: 'var(--font-mono)',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 800,
          fontSize: '1.25rem',
          lineHeight: 1.15,
          letterSpacing: '-0.02em',
          color: valueTone,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </Typography>
      <Typography
        component="div"
        sx={{
          mt: 0.25,
          fontSize: '11px',
          lineHeight: 1.3,
          fontWeight: 600,
          color: 'onSurfaceVariant',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {sub}
      </Typography>
    </Box>
  );
}

/* ── Filter chips ─────────────────────────────
   Wrapping pill buttons (never a horizontal scroller). Active type chips
   are filled primary; status chips use the quieter secondary-container
   tone so the two groups stay visually distinct. */

interface FilterChipOption<T extends string> {
  value: T;
  label: string;
}

function FilterChips<T extends string>({
  options,
  value,
  onChange,
  label,
  activeTone = 'primary',
}: {
  options: FilterChipOption<T>[];
  value: T;
  onChange: (next: T) => void;
  label: string;
  activeTone?: 'primary' | 'tonal';
}) {
  return (
    <Box role="group" aria-label={label} sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, minWidth: 0 }}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Box
            key={option.value}
            component="button"
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 36,
              px: 1.75,
              borderRadius: '9999px',
              cursor: 'pointer',
              font: 'inherit',
              fontSize: '0.8125rem',
              fontWeight: active ? 700 : 600,
              letterSpacing: '0.01em',
              whiteSpace: 'nowrap',
              border: '1px solid',
              transition: 'background-color 0.15s, border-color 0.15s, color 0.15s',
              ...(active
                ? activeTone === 'primary'
                  ? {
                      bgcolor: 'primary.main',
                      color: 'primary.contrastText',
                      borderColor: 'primary.main',
                      '&:hover': { bgcolor: 'primary.dark', borderColor: 'primary.dark' },
                    }
                  : {
                      bgcolor: 'secondaryContainer',
                      color: 'onSecondaryContainer',
                      borderColor: 'secondaryContainer',
                      '&:hover': { bgcolor: 'secondaryContainer', borderColor: 'onSecondaryContainer' },
                    }
                : {
                    bgcolor: 'surfaceContainer',
                    color: 'onSurfaceVariant',
                    borderColor: (t) => alpha(t.palette.outlineVariant, 0.7),
                    '&:hover': { bgcolor: 'surfaceContainerHigh' },
                  }),
              '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
            }}
          >
            {option.label}
          </Box>
        );
      })}
    </Box>
  );
}

/* ── Row atoms ──────────────────────────────── */

function TypeBadge({ type }: { type: CustomerType }) {
  const isB2B = type === 'B2B';
  return (
    <Box
      component="span"
      sx={{
        flexShrink: 0,
        px: 0.75,
        py: '1px',
        borderRadius: '6px',
        fontSize: '0.625rem',
        fontWeight: 800,
        letterSpacing: '0.04em',
        lineHeight: 1.5,
        bgcolor: isB2B ? 'primaryContainer' : 'surfaceContainerHigh',
        color: isB2B ? 'onPrimaryContainer' : 'onSurfaceVariant',
      }}
    >
      {type}
    </Box>
  );
}

/**
 * Balance chip. Three real states from the data:
 * debt → rose pill with the amount, zero → "Al día", unknown → neutral dash.
 */
function DebtPill({ outstanding }: { outstanding: number | null }) {
  if (outstanding == null) {
    return (
      <Box
        component="span"
        sx={{
          px: 1,
          py: 0.25,
          borderRadius: '9999px',
          bgcolor: 'surfaceContainerHigh',
          color: 'onSurfaceVariant',
          fontSize: '0.75rem',
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        —
      </Box>
    );
  }

  if (outstanding > 0) {
    return (
      <Box
        component="span"
        sx={{
          px: 1.25,
          py: 0.5,
          borderRadius: '9999px',
          bgcolor: 'errorContainer',
          color: 'onErrorContainer',
          fontFamily: 'var(--font-mono)',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 700,
          fontSize: '0.75rem',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {fmtMoney(outstanding)}
      </Box>
    );
  }

  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.25,
        px: 1.25,
        py: 0.5,
        borderRadius: '9999px',
        bgcolor: 'successContainer',
        color: 'onSuccessContainer',
        fontWeight: 700,
        fontSize: '0.75rem',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      <IconCircleCheck size={13} /> Al día
    </Box>
  );
}

/* ── Customer row ─────────────────────────────
   Native button (real click + keyboard semantics). Identity tile → name +
   type badge + phone → balance pill + chevron. Debt rows carry a faint
   error border so they stand out while scrolling the cartera. */

function CustomerRow({ row, onOpen }: { row: CustomerRowData; onOpen: () => void }) {
  const theme = useTheme();
  const isB2B = row.type === 'B2B';
  const hasDebt = row.outstanding != null && row.outstanding > 0;

  return (
    <Box
      component="button"
      type="button"
      onClick={onOpen}
      aria-label={`Ver cliente ${row.name}`}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        width: '100%',
        minWidth: 0,
        textAlign: 'left',
        cursor: 'pointer',
        color: 'inherit',
        font: 'inherit',
        bgcolor: 'surfaceContainer',
        border: '1px solid',
        borderColor: hasDebt
          ? alpha(theme.palette.error.main, 0.3)
          : alpha(theme.palette.outlineVariant, 0.7),
        borderRadius: '18px',
        p: 1.5,
        transition: 'background-color 0.15s, border-color 0.15s, transform 0.12s',
        '&:hover': { bgcolor: 'surfaceContainerHigh' },
        '&:active': { transform: 'scale(0.995)' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          borderRadius: '12px',
          bgcolor: 'surfaceContainerHigh',
          color: isB2B ? 'primary.main' : 'onSurfaceVariant',
          flexShrink: 0,
        }}
      >
        {isB2B ? <IconStore size={20} /> : <IconCustomer size={20} />}
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <Typography
            variant="titleSmall"
            component="div"
            noWrap
            sx={{ minWidth: 0, fontWeight: 700, color: 'onSurface' }}
          >
            {row.name}
          </Typography>
          {row.type && <TypeBadge type={row.type} />}
        </Box>
        {row.phone && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              mt: 0.25,
              minWidth: 0,
              color: 'onSurfaceVariant',
            }}
          >
            <IconCall size={13} />
            <Typography
              variant="caption"
              component="div"
              noWrap
              sx={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
            >
              {row.phone}
            </Typography>
          </Box>
        )}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
        <DebtPill outstanding={row.outstanding} />
        <Box sx={{ display: 'flex', color: 'onSurfaceVariant' }}>
          <IconChevronRight size={20} />
        </Box>
      </Box>
    </Box>
  );
}

/* ── Sort trigger ─────────────────────────────
   Compact "Orden: <label>" trigger backed by MUI Select so the same
   sort state/options and combobox semantics survive the restyle. */

function SortTrigger({ value, onChange }: { value: AccountSort; onChange: (next: AccountSort) => void }) {
  return (
    <Select
      value={value}
      onChange={(event) => onChange(event.target.value as AccountSort)}
      variant="outlined"
      IconComponent={IconExpandMore}
      renderValue={(selected) => `Orden: ${SORT_LABELS[selected as AccountSort] ?? ''}`}
      SelectDisplayProps={{ 'aria-label': 'Ordenar', style: { paddingTop: 8, paddingBottom: 8, paddingLeft: 14 } }}
      MenuProps={{ slotProps: { paper: { sx: { borderRadius: '16px', mt: 0.5 } } } }}
      sx={{
        minWidth: 168,
        bgcolor: 'surfaceContainer',
        borderRadius: '12px',
        fontSize: '0.8125rem',
        fontWeight: 600,
        '& .MuiOutlinedInput-notchedOutline': {
          borderColor: (t) => alpha(t.palette.outlineVariant, 0.7),
        },
        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'outline' },
        '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
          borderWidth: 1,
          borderColor: 'primary.main',
        },
        '& .MuiSelect-icon': { color: 'onSurfaceVariant', right: 10 },
      }}
    >
      <MenuItem value="name">Por nombre</MenuItem>
      <MenuItem value="balance">Por saldo</MenuItem>
      <MenuItem value="overdue">Por vencido</MenuItem>
    </Select>
  );
}

/* ── Pagination footer ────────────────────────
   One card; wraps at 320px instead of overflowing. Next/prev disabled
   states come straight from the server pagination. */

function PaginationFooter({
  page,
  pagesCount,
  shownStart,
  shownEnd,
  total,
  onPrev,
  onNext,
}: {
  page: number;
  pagesCount: number;
  shownStart: number;
  shownEnd: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 1,
        mt: 3,
        px: 1,
        py: 1,
        bgcolor: 'surfaceContainer',
        border: '1px solid',
        borderColor: (t) => alpha(t.palette.outlineVariant, 0.7),
        borderRadius: '16px',
      }}
    >
      <MuiButton
        variant="ghost"
        size="sm"
        startIcon={<IconArrowLeft size={16} />}
        disabled={page <= 1}
        onClick={onPrev}
      >
        Anterior
      </MuiButton>
      <Typography
        variant="caption"
        component="div"
        color="onSurfaceVariant"
        sx={{ fontWeight: 600, textAlign: 'center', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
      >
        Mostrando {shownStart}–{shownEnd} de {total} clientes
      </Typography>
      <MuiButton
        variant="ghost"
        size="sm"
        endIcon={<IconArrowRight size={16} />}
        disabled={page >= pagesCount}
        onClick={onNext}
      >
        Siguiente
      </MuiButton>
    </Box>
  );
}

/* ── CustomersPage ──────────────────────────── */

export function CustomersPage() {
  const navigate = useNavigate();

  // Search + customer filters (server-side via listFiltered)
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);

  // Account filters + sort (server-side via the accounts endpoint). When either
  // is active the list is driven by the account rows; otherwise the customer
  // list is the source (so customers without any orders still appear).
  const [accountFilter, setAccountFilter] = useState<AccountFilterMode>('all');
  const [sort, setSort] = useState<AccountSort>('name');
  const accountView = accountFilter !== 'all' || sort !== 'name';

  // Filter panel (tune button) — hosts the "Ver inactivos" switch
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Create dialog state (editing lives on the customer detail page)
  const [createOpen, setCreateOpen] = useState(false);

  // Snackbar
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [snackbarSeverity, setSnackbarSeverity] = useState<'success' | 'error'>('success');

  // ── Customer source (default view) — the paged customer list.
  const listFilters: CustomerListFilters = {
    search: debouncedSearch || undefined,
    type: typeFilter === 'ALL' ? undefined : typeFilter,
    includeInactive,
    page,
    limit: PAGE_SIZE,
  };
  const customersQuery = useCustomersFiltered(listFilters);
  const rawList = customersQuery.data;
  const customers = Array.isArray(rawList) ? rawList : (rawList?.items ?? []);
  const customerTotal = Array.isArray(rawList) ? rawList.length : (rawList?.total ?? 0);
  const customerLimit = Array.isArray(rawList) ? PAGE_SIZE : (rawList?.limit || PAGE_SIZE);

  // ── Account source (account view) — server-side filtered/sorted/paginated.
  const accountsFilters: AccountsFilters = {
    onlyDebtors: accountFilter === 'debtors' ? true : undefined,
    overdueOnly: accountFilter === 'overdue' ? true : undefined,
    search: debouncedSearch || undefined,
    sort,
    page,
    limit: PAGE_SIZE,
  };
  const accountsQuery = useAccounts(accountsFilters);
  const accountItems = accountsQuery.data?.items ?? [];
  const accountTotal = accountsQuery.data?.total ?? 0;
  const accountLimit = accountsQuery.data?.limit || PAGE_SIZE;

  // ── Hydration + stats maps (unfiltered lookups, cheap heuristic ≤ 200).
  const customersLookupQuery = useCustomersFiltered({ includeInactive: true, limit: 200 });
  const accountsLookupQuery = useAccounts({ sort: 'name', limit: 200 });

  const lookupCustomers = useMemo(() => {
    const res = customersLookupQuery.data;
    if (!res) return [] as Customer[];
    return Array.isArray(res) ? res : res.items;
  }, [customersLookupQuery.data]);

  const stats: CustomerStats | null = useMemo(() => {
    const res = customersLookupQuery.data;
    if (!res) return null;
    const items = Array.isArray(res) ? res : res.items;
    const totalAll = Array.isArray(res) ? res.length : res.total;
    return {
      total: totalAll,
      b2b: items.filter((c) => c.type === 'B2B').length,
      b2c: items.filter((c) => c.type === 'B2C').length,
      active: items.filter((c) => c.status === 'active').length,
      inactive: items.filter((c) => c.status === 'inactive').length,
    };
  }, [customersLookupQuery.data]);

  const customerById = useMemo(() => {
    const map: Record<string, Customer> = {};
    for (const c of lookupCustomers) map[c._id] = c;
    return map;
  }, [lookupCustomers]);

  const accountById = useMemo(() => {
    const map: Record<string, AccountRow> = {};
    for (const a of accountsLookupQuery.data?.items ?? []) map[a.customerId] = a;
    return map;
  }, [accountsLookupQuery.data]);

  // Por Cobrar + account stats — real consolidated numbers from the dashboard.
  const dashboardSummaryQuery = useDashboardSummary();
  const metrics = dashboardSummaryQuery.data
    ? {
        porCobrar: dashboardSummaryQuery.data.porCobrar,
        clientesDeudores: dashboardSummaryQuery.data.clientesDeudores,
        vencidoTotal: dashboardSummaryQuery.data.vencidas.total,
        vencidoCount: dashboardSummaryQuery.data.vencidas.count,
        cobradoHoy: dashboardSummaryQuery.data.cobradoHoy,
      }
    : null;

  // Legacy per-card outstanding — fallback when the account lookup has no row
  // for a (zero-account) customer. Failures show "—" and never block.
  const outstandingQueries = useQueries({
    queries: customers.map((customer) => ({
      queryKey: queryKeys.orders.outstanding(customer._id),
      queryFn: () => ordersApi.getCustomerOutstanding(customer._id),
    })),
  });
  const outstandingMap: Record<string, CustomerOutstanding | null> = {};
  customers.forEach((customer, i) => {
    outstandingMap[customer._id] = outstandingQueries[i]?.data ?? null;
  });

  // Debounce the search input (server-side search) and reset to page 1.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  /* ── Row builders ───────────────────────────── */

  const fromCustomer = (customer: Customer, account: AccountRow | null): CustomerRowData => {
    const outstanding = outstandingMap[customer._id] ?? null;
    return {
      id: customer._id,
      name: customer.name,
      type: customer.type,
      phone: customer.phone ?? null,
      outstanding: account?.outstandingBalance ?? outstanding?.outstandingBalance ?? null,
    };
  };

  const fromAccount = (account: AccountRow, customer: Customer | null): CustomerRowData => ({
    id: account.customerId,
    name: customer?.name ?? account.customerName,
    type: account.type,
    phone: customer?.phone ?? null,
    outstanding: account.outstandingBalance,
  });

  // Account view applies the type filter client-side (the accounts endpoint
  // has no type param) — a rare combination and an acceptable approximation.
  const accountTypeFiltered =
    typeFilter === 'ALL' ? accountItems : accountItems.filter((a) => a.type === typeFilter);

  const rows: CustomerRowData[] = accountView
    ? accountTypeFiltered.map((a) => fromAccount(a, customerById[a.customerId] ?? null))
    : customers.map((c) => fromCustomer(c, accountById[c._id] ?? null));

  const total = accountView ? accountTotal : customerTotal;
  const limit = accountView ? accountLimit : customerLimit;
  const activeLoading = accountView ? accountsQuery.isLoading : customersQuery.isLoading;
  const activeError = accountView ? accountsQuery.error : customersQuery.error;
  const queryError = activeError
    ? activeError instanceof Error
      ? activeError.message
      : 'Error al cargar clientes'
    : null;
  const error = queryError;

  const selectType = (value: TypeFilter) => {
    setTypeFilter(value);
    setPage(1);
  };

  const selectAccountFilter = (value: AccountFilterMode) => {
    setAccountFilter(value);
    setPage(1);
  };

  const toggleInactive = (checked: boolean) => {
    setIncludeInactive(checked);
    setPage(1);
  };

  const pagesCount = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  const shownStart = total === 0 ? 0 : (page - 1) * limit + 1;
  const shownEnd = Math.min(page * limit, total);

  // Type chips carry live counts from the unfiltered lookup.
  const typeChipOptions: FilterChipOption<TypeFilter>[] = typeFilters.map((f) => {
    const count =
      f.value === 'ALL' ? (stats?.total ?? 0) : f.value === 'B2B' ? (stats?.b2b ?? 0) : (stats?.b2c ?? 0);
    return { value: f.value, label: `${f.label} (${count})` };
  });

  if (activeLoading && rows.length === 0) {
    return <LoadingState label="Cargando clientes…" />;
  }

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
      {/* 1 — Header: identity square + title/subtitle, then the full-width
          "Nuevo Cliente" CTA (replaces the old inline header button). */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, minWidth: 0 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 48,
            height: 48,
            borderRadius: '16px',
            bgcolor: 'surfaceContainerHigh',
            color: 'primary.main',
            flexShrink: 0,
          }}
        >
          <IconGroup size={24} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h4" sx={{ fontWeight: 700, letterSpacing: '-0.02em', color: 'onSurface', lineHeight: 1.2 }}>
            Clientes
          </Typography>
          <Typography variant="body2" color="onSurfaceVariant" sx={{ mt: 0.25 }}>
            Gestioná tu cartera y cuentas corrientes
          </Typography>
        </Box>
      </Box>

      <MuiButton
        variant="primary"
        fullWidth
        onClick={() => setCreateOpen(true)}
        startIcon={<IconPlus size={18} />}
        sx={{
          minHeight: 48,
          mb: 3,
          borderRadius: '16px',
          fontWeight: 600,
          fontSize: '0.8125rem',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        Nuevo Cliente
      </MuiButton>

      {/* 2 — KPI strip: receivables, debtors, overdue, collected today. */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
          gap: 1.5,
          mb: 3,
        }}
      >
        <KpiTile
          label="Total a Cobrar"
          icon={<IconWallet size={16} />}
          iconTone="primary.main"
          valueTone="error.main"
          value={metrics == null ? '—' : fmtMoney(metrics.porCobrar)}
          sub="saldo pendiente global"
        />
        <KpiTile
          label="Deudores"
          icon={<IconGroup size={16} />}
          iconTone="warning.main"
          value={metrics == null ? '—' : metrics.clientesDeudores}
          sub="con saldo mayor a cero"
        />
        <KpiTile
          label="Vencido"
          icon={<IconWarning size={16} />}
          iconTone="error.main"
          valueTone="error.main"
          value={metrics == null ? '—' : fmtMoney(metrics.vencidoTotal)}
          sub={`${metrics?.vencidoCount ?? 0} ${metrics?.vencidoCount === 1 ? 'orden vencida' : 'órdenes vencidas'}`}
        />
        <KpiTile
          label="Cobrado Hoy"
          icon={<IconCircleCheck size={16} />}
          iconTone="success.main"
          valueTone="success.main"
          value={metrics == null ? '—' : fmtMoney(metrics.cobradoHoy)}
          sub="pagos recibidos hoy"
        />
      </Box>

      {/* 3 — Search + tune (toggles the "Ver inactivos" panel) */}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 2 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <MuiTextField
            placeholder="Buscar por nombre, teléfono o CUIT…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            size="small"
            fullWidth
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <IconSearch size={18} />
                  </InputAdornment>
                ),
              },
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                height: 48,
                borderRadius: '16px',
              },
            }}
          />
        </Box>
        <IconButton
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
          aria-controls="customers-filters"
          aria-label="Filtros de clientes"
          sx={{
            flexShrink: 0,
            width: 48,
            height: 48,
            borderRadius: '16px',
            border: '1px solid',
            borderColor: filtersOpen ? 'secondaryContainer' : (t) => alpha(t.palette.outlineVariant, 0.7),
            bgcolor: filtersOpen ? 'secondaryContainer' : 'surfaceContainer',
            color: filtersOpen ? 'onSecondaryContainer' : 'onSurfaceVariant',
            '&:hover': { bgcolor: filtersOpen ? 'secondaryContainer' : 'surfaceContainerHigh' },
          }}
        >
          <IconTune size={20} />
        </IconButton>
      </Box>

      {/* Type chips — wrapping, never a horizontal scroller */}
      <Box sx={{ mb: 1.5 }}>
        <FilterChips
          options={typeChipOptions}
          value={typeFilter}
          onChange={selectType}
          label="Tipo de cliente"
        />
      </Box>

      {/* Account status chips + compact sort trigger */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          flexWrap: 'wrap',
          mb: 2.5,
        }}
      >
        <FilterChips
          options={accountFilters}
          value={accountFilter}
          onChange={selectAccountFilter}
          label="Estado de cuenta"
          activeTone="tonal"
        />
        <Box sx={{ ml: { xs: 0, md: 'auto' } }}>
          <SortTrigger
            value={sort}
            onChange={(next) => {
              setSort(next);
              setPage(1);
            }}
          />
        </Box>
      </Box>

      {/* Collapsible filter panel — "Ver inactivos (N)" switch */}
      {filtersOpen && (
        <Box
          id="customers-filters"
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1.5,
            mb: 2.5,
            px: 1.5,
            py: 1,
            borderRadius: '16px',
            bgcolor: 'surfaceContainer',
            border: '1px solid',
            borderColor: (t) => alpha(t.palette.outlineVariant, 0.7),
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <IconVisibilityOff size={16} color="var(--mui-palette-onSurfaceVariant)" style={{ flexShrink: 0 }} />
            <Typography variant="body2" color="onSurfaceVariant" sx={{ fontWeight: 600 }}>
              Ver inactivos{stats?.inactive != null ? ` (${stats.inactive})` : ''}
            </Typography>
          </Box>
          <Switch
            checked={includeInactive}
            onChange={(e) => toggleInactive(e.target.checked)}
            color="primary"
            slotProps={{ input: { 'aria-label': 'Ver clientes inactivos' } }}
          />
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2.5 }}>{error}</Alert>
      )}

      {activeLoading && rows.length > 0 && (
        <LinearProgress sx={{ mb: 1.5, borderRadius: 1 }} />
      )}

      {/* 4 — Compact customer list: tap a row to open the full detail hub */}
      {rows.length === 0 ? (
        <EmptyState
          title={search || typeFilter !== 'ALL' || accountFilter !== 'all' ? 'Sin resultados' : 'No hay clientes'}
          subtitle={search || typeFilter !== 'ALL' || accountFilter !== 'all'
            ? 'Ningún cliente coincide con la búsqueda o los filtros.'
            : 'Empezá registrando tu primer cliente para cargar pedidos.'}
          action={!search && typeFilter === 'ALL' && accountFilter === 'all' ? (
            <MuiButton variant="primary" startIcon={<IconPlus />} onClick={() => setCreateOpen(true)}>
              Crear cliente
            </MuiButton>
          ) : undefined}
        />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {rows.map((row) => (
            <CustomerRow
              key={row.id}
              row={row}
              onOpen={() => navigate(`/customers/${row.id}`)}
            />
          ))}
        </Box>
      )}

      {/* 5 — Pagination footer */}
      {total > 0 && (
        <PaginationFooter
          page={page}
          pagesCount={pagesCount}
          shownStart={shownStart}
          shownEnd={shownEnd}
          total={total}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => p + 1)}
        />
      )}

      {/* Create dialog (editing lives on the customer detail page) */}
      <CustomerFormDialog
        open={createOpen}
        mode="create"
        customer={null}
        onClose={() => setCreateOpen(false)}
        onSaved={(message) => {
          setSnackbarMessage(message);
          setSnackbarSeverity('success');
          setSnackbarOpen(true);
          // create mutations invalidate the customers domain — the paged list
          // and the stats query refetch automatically.
        }}
      />

      {/* Snackbar */}
      <MuiSnackbar
        open={snackbarOpen}
        onClose={() => setSnackbarOpen(false)}
        message={snackbarMessage}
        severity={snackbarSeverity}
      />
    </Box>
  );
}
