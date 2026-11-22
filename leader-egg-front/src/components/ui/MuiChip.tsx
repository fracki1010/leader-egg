import Chip from '@mui/material/Chip';
import { IconCheck, IconWarning, IconX } from './icons';

type ChipColor = 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info';

interface MuiChipProps {
  label: string;
  color?: ChipColor;
  variant?: 'filled' | 'outlined';
  size?: 'small' | 'medium';
  onClick?: () => void;
  onDelete?: () => void;
  icon?: React.ReactElement;
  /** Auto-add a semantic status icon (check/warning/x) based on `color` */
  statusIcon?: boolean;
  className?: string;
  sx?: Record<string, unknown>;
}

const STATUS_ICONS: Partial<Record<ChipColor, React.ReactElement>> = {
  success: <IconCheck size={14} />,
  warning: <IconWarning size={14} />,
  error: <IconX size={14} />,
};

/**
 * MuiChip — Wrapper for MUI Chip for status badges, tags, and filters.
 *
 * Maps the project's status badge needs to MUI Chip.
 * Supports optional delete icon for removable chips and automatic
 * semantic status icons (check/warning/x) for quick scanning.
 */
export function MuiChip({
  label,
  color = 'default',
  variant = 'filled',
  size = 'small',
  onClick,
  onDelete,
  icon,
  statusIcon = false,
  className,
  sx,
}: MuiChipProps) {
  const effectiveIcon = icon ?? (statusIcon ? STATUS_ICONS[color] : undefined);
  return (
    <Chip
      label={label}
      color={color}
      variant={variant}
      size={size}
      onClick={onClick}
      onDelete={onDelete}
      icon={effectiveIcon}
      className={className}
      sx={sx}
    />
  );
}