import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore.ts';
import { isOnline } from '../lib/offline-status.ts';

/**
 * Refresh the cached session (role + permissions) once on app boot.
 *
 * Runs only when a session already exists and the browser reports being online.
 * Offline boot keeps the cached session; the next fresh login refreshes it.
 */
export function useSessionRefresh(): void {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const refreshSession = useAuthStore((state) => state.refreshSession);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    if (!isAuthenticated) return;
    if (!isOnline()) return;
    done.current = true;
    void refreshSession();
  }, [isAuthenticated, refreshSession]);
}
