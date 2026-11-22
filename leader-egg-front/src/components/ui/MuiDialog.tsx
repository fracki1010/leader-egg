import { useId, type ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import IconButton from '@mui/material/IconButton';
import { IconX } from './icons';

interface MuiDialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  fullWidth?: boolean;
}

/**
 * MuiDialog — Wrapper for MUI Dialog with focus trap, ESC close, and slots.
 *
 * Provides title/content/footer (actions) slot pattern per M3 spec.
 * Focus is trapped inside the dialog. ESC key closes it.
 * Title has a close button for dismissal.
 */
export function MuiDialog({
  open,
  onClose,
  title,
  children,
  actions,
  maxWidth = 'sm',
  fullWidth = true,
}: MuiDialogProps) {
  const titleId = useId();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={maxWidth}
      fullWidth={fullWidth}
      aria-labelledby={title ? titleId : undefined}
    >
      {title && (
        <DialogTitle
          id={titleId}
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            pb: 1,
            typography: 'titleLarge',
          }}
        >
          {title}
          <IconButton
            aria-label="close"
            onClick={onClose}
            size="small"
          >
            <IconX size={18} />
          </IconButton>
        </DialogTitle>
      )}
      <DialogContent dividers>{children}</DialogContent>
      {actions && <DialogActions>{actions}</DialogActions>}
    </Dialog>
  );
}