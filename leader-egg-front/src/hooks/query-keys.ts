/**
 * Centralised, typed TanStack Query key factory.
 *
 * Every domain exposes an `all` root so mutations can invalidate the whole
 * domain by prefix (`queryKey: queryKeys.customers.all`). Parameterised keys
 * append serialisable filter/value segments so distinct reads stay isolated.
 */

// ─── Customers ──────────────────────────────────────────────────────────────

const customerKeys = {
  all: ['customers'] as const,
  lists: () => ['customers', 'list'] as const,
  list: (filters?: unknown) => ['customers', 'list', filters ?? {}] as const,
  details: () => ['customers', 'detail'] as const,
  detail: (id: string) => ['customers', 'detail', id] as const,
  summary: (id: string) => ['customers', 'detail', id, 'summary'] as const,
  orders: (id: string, filters?: unknown) =>
    ['customers', 'detail', id, 'orders', filters ?? {}] as const,
};

// ─── Orders ─────────────────────────────────────────────────────────────────

const orderKeys = {
  all: ['orders'] as const,
  lists: () => ['orders', 'list'] as const,
  list: (filters?: unknown) => ['orders', 'list', filters ?? {}] as const,
  overdue: () => ['orders', 'list', 'overdue'] as const,
  today: () => ['orders', 'today'] as const,
  details: () => ['orders', 'detail'] as const,
  detail: (id: string) => ['orders', 'detail', id] as const,
  outstanding: (customerId: string) => ['orders', 'outstanding', customerId] as const,
};

// ─── Products ───────────────────────────────────────────────────────────────

const productKeys = {
  all: ['products'] as const,
  list: (filters?: unknown) => ['products', 'list', filters ?? {}] as const,
  options: () => ['products', 'options'] as const,
  details: () => ['products', 'detail'] as const,
  detail: (id: string) => ['products', 'detail', id] as const,
  prices: (productId: string) => ['products', 'detail', productId, 'prices'] as const,
  activePrice: (productId: string, unit?: string, date?: string) =>
    ['products', 'detail', productId, 'prices', 'active', unit ?? 'default', date ?? 'today'] as const,
};

// ─── Inventory ──────────────────────────────────────────────────────────────

const inventoryKeys = {
  all: ['inventory'] as const,
  list: () => ['inventory', 'list'] as const,
  detail: (productId: string) => ['inventory', 'detail', productId] as const,
  transactions: (productId: string) => ['inventory', 'detail', productId, 'transactions'] as const,
  transactionsList: (filters?: unknown) => ['inventory', 'transactions', filters ?? {}] as const,
};

// ─── Purchases ──────────────────────────────────────────────────────────────

const purchaseKeys = {
  all: ['purchases'] as const,
  lists: () => ['purchases', 'list'] as const,
  list: (filters?: unknown) => ['purchases', 'list', filters ?? {}] as const,
  detail: (id: string) => ['purchases', 'detail', id] as const,
};

// ─── Suppliers ──────────────────────────────────────────────────────────────

const supplierKeys = {
  all: ['suppliers'] as const,
  list: (includeInactive = false) => ['suppliers', 'list', includeInactive] as const,
  detail: (id: string) => ['suppliers', 'detail', id] as const,
};

// ─── Promotions ─────────────────────────────────────────────────────────────

const promotionKeys = {
  all: ['promotions'] as const,
  list: (filters?: unknown) => ['promotions', 'list', filters ?? {}] as const,
  active: (filters?: unknown) => ['promotions', 'active', filters ?? {}] as const,
  detail: (id: string) => ['promotions', 'detail', id] as const,
};

// ─── Accounts ───────────────────────────────────────────────────────────────

const accountKeys = {
  all: ['accounts'] as const,
  list: (filters?: unknown) => ['accounts', 'list', filters ?? {}] as const,
  movements: (customerId: string) => ['accounts', 'movements', customerId] as const,
};

// ─── Customer charges (manual debt / credit) ────────────────────────────────

const customerChargeKeys = {
  all: ['customerCharges'] as const,
  list: (customerId: string) => ['customerCharges', 'list', customerId] as const,
};

// ─── Dashboard ──────────────────────────────────────────────────────────────

const dashboardKeys = {
  all: ['dashboard'] as const,
  summary: () => ['dashboard', 'summary'] as const,
  alerts: () => ['dashboard', 'alerts'] as const,
};

// ─── Reports ────────────────────────────────────────────────────────────────

const reportKeys = {
  all: ['reports'] as const,
  aging: (customerId?: string) => ['reports', 'aging', customerId ?? 'all'] as const,
  revenue: (startDate: string, endDate: string) =>
    ['reports', 'revenue', startDate, endDate] as const,
  profit: (startDate: string, endDate: string) =>
    ['reports', 'profit', startDate, endDate] as const,
  customerHistory: (customerId: string) => ['reports', 'customers', customerId, 'history'] as const,
  customerFrequency: (
    customerId: string,
    period: string,
    startDate?: string,
    endDate?: string,
  ) =>
    [
      'reports',
      'customers',
      customerId,
      'frequency',
      period,
      startDate ?? 'all',
      endDate ?? 'all',
    ] as const,
  topCustomers: (limit: number) => ['reports', 'customers', 'top', limit] as const,
};

