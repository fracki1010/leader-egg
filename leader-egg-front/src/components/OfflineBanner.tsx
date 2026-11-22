import { useEffect, useRef, useState } from 'react';
import { isOnline, onOfflineStatusChange } from '../lib/offline-status.ts';
import { MuiSnackbar } from './ui/index.ts';
import { IconCloudDone, IconCloudOff } from './ui/icons.tsx';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

const RECONNECTED_DURATION_MS = 3000;

/**
 * M3 connectivity banner shown at the top of the app shell:
 * - offline → "Sin conexión — mostrando datos guardados" (persistent)
 * - back online → "Conectado — datos actualizados" (brief confirmation)
 * Also surfaces a snackbar whenever a write was queued locally while offline.
 */
export function OfflineBanner() {
  const [online, setOnline] = useState(isOnline());
  const [reconnected, setReconnected] = useState(false);
  const [queuedOpen, setQueuedOpen] = useState(false);
  const [queuedMessage, setQueuedMessage] = useState('Guardado sin conexión — se sincronizará');
  const reconnectedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = onOfflineStatusChange((detail) => {
      if (detail.online) {
        setOnline(true);
        setReconnected(true);
        if (reconnectedTimer.current) clearTimeout(reconnectedTimer.current);
        reconnectedTimer.current = setTimeout(() => setReconnected(false), RECONNECTED_DURATION_MS);
      } else {
        setOnline(false);
        setReconnected(false);
      }
    });

    const handleWriteQueued = () => {
      setQueuedMessage('Guardado sin conexión — se sincronizará');
      setQueuedOpen(true);
    };
    window.addEventListener('offline:write-queued', handleWriteQueued);

    return () => {
      unsubscribe();
      window.removeEventListener('offline:write-queued', handleWriteQueued);
      if (reconnectedTimer.current) clearTimeout(reconnectedTimer.current);
    };
  }, []);

  if (online && !reconnected) return null;

  if (online) {
    // Just came back online — brief confirmation
    return (
      <Box
        role="status"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          p: 1.5,
          mb: 2,
          bgcolor: 'successContainer',
          border: 1,
          borderColor: 'outlineVariant',
          borderRadius: 2,
          color: 'onSuccessContainer',
        }}
      >
        <IconCloudDone size={18} />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          Conectado — datos actualizados
        </Typography>
      </Box>
    );
  }

  return (
    <>
      <Box
        role="alert"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          p: 1.5,
          mb: 2,
          bgcolor: 'warningContainer',
          border: 1,
          borderColor: 'outlineVariant',
          borderRadius: 2,
          color: 'onWarningContainer',
        }}
      >
        <IconCloudOff size={18} />
        <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>
          Sin conexión — mostrando datos guardados
        </Typography>
      </Box>
      <MuiSnackbar
        open={queuedOpen}
        onClose={() => setQueuedOpen(false)}
        message={queuedMessage}
        severity="warning"
      />
    </>
  );
}