import { useRef, useState, useCallback, useEffect, type ReactNode } from 'react';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

const DISMISS_THRESHOLD = 100;

export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  // Animate in/out
  useEffect(() => {
    if (open) {
      setIsVisible(true);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // Clean up drag state after animation
  useEffect(() => {
    if (!isDragging && dragY !== 0) {
      const timer = setTimeout(() => setDragY(0), 300);
      return () => clearTimeout(timer);
    }
  }, [isDragging, dragY]);

  const handleBackdropClick = useCallback(() => {
    onClose();
  }, [onClose]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    startY.current = e.clientY;
    setIsDragging(true);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      const dy = e.clientY - startY.current;
      if (dy > 0) {
        setDragY(dy);
      }
    },
    [isDragging],
  );

  const handlePointerUp = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    if (dragY > DISMISS_THRESHOLD) {
      onClose();
    }
    setDragY(0);
  }, [isDragging, dragY, onClose]);

  if (!isVisible) return null;

  const translateY = isDragging ? dragY : open ? 0 : 100;

  return (
    <div style={{ ...styles.backdrop, opacity: open ? 1 : 0 }} onClick={handleBackdropClick}>
      {/* Sheet */}
      <div
        ref={sheetRef}
        style={{
          ...styles.sheet,
          transform: `translateY(${translateY}%)`,
          transition: isDragging
            ? 'none'
            : 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div style={styles.handleArea}>
          <div style={styles.handle} />
        </div>

        {/* Title */}
        {title && (
          <div style={styles.header}>
            <h3 style={styles.title}>{title}</h3>
            <button style={styles.closeBtn} onClick={onClose} aria-label="Cerrar">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        {/* Content */}
        <div style={styles.body}>{children}</div>
      </div>
    </div>
  );
}

/* ── Styles ─────────────────────────────────── */

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 'var(--z-modal)',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    transition: 'opacity 200ms ease',
  },
  sheet: {
    position: 'relative',
    width: '100%',
    maxWidth: '480px',
    maxHeight: '85vh',
    backgroundColor: 'var(--surface-overlay)',
    borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
    boxShadow: 'var(--shadow-lg)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    touchAction: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  },
  handleArea: {
    display: 'flex',
    justifyContent: 'center',
    padding: 'var(--space-3) 0 var(--space-2)',
    cursor: 'grab',
  },
  handle: {
    width: '36px',
    height: '4px',
    borderRadius: 'var(--radius-full)',
    backgroundColor: 'var(--color-neutral-300)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 var(--space-5) var(--space-3)',
    borderBottom: '1px solid var(--border-subtle)',
  },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--text-body-lg)',
    fontWeight: 'var(--font-semibold)',
    color: 'var(--text-primary)',
    margin: 0,
  },
  closeBtn: {
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
    flexShrink: 0,
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: 'var(--space-5)',
    WebkitOverflowScrolling: 'touch',
  },
};
