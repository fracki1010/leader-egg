import { useRef, useState, useCallback } from 'react';
import type { RouteStop, StopStatus } from '../../types/index.ts';
import { IconArrowLeft, IconArrowRight } from '../ui/icons.tsx';

interface SwipeableStopCardProps {
  stop: RouteStop;
  onAdvance: (stop: RouteStop, newStatus: StopStatus) => void;
  onSkip: (stop: RouteStop) => void;
  onTap: (stop: RouteStop) => void;
  isLoading: boolean;
}

const SWIPE_THRESHOLD = 80;
const STATUS_ADVANCE: Record<StopStatus, StopStatus | null> = {
  pending: 'in_transit',
  in_transit: 'delivered',
  delivered: null,
  skipped: null,
};

const STATUS_LABELS: Record<StopStatus, string> = {
  pending: 'Pendiente',
  in_transit: 'En camino',
  delivered: 'Entregado',
  skipped: 'Saltado',
};

const STATUS_COLORS: Record<StopStatus, string> = {
  pending: 'var(--color-warning-500)',
  in_transit: 'var(--color-primary-500)',
  delivered: 'var(--color-success-500)',
  skipped: 'var(--color-neutral-400)',
};

const fmtMoney = (val: number) =>
  `$ ${val.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

export function SwipeableStopCard({
  stop,
  onAdvance,
  onSkip,
  onTap,
  isLoading,
}: SwipeableStopCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const currentX = useRef(0);
  const [offsetX, setOffsetX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const canAdvance = STATUS_ADVANCE[stop.status] !== null;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isLoading) return;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      startX.current = e.clientX;
      currentX.current = e.clientX;
      setIsDragging(true);
    },
    [isLoading],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      currentX.current = e.clientX;
      const dx = currentX.current - startX.current;
      // Only allow right swipe if can advance, left swipe always allowed
      if (dx > 0 && !canAdvance) return;
      setOffsetX(dx);
    },
    [isDragging, canAdvance],
  );

  const handlePointerUp = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);

    if (offsetX > SWIPE_THRESHOLD && canAdvance) {
      const nextStatus = STATUS_ADVANCE[stop.status]!;
      onAdvance(stop, nextStatus);
    } else if (offsetX < -SWIPE_THRESHOLD) {
      onSkip(stop);
    }
    setOffsetX(0);
  }, [isDragging, offsetX, canAdvance, stop, onAdvance, onSkip]);

  const handleTap = useCallback(() => {
    if (Math.abs(offsetX) > 5) return; // was a swipe, not tap
    onTap(stop);
  }, [offsetX, stop, onTap]);

  // Background colors based on swipe direction
  const rightBg =
    offsetX > 20
      ? `rgba(107, 155, 63, ${Math.min(offsetX / SWIPE_THRESHOLD, 0.9)})`
      : 'transparent';
  const leftBg =
    offsetX < -20
      ? `rgba(255, 140, 66, ${Math.min(Math.abs(offsetX) / SWIPE_THRESHOLD, 0.9)})`
      : 'transparent';

  return (
    <div style={styles.wrapper}>
      {/* Swipe-right background (advance) */}
      {canAdvance && (
        <div style={{ ...styles.swipeBg, ...styles.swipeBgRight, backgroundColor: rightBg }}>
          <span style={styles.swipeLabel}>
            <IconArrowRight size={14} /> {STATUS_LABELS[STATUS_ADVANCE[stop.status]!]}
          </span>
        </div>
      )}

      {/* Swipe-left background (skip) */}
      <div style={{ ...styles.swipeBg, ...styles.swipeBgLeft, backgroundColor: leftBg }}>
        <span style={styles.swipeLabel}>Saltear <IconArrowLeft size={14} /></span>
      </div>

      {/* Card */}
      <div
        ref={cardRef}
        style={{
          ...styles.card,
          transform: `translateX(${offsetX}px)`,
          transition: isDragging ? 'none' : 'transform 200ms cubic-bezier(0.4, 0, 0.2, 1)',
          touchAction: 'pan-y',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleTap}
        role="button"
        tabIndex={0}
        aria-label={`Parada ${stop.sequence}: ${stop.customerName}. ${STATUS_LABELS[stop.status]}. Toca para detalles.`}
      >
        {/* Status dot */}
        <div style={styles.header}>
          <div style={{ ...styles.statusDot, backgroundColor: STATUS_COLORS[stop.status] }} />
          <span style={styles.sequence}>#{stop.sequence}</span>
          <span style={styles.statusBadge}>{STATUS_LABELS[stop.status]}</span>
        </div>

        {/* Customer info */}
        <div style={styles.body}>
          <span style={styles.customerName}>{stop.customerName}</span>
          <span style={styles.address}>{stop.customerAddress}</span>
        </div>

        {/* Amount to collect (payment preference snapshot) */}
        {stop.balanceToCollect !== undefined && stop.balanceToCollect > 0 && (
          <div style={styles.collect}>
            <span style={styles.collectText}>Cobrar {fmtMoney(stop.balanceToCollect)}</span>
          </div>
        )}

        {/* Swipe hint */}
        {stop.status === 'pending' && (
          <span style={styles.hint}><IconArrowLeft size={12} /> Desliza <IconArrowRight size={12} /></span>
        )}
        {stop.status === 'in_transit' && (
          <span style={styles.hint}><IconArrowRight size={12} /> Desliza para entregar</span>
        )}
      </div>
    </div>
  );
}

/* ── Styles ─────────────────────────────────── */

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 'var(--radius-md)',
    marginBottom: 'var(--space-2)',
  },
  swipeBg: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    borderRadius: 'var(--radius-md)',
    transition: 'background-color 150ms ease',
  },
  swipeBgRight: {
    justifyContent: 'flex-start',
    paddingLeft: 'var(--space-5)',
  },
  swipeBgLeft: {
    justifyContent: 'flex-end',
    paddingRight: 'var(--space-5)',
  },
  swipeLabel: {
    fontFamily: 'var(--font-body)',
    fontSize: 'var(--text-body-sm)',
    fontWeight: 'var(--font-semibold)',
    color: 'white',
    textShadow: '0 1px 2px rgba(0,0,0,0.3)',
  },
  card: {
    position: 'relative',
    backgroundColor: 'var(--surface-raised)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    cursor: 'pointer',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    zIndex: 1,
    minHeight: '44px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    marginBottom: 'var(--space-2)',
  },
  statusDot: {
    width: '10px',
    height: '10px',
    borderRadius: 'var(--radius-full)',
    flexShrink: 0,
  },
  sequence: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-body-xs)',
    fontWeight: 'var(--font-semibold)',
    color: 'var(--text-tertiary)',
  },
  statusBadge: {
    fontFamily: 'var(--font-body)',
    fontSize: 'var(--text-body-xs)',
    fontWeight: 'var(--font-medium)',
    color: 'var(--text-secondary)',
    marginLeft: 'auto',
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  customerName: {
    fontFamily: 'var(--font-body)',
    fontSize: 'var(--text-body-md)',
    fontWeight: 'var(--font-semibold)',
    color: 'var(--text-primary)',
  },
  address: {
    fontFamily: 'var(--font-body)',
    fontSize: 'var(--text-body-sm)',
    color: 'var(--text-secondary)',
    lineHeight: 'var(--leading-snug)',
  },
  collect: {
    marginTop: 'var(--space-2)',
    paddingTop: 'var(--space-2)',
    borderTop: '1px solid var(--border-subtle)',
  },
  collectText: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-body-sm)',
    fontWeight: 'var(--font-semibold)',
    color: 'var(--color-warning-600, #b45309)',
  },
  hint: {
    fontFamily: 'var(--font-body)',
    fontSize: 'var(--text-body-xs)',
    color: 'var(--text-muted)',
    marginTop: 'var(--space-2)',
    textAlign: 'center' as const,
  },
};

/* ── Responsive ─────────────────────────────── */

const responsiveStyles = `
  @media (max-width: 768px) {
    [style*="card"] {
      padding: var(--space-3) !important;
    }
  }
`;

if (typeof document !== 'undefined') {
  const styleEl = document.createElement('style');
  styleEl.textContent = responsiveStyles;
  document.head.appendChild(styleEl);
}
