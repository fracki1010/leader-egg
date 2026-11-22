import IconButton from '@mui/material/IconButton';

interface MuiIconButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  'aria-label': string;
  size?: 'small' | 'medium' | 'large';
  color?: 'default' | 'inherit' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';
  disabled?: boolean;
  className?: string;
  sx?: Record<string, unknown>;
}

/**
 * MuiIconButton — Wrapper for MUI IconButton with 48×48dp touch target.
 *
 * Enforces M3's minimum touch target size (48×48dp) for accessibility.
 * Requires aria-label for screen reader support.
 */
export function MuiIconButton({
  children,
  onClick,
  'aria-label': ariaLabel,
  size = 'medium',
  color = 'default',
  disabled = false,
  className,
  sx,
}: MuiIconButtonProps) {
  return (
    <IconButton
      onClick={onClick}
      aria-label={ariaLabel}
      size={size}
      color={color}
      disabled={disabled}
      className={className}
      sx={{
        width: 48,
        height: 48,
        ...sx,
      }}
    >
      {children}
    </IconButton>
  );
}
