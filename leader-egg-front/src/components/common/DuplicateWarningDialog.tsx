import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import { MuiButton, MuiDialog } from '../ui/index.ts';
import { ApiError } from '../../api/client.ts';

export interface DuplicateRecordInfo {
  existingId: string;
  existingNumber: string;
  existingCreatedAt: string;
}

/**
 * Extracts the structured 409 payload returned by the backend. Returns null
 * for every other error so callers keep their normal error handling.
 */
export function getDuplicateRecordInfo(err: unknown): DuplicateRecordInfo | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const data = err.data as Partial<DuplicateRecordInfo> & { code?: string };
  if (
    !data ||
    data.code !== 'DUPLICATE_RECORD' ||
    typeof data.existingId !== 'string' ||
    typeof data.existingNumber !== 'string'
  ) {
    return null;
  }
  return {
    existingId: data.existingId,
    existingNumber: data.existingNumber,
    existingCreatedAt: typeof data.existingCreatedAt === 'string' ? data.existingCreatedAt : '',
  };
}

export interface DuplicateWarningDialogProps {
  open: boolean;
  resource: 'order' | 'purchase';
  /** Number of the record already stored (ORD-… / PUR-…). */
  existingNumber: string;
  /** Id of the record already stored — used by `onView`. */
  existingId: string;
  /** True while the forced create is in flight. */
  busy?: boolean;
  /** Navigate to the existing record. */
  onView: () => void;
  /** Resubmit the same payload with `forceDuplicate: true`. */
  onForce: () => void;
  /** Dismiss without creating anything. */
  onCancel: () => void;
}

/**
 * Confirmation shown when the backend rejects a create with
 * `DUPLICATE_RECORD`. It never retries on its own: the user either opens the
 * existing record, explicitly forces a second identical record, or cancels.
 */
export function DuplicateWarningDialog({
  open,
  resource,
  existingNumber,
  busy = false,
  onView,
  onForce,
  onCancel,
}: DuplicateWarningDialogProps) {
  // Second confirmation step for the destructive "create anyway" action.
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (open) setConfirming(false);
  }, [open, existingNumber]);

  const noun = resource === 'order' ? 'pedido' : 'compra';
  const article = resource === 'order' ? 'un' : 'una';
  const pastParticiple = resource === 'order' ? 'creado' : 'creada';
  const another = resource === 'order' ? 'otro' : 'otra';
  const identical = resource === 'order' ? 'idéntico' : 'idéntica';
  const viewLabel = resource === 'order' ? 'Ver el pedido' : 'Ver la compra';
  const forceLabel = resource === 'order' ? 'Sí, crear otro' : 'Sí, crear otra';

  return (
    <MuiDialog
      open={open}
      onClose={busy ? () => undefined : onCancel}
      title="Posible duplicado"
      maxWidth="xs"
      actions={
        confirming ? (
          <>
            <MuiButton variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Volver
            </MuiButton>
            <MuiButton variant="danger" onClick={onForce} isLoading={busy} disabled={busy}>
              {forceLabel}
            </MuiButton>
          </>
        ) : (
          <>
            <MuiButton variant="ghost" onClick={onCancel} disabled={busy}>
              Cancelar
            </MuiButton>
            <MuiButton variant="secondary" onClick={onView} disabled={busy}>
              {viewLabel}
            </MuiButton>
            <MuiButton variant="danger" onClick={() => setConfirming(true)} disabled={busy}>
              Crear igual
            </MuiButton>
          </>
        )
      }
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="body1">
          Ya existe {article} {noun} igual ({existingNumber}) {pastParticiple} hace menos de 5 minutos.
        </Typography>
        <Alert severity="warning">
          Revisá {article === 'un' ? 'el' : 'la'} {noun} existente antes de crear {another}. Si no lo
          ves, confirmá que querés registrar {article} {noun} {identical}.
        </Alert>
        {confirming && (
          <Alert severity="error" role="alert">
            Se va a registrar {another} {noun} {identical}. Esta acción no se puede deshacer sola.
          </Alert>
        )}
      </Box>
    </MuiDialog>
  );
}
