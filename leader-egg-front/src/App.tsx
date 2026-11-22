import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from './theme/ThemeProvider.tsx';
import { Layout } from './components/Layout.tsx';
import { ScrollRestoration } from './components/ScrollRestoration.tsx';
import { UpdatePrompt } from './components/pwa/UpdatePrompt.tsx';
import { ProtectedRoute } from './components/ProtectedRoute.tsx';
import { PlatformGuard } from './components/PlatformGuard.tsx';
import { useAuthStore } from './stores/authStore.ts';
import { useSessionRefresh } from './hooks/useSessionRefresh.ts';
import { getHomePath, hasPermission } from './lib/permissions.ts';
import { LoginPage } from './pages/LoginPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { CustomersPage } from './pages/CustomersPage.tsx';
import { StockPage } from './pages/StockPage.tsx';
import { OrdersPage } from './pages/OrdersPage.tsx';
import { DriverRoutePage } from './pages/DriverRoutePage.tsx';
import { SinAccesoPage } from './pages/SinAccesoPage.tsx';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';

// ─── Code-splitting: heavy pages load on demand ─────────────────────────────
// Only the first-screen pages (login, dashboard, orders, customers, stock,
// driver route) stay in the initial bundle.

const CustomerDetailPage = lazy(() => import('./pages/CustomerDetailPage.tsx').then((m) => ({ default: m.CustomerDetailPage })));
const ProductDetailPage = lazy(() => import('./pages/ProductDetailPage.tsx').then((m) => ({ default: m.ProductDetailPage })));
const OrderDetailPage = lazy(() => import('./pages/OrderDetailPage.tsx').then((m) => ({ default: m.OrderDetailPage })));
const NewOrderPage = lazy(() => import('./pages/NewOrderPage.tsx').then((m) => ({ default: m.NewOrderPage })));
const AgingReportPage = lazy(() => import('./pages/AgingReportPage.tsx').then((m) => ({ default: m.AgingReportPage })));
const RoutesPage = lazy(() => import('./pages/RoutesPage.tsx').then((m) => ({ default: m.RoutesPage })));
const RouteDetailPage = lazy(() => import('./pages/RouteDetailPage.tsx').then((m) => ({ default: m.RouteDetailPage })));
const CajaPage = lazy(() => import('./pages/CajaPage.tsx').then((m) => ({ default: m.CajaPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage.tsx').then((m) => ({ default: m.ReportsPage })));
const UsersPage = lazy(() => import('./pages/UsersPage.tsx').then((m) => ({ default: m.UsersPage })));
const ComprasPage = lazy(() => import('./pages/ComprasPage.tsx').then((m) => ({ default: m.ComprasPage })));
const PurchaseDetailPage = lazy(() => import('./pages/PurchaseDetailPage.tsx').then((m) => ({ default: m.PurchaseDetailPage })));
const PromosPage = lazy(() => import('./pages/PromosPage.tsx').then((m) => ({ default: m.PromosPage })));
const CompanyAccountsPage = lazy(() => import('./pages/CompanyAccountsPage.tsx').then((m) => ({ default: m.CompanyAccountsPage })));
const AccountDetailPage = lazy(() => import('./pages/AccountDetailPage.tsx').then((m) => ({ default: m.AccountDetailPage })));
const PuntoCeroPage = lazy(() => import('./pages/PuntoCeroPage.tsx').then((m) => ({ default: m.PuntoCeroPage })));
const VehiclesPage = lazy(() => import('./pages/VehiclesPage.tsx').then((m) => ({ default: m.VehiclesPage })));
const VehicleDetailPage = lazy(() => import('./pages/VehicleDetailPage.tsx').then((m) => ({ default: m.VehicleDetailPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage.tsx').then((m) => ({ default: m.SettingsPage })));
const AssistantPage = lazy(() => import('./pages/AssistantPage.tsx').then((m) => ({ default: m.AssistantPage })));

// ─── Platform (multi-tenant) admin area — its own guard + minimal layout ─────
const PlatformLoginPage = lazy(() => import('./pages/PlatformLoginPage.tsx').then((m) => ({ default: m.PlatformLoginPage })));
const PlatformTenantsPage = lazy(() => import('./pages/PlatformTenantsPage.tsx').then((m) => ({ default: m.PlatformTenantsPage })));
const PlatformUsersPage = lazy(() => import('./pages/PlatformUsersPage.tsx').then((m) => ({ default: m.PlatformUsersPage })));
const PlatformPuntoCeroPage = lazy(() => import('./pages/PlatformPuntoCeroPage.tsx').then((m) => ({ default: m.PlatformPuntoCeroPage })));
const PlatformLayout = lazy(() => import('./components/PlatformLayout.tsx').then((m) => ({ default: m.PlatformLayout })));

const pageFallback = (
  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
    <CircularProgress />
  </Box>
);

/**
 * The dashboard needs `reports.view`. Admins without it are sent to their
 * dynamic home so they never land on an empty dashboard.
 */
function DashboardAccessGuard({ children }: { children: ReactNode }) {
  const user = useAuthStore((state) => state.user);
  if (user && user.role === 'admin' && !hasPermission(user.permissions ?? [], 'reports.view')) {
    return <Navigate to={getHomePath(user)} replace />;
  }
  return <>{children}</>;
}

function App() {
  // Refresh role + permissions once on boot when a session exists and we are online.
  useSessionRefresh();

  return (
    <ThemeProvider>
    {/* PWA update banner — offers the reload when a new build is waiting. */}
    <UpdatePrompt />
    <BrowserRouter>
      <ScrollRestoration />
      <Suspense fallback={pageFallback}>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />

        {/* Platform admin area — never nested inside the tenant app Layout */}
        <Route path="/platform/login" element={<PlatformLoginPage />} />
        <Route element={<PlatformGuard />}>
          <Route element={<PlatformLayout />}>
            <Route path="/platform" element={<PlatformTenantsPage />} />
            <Route path="/platform/tenants/:id/punto-cero" element={<PlatformPuntoCeroPage />} />
            <Route path="/platform/users" element={<PlatformUsersPage />} />
          </Route>
        </Route>

        {/* Protected routes — ProtectedRoute is a layout route that renders <Outlet /> */}
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route
              path="/dashboard"
              element={
                <DashboardAccessGuard>
                  <DashboardPage />
                </DashboardAccessGuard>
              }
            />
            {/* Shown to admins without any enabled module — never redirected away. */}
            <Route path="/sin-acceso" element={<SinAccesoPage />} />

            {/* Consolidated settings — every authenticated role can open it. */}
            <Route path="/settings" element={<SettingsPage />} />

            {/* Orders stay outside the admin role guard so drivers / puesto can use them.
                The permission only constrains admins (non-admin roles bypass it). */}
            <Route element={<ProtectedRoute permission="orders.view" />}>
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/orders/new" element={<NewOrderPage />} />
              <Route path="/orders/:id" element={<OrderDetailPage />} />
            </Route>

            {/* Admin-only routes nested under role + module-permission guards */}
            <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
              {/* Read-only AI assistant — admin-only, no module permission. */}
              <Route path="/asistente" element={<AssistantPage />} />

              <Route element={<ProtectedRoute permission="customers.view" />}>
                <Route path="/customers" element={<CustomersPage />} />
                <Route path="/customers/:id" element={<CustomerDetailPage />} />
              </Route>

              <Route element={<ProtectedRoute permission="stock.view" />}>
                <Route path="/products" element={<StockPage />} />
                <Route path="/products/:id" element={<ProductDetailPage />} />
              </Route>

              <Route element={<ProtectedRoute permission="users.manage" />}>
                <Route path="/users" element={<UsersPage />} />
              </Route>

              <Route element={<ProtectedRoute permission="reports.view" />}>
                <Route path="/reports/aging" element={<AgingReportPage />} />
                <Route path="/reports" element={<ReportsPage />} />
              </Route>

              <Route element={<ProtectedRoute permission="purchases.view" />}>
                <Route path="/compras" element={<ComprasPage />} />
                <Route path="/compras/:id" element={<PurchaseDetailPage />} />
              </Route>

              <Route element={<ProtectedRoute permission="promotions.view" />}>
                <Route path="/promos" element={<PromosPage />} />
              </Route>

              <Route element={<ProtectedRoute permission="routes.view" />}>
                <Route path="/routes" element={<RoutesPage />} />
                <Route path="/routes/:id" element={<RouteDetailPage />} />
              </Route>

              <Route element={<ProtectedRoute permission="accounts.view" />}>
                <Route path="/cuentas" element={<CompanyAccountsPage />} />
                <Route path="/cuentas/:account" element={<AccountDetailPage />} />
              </Route>

              <Route element={<ProtectedRoute permission="cash.view" />}>
                <Route path="/cuentas/movimientos" element={<CajaPage />} />
                <Route path="/caja" element={<Navigate to="/cuentas/movimientos" replace />} />
              </Route>

              <Route element={<ProtectedRoute permission="vehicles.view" />}>
                <Route path="/vehiculos" element={<VehiclesPage />} />
                <Route path="/vehiculos/:id" element={<VehicleDetailPage />} />
              </Route>
            </Route>

            {/* Superadmin-only routes — critical one-time setup */}
            <Route element={<ProtectedRoute allowedRoles={['superadmin']} />}>
              <Route path="/setup/punto-cero" element={<PuntoCeroPage />} />
            </Route>

            {/* Driver-only routes */}
            <Route element={<ProtectedRoute allowedRoles={['driver']} />}>
              <Route path="/my-route" element={<DriverRoutePage />} />
            </Route>
          </Route>
        </Route>

        {/* Default redirect */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
