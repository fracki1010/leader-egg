import { useState, useEffect, useCallback } from 'react';
import { IconMobile } from '../ui/icons.tsx';

interface InstallBannerProps {
  onDismiss: () => void;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallBanner({ onDismiss }: InstallBannerProps) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isAlreadyInstalled, setIsAlreadyInstalled] = useState(false);

  useEffect(() => {
    // Check if already installed (standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsAlreadyInstalled(true);
      return;
    }

    // Check iOS standalone
    if ((window.navigator as any).standalone === true) {
      setIsAlreadyInstalled(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    setIsInstalling(true);

    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        onDismiss();
      }
    } finally {
      setIsInstalling(false);
      setDeferredPrompt(null);
    }
  }, [deferredPrompt, onDismiss]);

  // Don't show if already installed or no prompt available
  if (isAlreadyInstalled || !deferredPrompt) return null;

  return (
    <div style={styles.banner} role="alert">
      <div style={styles.icon}><IconMobile size={24} /></div>
      <div style={styles.text}>
        <span style={styles.title}>Instalar El Huevo Líder</span>
        <span style={styles.subtitle}>Acceso rápido desde tu pantalla de inicio</span>
      </div>
      <div style={styles.actions}>
        <button
          style={styles.installBtn}
          onClick={handleInstall}
          disabled={isInstalling}
        >
          {isInstalling ? 'Instalando...' : 'Instalar'}
        </button>
        <button style={styles.dismissBtn} onClick={onDismiss} aria-label="Omitir">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/* ── Styles ─────────────────────────────────── */

const styles: Record<string, React.CSSProperties> = {
  banner: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    padding: 'var(--space-3) var(--space-4)',
    backgroundColor: 'var(--color-primary-50)',
    border: '1px solid var(--color-primary-200)',
    borderRadius: 'var(--radius-md)',
    marginBottom: 'var(--space-4)',
    minHeight: '44px',
  },
  icon: {
    fontSize: '1.5rem',
    lineHeight: 1,
    flexShrink: 0,
  },
  text: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: 'var(--font-body)',
    fontSize: 'var(--text-body-sm)',
    fontWeight: 'var(--font-semibold)',
    color: 'var(--text-primary)',
  },
  subtitle: {
    fontFamily: 'var(--font-body)',
    fontSize: 'var(--text-body-xs)',
    color: 'var(--text-secondary)',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    flexShrink: 0,
  },
  installBtn: {
    fontFamily: 'var(--font-body)',
    fontSize: 'var(--text-body-sm)',
    fontWeight: 'var(--font-semibold)',
    color: 'var(--surface-overlay)',
    backgroundColor: 'var(--color-primary-500)',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    padding: 'var(--space-2) var(--space-4)',
    cursor: 'pointer',
    minHeight: '44px',
    minWidth: '44px',
    transition: 'background-color var(--transition-fast)',
  },
  dismissBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '44px',
    height: '44px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-tertiary)',
    cursor: 'pointer',
    borderRadius: 'var(--radius-sm)',
  },
};
