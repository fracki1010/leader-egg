import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore.ts';
import { useSmartBack } from '../hooks/useSmartBack.ts';
import { getHomePath, ROLE_LABELS } from '../lib/permissions.ts';
import type { UserRole } from '../types/index.ts';
import { InstallBanner } from './driver/InstallBanner.tsx';
import { AppMenu } from './AppMenu.tsx';
import { OfflineBanner } from './OfflineBanner.tsx';
import { m3Shape } from '../theme/index.ts';
import {
  IconHome,
  IconStock,
  IconRoute,
  IconOrder,
  IconUsers,
  IconReport,
  IconSettings,
  IconDownload,
  IconEgg,
  IconShoppingCart,
  IconPromo,
  IconWallet,
  IconCar,
  IconArrowBack,
  IconMenu,
  IconSparkles,
} from './ui/icons.tsx';

/* ── MUI imports ────────────────────────────── */
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Avatar from '@mui/material/Avatar';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import Paper from '@mui/material/Paper';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';

/* ── Navigation config ──────────────────────── */

type NavPlacement = 'bottom' | 'more' | 'desktop';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactElement;
  /** bottom → mobile nav bar; more → "Más" menu; desktop → only the sidebar */
  placement: NavPlacement;
  roles: UserRole[];
  /** Required module permission for admins (ignored for other roles). */
  permission?: string;
}

/**
 * Ordering: the desktop sidebar renders every visible item in this order;
 * the mobile bottom nav picks items via BOTTOM_ROUTE_ORDER (Inicio, Rutas, Registrar).
 */
const navItems: NavItem[] = [
  { to: '/dashboard', label: 'Inicio', icon: <IconHome size={24} />, placement: 'bottom', roles: ['admin', 'driver', 'viewer', 'puesto'] },
  { to: '/routes', label: 'Rutas', icon: <IconRoute size={24} />, placement: 'bottom', roles: ['admin'], permission: 'routes.view' },
  { to: '/my-route', label: 'Mi Ruta', icon: <IconRoute size={24} />, placement: 'bottom', roles: ['driver'] },
  { to: '/orders', label: 'Pedidos', icon: <IconOrder size={24} />, placement: 'bottom', roles: ['admin', 'driver', 'viewer', 'puesto'], permission: 'orders.view' },
  { to: '/products', label: 'Stock', icon: <IconStock size={24} />, placement: 'more', roles: ['admin', 'driver', 'viewer'], permission: 'stock.view' },
  { to: '/customers', label: 'Clientes', icon: <IconUsers size={24} />, placement: 'more', roles: ['admin'], permission: 'customers.view' },
  { to: '/cuentas', label: 'Cuentas', icon: <IconWallet size={24} />, placement: 'more', roles: ['admin'], permission: 'accounts.view' },
  { to: '/compras', label: 'Compras', icon: <IconShoppingCart size={24} />, placement: 'more', roles: ['admin'], permission: 'purchases.view' },
  { to: '/vehiculos', label: 'Vehículos', icon: <IconCar size={24} />, placement: 'more', roles: ['admin'], permission: 'vehicles.view' },
  { to: '/promos', label: 'Promos', icon: <IconPromo size={24} />, placement: 'more', roles: ['admin'], permission: 'promotions.view' },
  { to: '/reports', label: 'Reportes', icon: <IconReport size={24} />, placement: 'more', roles: ['admin'], permission: 'reports.view' },
  { to: '/asistente', label: 'Asistente', icon: <IconSparkles size={24} />, placement: 'more', roles: ['admin'] },
  { to: '/settings', label: 'Ajustes', icon: <IconSettings size={24} />, placement: 'desktop', roles: ['admin', 'driver', 'viewer', 'puesto'] },
];

/** Path prefix → permission required to stay on that route (admin only). */
const ROUTE_PERMISSIONS: ReadonlyArray<readonly [string, string]> = [
  ['/orders', 'orders.view'],
  ['/customers', 'customers.view'],
  ['/products', 'stock.view'],
  ['/users', 'users.manage'],
  ['/reports', 'reports.view'],
  ['/compras', 'purchases.view'],
  ['/promos', 'promotions.view'],
  ['/routes', 'routes.view'],
  ['/cuentas/movimientos', 'cash.view'],
  ['/caja', 'cash.view'],
  ['/cuentas', 'accounts.view'],
  ['/vehiculos', 'vehicles.view'],
];

function getRoutePermission(pathname: string): string | undefined {
  const match = ROUTE_PERMISSIONS.find(
    ([prefix]) => pathname === prefix || pathname.startsWith(prefix + '/'),
  );
  return match?.[1];
}

