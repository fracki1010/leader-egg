import { forwardRef, type ReactNode } from 'react';
import TextField from '@mui/material/TextField';

interface MuiTextFieldProps {
  label?: string;
  placeholder?: string;
  value?: string;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  error?: boolean;
  helperText?: string;
  disabled?: boolean;
  required?: boolean;
  fullWidth?: boolean;
  type?: string;
  name?: string;
  id?: string;
  /** 'small' renders a compact 40px-high field; default 'medium' (56px). */
  size?: 'small' | 'medium';
  autoFocus?: boolean;
  autoComplete?: string;
  onFocus?: React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  onBlur?: React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  multiline?: boolean;
  rows?: number;
  className?: string;
  sx?: Record<string, unknown>;
  /** MUI v9 slotProps passthrough (e.g. input adornments, htmlInput attrs). */
  slotProps?: Record<string, unknown>;
  /** Renders a native <select> dropdown (MUI select variant). */
  select?: boolean;
  /** Select/MenuItem children when `select` is enabled. */
  children?: ReactNode;
}

/**
 * MuiTextField — Wrapper for MUI TextField with the brand input recipe.
 *
 * Brand style: WHITE background, rounded-xl (12px), shadow-sm, and a
 * soft primary/20 focus ring — inputs read as raised fields on the
 * warm cream canvas instead of flat tonal surfaces.
 */
export const MuiTextField = forwardRef<HTMLDivElement, MuiTextFieldProps>(
  (
    {
      label,
      placeholder,
      value,
      onChange,
      error = false,
      helperText,
      disabled = false,
      required = false,
      fullWidth = true,
      type = 'text',
      name,
      id,
      size = 'medium',
      autoFocus,
      autoComplete,
      onFocus,
      onBlur,
      multiline = false,
      rows,
      className,
      sx,
      slotProps,
      select = false,
      children,
    },
    ref,
  ) => {
    return (
      <TextField
        ref={ref}
        label={label}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        error={error}
        helperText={helperText}
        disabled={disabled}
        required={required}
        fullWidth={fullWidth}
        type={type}
        name={name}
        id={id}
        size={size}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        onFocus={onFocus}
        onBlur={onBlur}
        variant="outlined"
        multiline={multiline}
        rows={rows}
        className={className}
        sx={{
          '& .MuiOutlinedInput-root': {
            bgcolor: 'surfaceContainerLowest',
            borderRadius: '12px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 1px 4px rgba(0,0,0,0.04)',
            transition: 'box-shadow 0.2s, border-color 0.2s',
            '& fieldset': {
              borderColor: 'outlineVariant',
            },
            '&:hover fieldset': {
              borderColor: 'outline',
            },
            '&.Mui-focused': {
              boxShadow: '0 0 0 4px color-mix(in srgb, var(--mui-palette-primary-main) 20%, transparent)',
              '& fieldset': {
                borderWidth: 1,
                borderColor: 'primary.main',
              },
            },
            '&.Mui-error.Mui-focused': {
              boxShadow: '0 0 0 4px color-mix(in srgb, var(--mui-palette-error-main) 18%, transparent)',
            },
          },
          ...sx,
        }}
        slotProps={slotProps}
        select={select}
      >
        {children}
      </TextField>
    );
  },
);

MuiTextField.displayName = 'MuiTextField';