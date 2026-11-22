import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import { useNewVersion } from '../../lib/app-version.ts';

/** How often the service worker itself is asked for a new revision. */
const SW_CHECK_INTERVAL_MS = 60_000;
/** Grace period before falling back to a hard reset. */
const HARD_RESET_DELAY_MS = 2500;

/** Refresh glyph, inline so the banner has no extra dependency. */
function IconRefresh({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 11a8 8 0 1 0-2.34 5.66M20 5v6h-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Unregisters every service worker and wipes its caches, then reloads.
 * The last-resort path: it guarantees a fresh index.html + bundle even when a
 * stale worker refuses to hand over control. The app re-precaches on next load.
 */
const hardReset = async (): Promise<void> => {
  try {
    const registrations = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(registrations.map((registration) => registration.unregister()));
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    // Best effort — the reload below still runs.
  }
  window.location.reload();
};

/**
 * UpdatePrompt — floating "new version" card.
 *
 * Two independent signals, so the prompt cannot be missed:
 *  1. `version.json` (network, never cached) compared with the running build —
 *     works even if the service worker is stuck.
 *  2. The service worker's own `needRefresh`, refreshed every minute.
 *
 * "Actualizar ahora" asks the worker to activate (which reloads the page); if
 * the page is still alive shortly after, it falls back to a hard reset.
 */
export function UpdatePrompt() {
  const { updateAvailable, dismiss } = useNewVersion();
  const [applying, setApplying] = useState(false);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      if (!registration) return;
      window.setInterval(async () => {
        // Skip while installing or offline: `update()` would fail or no-op.
        if (registration.installing) return;
        if ('connection' in navigator && !navigator.onLine) return;
        try {
          const response = await fetch(swUrl, {
            cache: 'no-store',
            headers: { 'cache': 'no-store', 'cache-control': 'no-cache' },
          });
          if (response?.status === 200) await registration.update();
        } catch {
          // Transient — the next tick retries.
        }
      }, SW_CHECK_INTERVAL_MS);
    },
    onRegisterError(error) {
      // A failed registration must never break the app shell.
      console.error('Service worker registration failed', error);
    },
  });

  // If the worker activates and the page is still here (some browsers keep the
  // old document alive), reload anyway once the user asked for the update.
  useEffect(() => {
    if (!applying) return;
    const timer = window.setTimeout(() => {
      void hardReset();
    }, HARD_RESET_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [applying]);

  const open = updateAvailable || needRefresh;

  if (!open) return null;

  const handleUpdate = () => {
    setApplying(true);

    void (async () => {
      // With autoUpdate the fresh worker is usually already activated, so a
      // plain reload is enough (and keeps the precache). If a worker is still
      // waiting, ask it to take over — that path reloads by itself.
      const registration = await navigator.serviceWorker?.getRegistration?.();
      if (registration?.waiting) {
        void updateServiceWorker(true);
        return;
      }
      window.location.reload();
    })();
  };

  const handleDismiss = () => {
    setNeedRefresh(false);
    dismiss();
  };

  return (
    <Box
      role="region"
      aria-label="Actualización de la aplicación"
      sx={{
        position: 'fixed',
        zIndex: 1500,
        left: { xs: 12, sm: 'auto' },
        right: { xs: 12, sm: 24 },
        // Mobile: under the sticky app bar. The bottom edge is owned by the
        // fixed bottom navigation + the FAB, so a bottom card overlapped both.
        top: { xs: 'calc(env(safe-area-inset-top, 0px) + 72px)', sm: 'auto' },
        bottom: { xs: 'auto', sm: 24 },
        width: { xs: 'auto', sm: 400 },
        borderRadius: '20px',
        border: '1px solid',
        borderColor: 'outlineVariant',
        bgcolor: 'surfaceContainerHigh',
        color: 'onSurface',
        boxShadow: '0 16px 48px rgba(0, 0, 0, 0.22)',
        p: 2,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.5,
        animation: 'updatePromptIn 280ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        '@keyframes updatePromptIn': {
          from: { opacity: 0, transform: 'translateY(14px) scale(0.98)' },
          to: { opacity: 1, transform: 'translateY(0) scale(1)' },
        },
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      }}
    >
      <Box
        aria-hidden="true"
        sx={{
          flexShrink: 0,
          width: 40,
          height: 40,
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'primaryContainer',
          color: 'onPrimaryContainer',
        }}
      >
        {applying ? <CircularProgress size={20} color="inherit" /> : <IconRefresh />}
      </Box>

      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box role="status" aria-live="polite">
          <Typography variant="titleSmall" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
            Nueva versión disponible
          </Typography>
          <Typography variant="body2" color="onSurfaceVariant" sx={{ mt: 0.25, lineHeight: 1.45 }}>
            Actualizá para ver los últimos cambios.
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1.5, ml: -1 }}>
          <Button
            size="small"
            variant="contained"
            disableElevation
            onClick={handleUpdate}
            disabled={applying}
            aria-label="Actualizar a la nueva versión"
            sx={{ borderRadius: '10px', textTransform: 'none', fontWeight: 700, px: 2 }}
          >
            {applying ? 'Actualizando…' : 'Actualizar ahora'}
          </Button>
          <Button
            size="small"
            variant="text"
            onClick={handleDismiss}
            disabled={applying}
            sx={{ borderRadius: '10px', textTransform: 'none', color: 'onSurfaceVariant' }}
          >
            Después
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
