import { Navigate, Outlet } from 'react-router-dom';
import { usePlatformAuthStore } from '../stores/platformAuthStore.ts';

/**
 * PlatformGuard — gates the platform admin area.
 *
 * Independent from the tenant `ProtectedRoute`: it only checks the platform
 * token store and sends unauthenticated visitors to `/platform/login`.
 */
export function PlatformGuard() {
  const isAuthenticated = usePlatformAuthStore((s) => s.isAuthenticated);

  if (!isAuthenticated) {
    return <Navigate to="/platform/login" replace />;
  }

  return <Outlet />;
}
