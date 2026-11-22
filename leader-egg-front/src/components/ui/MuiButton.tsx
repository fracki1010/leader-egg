import { forwardRef, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface MuiButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  disabled?: boolean;
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  fullWidth?: boolean;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  className?: string;
  sx?: Record<string, unknown>;
}

const variantMap: Record<ButtonVariant, 'contained' | 'outlined' | 'text'> = {
  primary: 'contained',
  secondary: 'contained', // surface-container filled, not outlined
  danger: 'contained',
  ghost: 'text',
};

const sizeMap: Record<ButtonSize, 'small' | 'medium' | 'large'> = {
  sm: 'small',
  md: 'medium',
  lg: 'large',
};

/**
 * MuiButton — Wrapper for MUI Button with project-specific variants.
 *
 * Brand recipe (rounded-xl, weight 600 labels):
 * - primary:   filled with `primary` bg, 12px radius, min-height 44–48
 * - secondary: filled with `surface-container` (warm neutral)
 * - danger:    filled with `error` bg
 * - ghost:     text button
 *
 * All buttons get an `active:scale` press feel and ≥ 44px touch targets.
 */
export const MuiButton = forwardRef<HTMLButtonElement, MuiButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      disabled = false,
      children,
      onClick,
      type = 'button',
      fullWidth = false,
      startIcon,
      endIcon,
      className,
      sx,
    },
    ref,
  ) => {
    return (
      <Button
        ref={ref}
        variant={variantMap[variant]}
        color={variant === 'danger' ? 'error' : variant === 'secondary' ? 'inherit' : 'primary'}
        size={sizeMap[size]}
        disabled={disabled || isLoading}
        onClick={onClick}
        type={type}
        fullWidth={fullWidth}
        startIcon={isLoading ? undefined : startIcon}
        endIcon={isLoading ? undefined : endIcon}
        className={className}
        sx={{
          minHeight: 44, // ≥ 44dp touch target
          ...(variant === 'secondary' && {
            bgcolor: 'surfaceContainer',
            color: 'onSurface',
            boxShadow: 'none',
            '&:hover': {
              bgcolor: 'surfaceContainerHigh',
              boxShadow: 'none',
            },
          }),
          ...sx,
        }}
      >
        {isLoading ? (
          <CircularProgress size={20} color="inherit" thickness={4} />
        ) : (
          children
        )}
      </Button>
    );
  },
);

MuiButton.displayName = 'MuiButton';