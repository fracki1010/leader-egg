import { useRef, useState, useCallback, type ReactNode } from 'react';

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: ReactNode;
  disabled?: boolean;
}

const PULL_THRESHOLD = 64;
const MAX_PULL = 100;

export function PullToRefresh({ onRefresh, children, disabled = false }: PullToRefreshProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const [pullY, setPullY] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || isRefreshing) return;
      const el = containerRef.current;
      if (el && el.scrollTop > 0) return; // only pull at top
      startY.current = e.clientY;
      setIsPulling(true);
    },
    [disabled, isRefreshing],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isPulling || disabled || isRefreshing) return;
      const dy = e.clientY - startY.current;
      if (dy > 0) {
        // Rubber-band effect: diminishing returns past threshold
        const dampened = Math.min(dy * 0.5, MAX_PULL);
        setPullY(dampened);
      }
    },
    [isPulling, disabled, isRefreshing],
  );

  const handlePointerUp = useCallback(async () => {
    if (!isPulling) return;
    setIsPulling(false);

    if (pullY >= PULL_THRESHOLD && !isRefreshing) {
      setIsRefreshing(true);
      setPullY(PULL_THRESHOLD * 0.6);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullY(0);
      }
    } else {
      setPullY(0);
    }
  }, [isPulling, pullY, isRefreshing, onRefresh]);

  const rotation = pullY >= PULL_THRESHOLD ? 180 : (pullY / PULL_THRESHOLD) * 180;
  const showIndicator = pullY > 10 || isRefreshing;

  return (
    <div
      ref={containerRef}
      style={{
        ...styles.container,
        transform: pullY > 0 ? `translateY(${pullY}px)` : undefined,
        transition: isPulling ? 'none' : 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Pull indicator */}
      {showIndicator && (
        <div
          style={{
            ...styles.indicator,
            opacity: Math.min(pullY / PULL_THRESHOLD, 1),
            height: `${Math.max(pullY, 0)}px`,
          }}
        >
          {isRefreshing ? (
            <div style={styles.spinner} />
          ) : (
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-primary-500)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transform: `rotate(${rotation}deg)`,
                transition: isPulling ? 'none' : 'transform 300ms ease',
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          )}
        </div>
      )}

      {/* Content */}
      <div style={styles.content}>{children}</div>
    </div>
  );
}

/* ── Styles ─────────────────────────────────── */

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'relative',
    overflow: 'hidden',
    touchAction: 'pan-x',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  },
  indicator: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    transition: 'height 300ms cubic-bezier(0.4, 0, 0.2, 1)',
    flexShrink: 0,
  },
  spinner: {
    width: '24px',
    height: '24px',
    border: '2px solid var(--color-primary-200)',
    borderTopColor: 'var(--color-primary-500)',
    borderRadius: 'var(--radius-full)',
    animation: 'ptr-spin 0.8s linear infinite',
  },
  content: {
    position: 'relative',
    zIndex: 1,
  },
};

/* ── Keyframes + Responsive ─────────────────── */

const injectStyles = `
  @keyframes ptr-spin {
    to { transform: rotate(360deg); }
  }
`;

if (typeof document !== 'undefined') {
  const styleEl = document.createElement('style');
  styleEl.textContent = injectStyles;
  document.head.appendChild(styleEl);
}
