import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

interface HistoryState {
  idx?: number;
}

/**
 * History-aware "go back" callback.
 *
 * When the current session has a previous history entry, this navigates back
 * (a POP navigation, so `ScrollRestoration` restores the previous position).
 * On a deep link or a freshly loaded tab there is nothing to go back to, so it
 * falls back to `fallbackPath` with a REPLACE navigation.
 *
 * @param fallbackPath Route to use when there is no previous history entry.
 */
export function useSmartBack(fallbackPath: string): () => void {
  const navigate = useNavigate();

  return useCallback(() => {
    const historyIndex = (window.history.state as HistoryState | null)?.idx ?? 0;

    if (historyIndex > 0) {
      navigate(-1);
      return;
    }

    navigate(fallbackPath, { replace: true });
  }, [navigate, fallbackPath]);
}