// ─── Expenses ───────────────────────────────────────────────────────────────

const expenseKeys = {
  all: ['expenses'] as const,
  list: (params?: unknown) => ['expenses', 'list', params ?? {}] as const,
  totals: (params?: unknown) => ['expenses', 'totals', params ?? {}] as const,
};

// ─── Cash adjustments ───────────────────────────────────────────────────────

const cashAdjustmentKeys = {
  all: ['cashAdjustments'] as const,
  list: (params?: unknown) => ['cashAdjustments', 'list', params ?? {}] as const,
};

// ─── Unified cash ledger ────────────────────────────────────────────────────

const cashKeys = {
  all: ['cash'] as const,
  summary: () => ['cash', 'summary'] as const,
  movements: (params?: unknown) => ['cash', 'movements', params ?? {}] as const,
};

// ─── Daily closes ───────────────────────────────────────────────────────────

const dailyCloseKeys = {
  all: ['dailyCloses'] as const,
  list: (from?: string, to?: string, channel?: string) =>
    ['dailyCloses', 'list', from ?? 'all', to ?? 'all', channel ?? 'all'] as const,
  preview: (date?: string, channel?: string) =>
    ['dailyCloses', 'preview', date ?? 'today', channel ?? 'all'] as const,
  byDate: (date: string, channel?: string) =>
    ['dailyCloses', 'byDate', date, channel ?? 'all'] as const,
};

// ─── Routes ─────────────────────────────────────────────────────────────────

const routeKeys = {
  all: ['routes'] as const,
  lists: () => ['routes', 'list'] as const,
  list: (params?: unknown) => ['routes', 'list', params ?? {}] as const,
  detail: (id: string) => ['routes', 'detail', id] as const,
  driverActive: () => ['routes', 'driver', 'active'] as const,
};

// ─── Vehicles ───────────────────────────────────────────────────────────────

const vehicleKeys = {
  all: ['vehicles'] as const,
  list: (includeInactive = false) => ['vehicles', 'list', includeInactive] as const,
  detail: (id: string) => ['vehicles', 'detail', id] as const,
};

// ─── Users ──────────────────────────────────────────────────────────────────

const userKeys = {
  all: ['users'] as const,
  list: () => ['users', 'list'] as const,
  drivers: () => ['users', 'drivers'] as const,
};

// ─── Payments ───────────────────────────────────────────────────────────────

const paymentKeys = {
  all: ['payments'] as const,
  list: (orderId: string) => ['payments', 'list', orderId] as const,
  receipt: (orderId: string) => ['payments', 'receipt', orderId] as const,
};

// ─── Returns ────────────────────────────────────────────────────────────────

const returnKeys = {
  all: ['returns'] as const,
  list: (filters?: unknown) => ['returns', 'list', filters ?? {}] as const,
  order: (orderId: string) => ['returns', 'order', orderId] as const,
};

// ─── Setup ──────────────────────────────────────────────────────────────────

const setupKeys = {
  all: ['setup'] as const,
  puntoCero: () => ['setup', 'puntoCero'] as const,
  profile: () => ['setup', 'profile'] as const,
};

// ─── AI assistant (read-only) ───────────────────────────────────────────────

const agentKeys = {
  all: ['agent'] as const,
  chat: () => ['agent', 'chat'] as const,
};

// ─── Platform (multi-tenant admin) ──────────────────────────────────────────

const platformKeys = {
  all: ['platform'] as const,
  tenants: () => ['platform', 'tenants'] as const,
  users: () => ['platform', 'users'] as const,
  usersList: (filters?: unknown) => ['platform', 'users', 'list', filters ?? {}] as const,
  puntoCero: (tenantId: string) =>
    ['platform', 'tenants', tenantId, 'puntoCero'] as const,
};

// ─── Factory ────────────────────────────────────────────────────────────────

export const queryKeys = {
  customers: customerKeys,
  orders: orderKeys,
  products: productKeys,
  inventory: inventoryKeys,
  purchases: purchaseKeys,
  suppliers: supplierKeys,
  promotions: promotionKeys,
  accounts: accountKeys,
  customerCharges: customerChargeKeys,
  dashboard: dashboardKeys,
  reports: reportKeys,
  expenses: expenseKeys,
  cashAdjustments: cashAdjustmentKeys,
  cash: cashKeys,
  dailyCloses: dailyCloseKeys,
  routes: routeKeys,
  vehicles: vehicleKeys,
  users: userKeys,
  payments: paymentKeys,
  returns: returnKeys,
  setup: setupKeys,
  agent: agentKeys,
  platform: platformKeys,
} as const;

export type QueryDomain = keyof typeof queryKeys;