/** Mobile bottom nav shows exactly: Inicio, Rutas (or Mi Ruta), Registrar, Ajustes. */
const BOTTOM_ROUTE_ORDER = ['/dashboard', '/routes', '/my-route', '/orders'];

const DESKTOP_DRAWER_WIDTH = 280;
const APP_NAME = 'El Huevo Líder';

/** Local-time greeting so the sidebar does not say "Buenos días" at night. */
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Buenos días';
  if (hour < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

function isRouteActive(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(to + '/');
}

/** Exact root routes — these are top-level tabs, so they never show a back button. */
const ROOT_ROUTES = new Set(navItems.map((item) => item.to));

/**
 * Closest section destination for the global back button's deep-link fallback.
 * Only used when there is no previous history entry to return to.
 */
const BACK_FALLBACKS: ReadonlyArray<readonly [string, string]> = [
  ['/orders', '/orders'],
  ['/products', '/products'],
  ['/customers', '/customers'],
  ['/compras', '/compras'],
  ['/routes', '/routes'],
  ['/vehiculos', '/vehiculos'],
  ['/users', '/users'],
  ['/reports', '/reports'],
  ['/cuentas', '/cuentas'],
  ['/promos', '/promos'],
  ['/setup', '/dashboard'],
];

function getBackFallback(pathname: string): string {
  const match = BACK_FALLBACKS.find(
    ([prefix]) => pathname === prefix || pathname.startsWith(prefix + '/'),
  );
  return match?.[1] ?? '/';
}

/* ── Layout ─────────────────────────────────── */

export function Layout() {
  const { user, tenant } = useAuthStore();
  const hasModulePermission = useAuthStore((state) => state.hasPermission);
  // The tenant name is only useful when it differs from the product brand.
  const showTenantName =
    Boolean(tenant?.name) && tenant!.name.trim().toLowerCase() !== APP_NAME.toLowerCase();
  const greeting = getGreeting();
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [installDismissed, setInstallDismissed] = useState(false);
  // Tracks the last observed user so we only re-route when a session refresh
  // actually changes the profile, not on every navigation.
  const previousUser = useRef(user);

  // A permission refresh can revoke the module the user is currently viewing.
  // When the profile changes and the route is no longer allowed, go home.
  useEffect(() => {
    const previous = previousUser.current;
    previousUser.current = user;
    if (previous === user) return;
    if (!user || user.role !== 'admin') return;

    const required = getRoutePermission(location.pathname);
    if (required && !hasModulePermission(required)) {
      navigate(getHomePath(user), { replace: true });
    }
  }, [user, location.pathname, hasModulePermission, navigate]);

  // Hamburger drawer state (mobile)
  const [menuOpen, setMenuOpen] = useState(false);

  const userRole = user?.role ?? 'viewer';
  // Superadmin inherits the full admin navigation (sees everything admin sees).
  const navRole: UserRole = userRole === 'superadmin' ? 'admin' : userRole;
  const visibleNavItems = navItems.filter((item) => {
    if (!item.roles.includes(navRole)) return false;
    // Module permissions only filter admins; other roles are role-based.
    if (navRole !== 'admin') return true;
    if (!item.permission) return true;
    return hasModulePermission(item.permission);
  });
  const isDriver = userRole === 'driver';

  // Global back button — mobile only, hidden on root tabs.
  const showBackButton = isMobile && !ROOT_ROUTES.has(location.pathname);
  const goBack = useSmartBack(getBackFallback(location.pathname));

  // Mobile bottom nav: main items in the required order + the Settings slot
  const bottomItems = BOTTOM_ROUTE_ORDER
    .map((to) => visibleNavItems.find((item) => item.to === to))
    .filter((item): item is NavItem => item !== undefined);
  const moreItems = visibleNavItems.filter((item) => item.placement === 'more');
  const moreIndex = bottomItems.length; // last slot is Settings

  const bottomNavValue = bottomItems.findIndex((item) => isRouteActive(location.pathname, item.to));
  // "Ajustes" is the last slot and now has a real route. Highlight it while
  // the user is on /settings so the bottom bar reflects the current page.
  const onSettings = location.pathname === '/settings' || location.pathname.startsWith('/settings/');
  const navValue = onSettings ? moreIndex : bottomNavValue;

  /* ── Desktop sidebar (M3 navigation drawer) ── */

  const drawerContent = (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {/* Brand */}
      <Box sx={{ px: 2.5, py: 2.5, borderBottom: 1, borderColor: 'outlineVariant' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
          <IconEgg size={32} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography component="div" variant="titleMedium" noWrap color="onSurface" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              {APP_NAME}
            </Typography>
            {/* Company the user is signed into — only when it differs from the product brand. */}
            {showTenantName && (
              <Typography
                component="div"
                variant="labelMedium"
                noWrap
                color="primary.main"
                sx={{ fontWeight: 700, lineHeight: 1.2 }}
              >
                {tenant!.name}
              </Typography>
            )}
            <Typography component="div" variant="labelMedium" noWrap color="onSurfaceVariant" sx={{ lineHeight: 1.3 }}>
              {greeting}, {user?.name?.split(' ')[0] ?? 'Nazareno'}
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Navigation — active item is a secondaryContainer pill (all items visible).
          Scrolls when the module list exceeds the viewport so the user section
          (log out) stays pinned at the bottom. */}
      <List sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, py: 1.5 }}>
        {visibleNavItems.map((item) => {
          const isActive = isRouteActive(location.pathname, item.to);
          return (
            <ListItemButton
              key={item.to}
              component={NavLink}
              to={item.to}
              selected={isActive}
              sx={{
                borderRadius: m3Shape.full,
                mb: 0.5,
                minHeight: 48,
                color: isActive ? 'onSecondaryContainer' : 'onSurfaceVariant',
                '& .MuiListItemIcon-root': {
                  color: isActive ? 'onSecondaryContainer' : 'onSurfaceVariant',
                },
                '&:hover': {
                  bgcolor: 'action.hover',
                },
                '&.Mui-selected': {
                  bgcolor: 'secondaryContainer',
                  color: 'onSecondaryContainer',
                  '& .MuiListItemIcon-root': { color: 'onSecondaryContainer' },
                  '&:hover': { bgcolor: 'secondaryContainer' },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
              <ListItemText
                primary={item.label}
                slotProps={{
                  primary: { variant: 'titleSmall', sx: { fontWeight: 500 } },
                }}
              />
            </ListItemButton>
          );
        })}
      </List>

      {/* Install button (driver only) */}
      {isDriver && !installDismissed && (
        <Box sx={{ px: 2, pb: 2 }}>
          <InstallBanner onDismiss={() => setInstallDismissed(true)} />
        </Box>
      )}

      <Divider />

      {/* User section — read-only identity. Account actions live in Settings. */}
      <Box sx={{ p: 2, flexShrink: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar
            sx={{
              width: 40,
              height: 40,
              bgcolor: 'primaryContainer',
              color: 'onPrimaryContainer',
              fontSize: 'body2.fontSize',
              fontWeight: 600,
            }}
          >
            {user?.name?.charAt(0).toUpperCase() ?? '?'}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography component="div" variant="titleSmall" noWrap color="onSurface">
              {user?.name}
            </Typography>
            <Typography variant="labelMedium" color="onSurfaceVariant" sx={{ textTransform: 'capitalize' }}>
              {ROLE_LABELS[userRole]}
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', minWidth: 0, maxWidth: '100%', overflowX: 'hidden' }}>
      {/* ── Desktop sidebar ──────────────────── */}
      {!isMobile && (
        <Box
          component="nav"
          sx={{ width: DESKTOP_DRAWER_WIDTH, flexShrink: 0 }}
          aria-label="Desktop navigation"
        >
          <Drawer
            variant="permanent"
            sx={{
              '& .MuiDrawer-paper': {
                width: DESKTOP_DRAWER_WIDTH,
                boxSizing: 'border-box',
                bgcolor: 'surfaceContainer',
                borderRight: 1,
                borderColor: 'outlineVariant',
              },
            }}
            open
          >
            {drawerContent}
          </Drawer>
        </Box>
      )}

      {/* ── Main content ─────────────────────── */}
      <Box
        component="main"
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100vh',
          minWidth: 0,
          maxWidth: '100%',
          overflowX: 'hidden',
          // Offset for desktop sidebar
          ml: { md: `${DESKTOP_DRAWER_WIDTH}px` },
          // Notch / rounded-corner insets in standalone edge-to-edge mode
          pl: 'env(safe-area-inset-left, 0px)',
          pr: 'env(safe-area-inset-right, 0px)',
          // Offset for mobile bottom nav: nav (~64px) + FAB (~56px) + air
          pb: { xs: 'calc(140px + env(safe-area-inset-bottom, 0px))', md: 0 },
        }}
      >
        {/* Mobile AppBar */}
        {isMobile && (
          <AppBar
            position="sticky"
            color="default"
            elevation={0}
            sx={{
              borderBottom: 1,
              borderColor: 'outlineVariant',
              bgcolor: 'surface',
              // Keep the bar below the status bar when the PWA runs edge-to-edge
              pt: 'env(safe-area-inset-top, 0px)',
            }}
          >
            <Toolbar>
              {showBackButton ? (
                <IconButton
                  aria-label="Volver"
                  onClick={goBack}
                  edge="start"
                  sx={{ mr: 0.5, color: 'onSurface' }}
                >
                  <IconArrowBack size={22} />
                </IconButton>
              ) : (
                <IconButton
                  aria-label="Abrir menú"
                  onClick={() => setMenuOpen(true)}
                  edge="start"
                  sx={{ mr: 0.5, color: 'onSurface' }}
                >
                  <IconMenu size={24} />
                </IconButton>
              )}
              <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                <IconEgg size={24} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    component="div"
                    variant="titleMedium"
                    sx={{ fontWeight: 700, color: 'onSurface', lineHeight: 1.1 }}
                    noWrap
                  >
                    {APP_NAME}
                  </Typography>
                  {showTenantName && (
                    <Typography
                      component="div"
                      variant="labelSmall"
                      color="primary.main"
                      noWrap
                      sx={{ display: 'block', fontWeight: 700, lineHeight: 1.1 }}
                    >
                      {tenant!.name}
                    </Typography>
                  )}
                </Box>
              </Box>
              {isDriver && !installDismissed && (
                <IconButton
                  aria-label="Instalar app"
                  onClick={() => setInstallDismissed(false)}
                  color="primary"
                >
                  <IconDownload />
                </IconButton>
              )}
            </Toolbar>
          </AppBar>
        )}

        {/* Install banner (mobile, driver only) */}
        {isMobile && isDriver && !installDismissed && (
          <Box sx={{ px: 2 }}>
            <InstallBanner onDismiss={() => setInstallDismissed(true)} />
          </Box>
        )}

        {/* Page content */}
        <Box
          sx={{
            flex: 1,
            p: { xs: 2, sm: 3, md: 4 },
            maxWidth: 1200,
            width: '100%',
            minWidth: 0,
            mx: 'auto',
            // background.default ≠ surface → the canvas sits a step below
            // cards, so pages get real depth instead of flat beige-on-beige.
            bgcolor: 'background.default',
            overflowX: 'hidden',
          }}
        >
          {/* Offline banner — hidden on the driver's route page (it has its own richer indicator) */}
          {location.pathname !== '/my-route' && <OfflineBanner />}
          <Outlet />
        </Box>
      </Box>

      {/* Facebook-style left menu (hamburger) */}
      <AppMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        // Only the destinations that are NOT already in the bottom nav.
        items={moreItems.map((item) => ({ to: item.to, label: item.label, icon: item.icon }))}
        userName={user?.name}
        userRole={ROLE_LABELS[userRole]}
        tenantName={tenant?.name}
      />

      {/* ── Mobile bottom navigation (M3 nav bar: Inicio, Rutas, Registrar, Ajustes) ── */}
      {isMobile && (
        <Paper
          elevation={0}
          sx={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1200,
            pb: 'env(safe-area-inset-bottom, 0px)',
            bgcolor: 'surfaceContainer',
            borderRadius: 0,
            // Hairline top border instead of a heavy shadow (modern, clean)
            borderTop: 1,
            borderColor: 'outlineVariant',
          }}
        >
          <BottomNavigation
            showLabels
            value={navValue >= 0 ? navValue : 0}
            onChange={(_event, newValue) => {
              // The last slot is Settings — it is a real route now.
              if (newValue === moreIndex) {
                navigate('/settings');
                return;
              }
              const target = bottomItems[newValue];
              if (target) navigate(target.to);
            }}
            sx={{
              bgcolor: 'transparent',
              '& .MuiBottomNavigationAction-root': {
                minWidth: 56,
                borderRadius: m3Shape.full,
                mx: 0.25,
                my: 0.5,
                color: 'onSurfaceVariant',
                '& .MuiBottomNavigationAction-label': {
                  fontSize: '0.6875rem',
                  fontWeight: 500,
                },
                '&.Mui-selected': {
                  bgcolor: 'secondaryContainer',
                  color: 'onSecondaryContainer',
                  '& .MuiBottomNavigationAction-label': {
                    fontSize: '0.6875rem',
                    fontWeight: 700,
                  },
                },
              },
            }}
          >
            {bottomItems.map((item) => (
              <BottomNavigationAction
                key={item.to}
                label={item.label}
                icon={item.icon}
              />
            ))}
            <BottomNavigationAction
              value={moreIndex}
              label="Ajustes"
              icon={<IconSettings size={24} />}
            />
          </BottomNavigation>
        </Paper>
      )}
    </Box>
  );
}