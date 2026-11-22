import { useCallback, useEffect, useState } from 'react';

/** Build id inlined by Vite at build time (see `define` in vite.config.ts). */
export const RUNNING_BUILD_ID: string = __BUILD_ID__;

/** How often a visible tab asks whether a newer build was published. */
const POLL_INTERVAL_MS = 60_000;

interface RemoteVersion {
  buildId: string;
}

/**
 * Fetches `version.json` bypassing every cache layer (HTTP cache, service
 * worker, CDN edge). A stale answer here would silently reintroduce the
 * "I don't see the new version" bug this hook exists to prevent.
 */
const fetchRemoteBuildId = async (): Promise<string | null> => {
  try {
    const response = await fetch(`/version.json?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'cache-control': 'no-cache' },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as RemoteVersion;
    return typeof data.buildId === 'string' && data.buildId ? data.buildId : null;
  } catch {
    // Offline or a transient network error: keep the current build silently.
    return null;
  }
};

/**
 * One-shot version check shared by the global update banner and the manual
 * "Buscar actualización" action in Settings. Returns true when the deployed
 * build differs from the running one.
 */
export const checkForNewVersion = async (): Promise<boolean> => {
  const remote = await fetchRemoteBuildId();
  return remote !== null && remote !== RUNNING_BUILD_ID;
};

export interface NewVersionState {
  /** True when the deployed build differs from the running one. */
  updateAvailable: boolean;
  /** Re-check right now (used by the "Actualizar" action before reloading). */
  checkNow: () => Promise<boolean>;
  /** Hide the prompt for this build until the app is reloaded. */
  dismiss: () => void;
}

/**
 * Detects a newer deployed build without relying on the service worker.
 *
 * Checks on mount, every minute while visible, and whenever the tab regains
 * focus or comes back online — the exact moments a long-lived PWA misses.
 */
export function useNewVersion(): NewVersionState {
  const [remoteBuildId, setRemoteBuildId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const checkNow = useCallback(async (): Promise<boolean> => {
    const remote = await fetchRemoteBuildId();
    setRemoteBuildId(remote);
    return remote !== null && remote !== RUNNING_BUILD_ID;
  }, []);

  useEffect(() => {
    void checkNow();

    const checkIfVisible = () => {
      if (document.visibilityState === 'visible') void checkNow();
    };

    const interval = window.setInterval(checkIfVisible, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', checkIfVisible);
    window.addEventListener('online', checkIfVisible);
    window.addEventListener('focus', checkIfVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', checkIfVisible);
      window.removeEventListener('online', checkIfVisible);
      window.removeEventListener('focus', checkIfVisible);
    };
  }, [checkNow]);

  const updateAvailable =
    !dismissed && remoteBuildId !== null && remoteBuildId !== RUNNING_BUILD_ID;

  return {
    updateAvailable,
    checkNow,
    dismiss: () => setDismissed(true),
  };
}
