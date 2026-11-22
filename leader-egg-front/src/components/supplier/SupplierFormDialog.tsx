import { useEffect, useState, type FormEvent } from 'react';
import type { CreateSupplierPayload, UpdateSupplierPayload } from '../../api/suppliers.ts';
import { useCreateSupplier, useUpdateSupplier } from '../../hooks/mutations/index.ts';
import { isOfflineQueuedError } from '../../hooks/use-offline-mutation.ts';
import type { Supplier } from '../../types/index.ts';
import { MuiButton, MuiDialog, MuiTextField } from '../ui/index.ts';
import { IconStore } from '../ui/icons.tsx';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import InputAdornment from '@mui/material/InputAdornment';

interface FormData {
  name: string;
  contact: string;
  phone: string;
}

const emptyForm: FormData = { name: '', contact: '', phone: '' };

interface SupplierFormDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  /** Supplier being edited (null when creating). */
  supplier: Supplier | null;
  onClose: () => void;
  /** Called after a successful create/update with the confirmation message. */
  onSaved: (message: string) => void;
}

/**
 * SupplierFormDialog — M3 create/edit dialog for suppliers.
 * Name is the only required field; contact and phone are optional.
 */
export function SupplierFormDialog({ open, mode, supplier, onClose, onSaved }: SupplierFormDialogProps) {
  const [form, setForm] = useState<FormData>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  // Create/update writes — offline-aware: a queued write is a success.
  const createSupplier = useCreateSupplier();
  const updateSupplier = useUpdateSupplier();
  const submitting = createSupplier.isPending || updateSupplier.isPending;

  // Sync form state whenever the dialog opens with a (possibly different) supplier
  useEffect(() => {
    if (!open) return;
    setForm({
      name: supplier?.name ?? '',
      contact: supplier?.contact ?? '',
      phone: supplier?.phone ?? '',
    });
    setFormError(null);
  }, [open, supplier, mode]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (form.name.trim().length < 2) {
      setFormError('El nombre debe tener al menos 2 caracteres');
      return;
    }

    const payload: CreateSupplierPayload & UpdateSupplierPayload = {
      name: form.name.trim(),
      contact: form.contact.trim() || undefined,
      phone: form.phone.trim() || undefined,
    };

    const handleSaved = (message: string) => {
      onClose();
      onSaved(message);
    };

    const handleError = (err: unknown) => {
      // Offline queued write: normal outcome, the OfflineBanner already confirmed it.
      if (isOfflineQueuedError(err)) {
        onClose();
        onSaved('Guardado sin conexión');
        return;
      }
      setFormError(err instanceof Error ? err.message : 'Error al guardar proveedor');
    };

    if (mode === 'create') {
      createSupplier.mutate(payload, {
        onSuccess: () => handleSaved('Proveedor creado'),
        onError: handleError,
      });
    } else if (supplier) {
      updateSupplier.mutate(
        { id: supplier._id, data: payload },
        {
          onSuccess: () => handleSaved('Proveedor actualizado'),
          onError: handleError,
        },
      );
    }
  };

  return (
    <MuiDialog
      open={open}
      onClose={onClose}
      title={mode === 'create' ? 'Nuevo Proveedor' : 'Editar Proveedor'}
      maxWidth="sm"
      actions={
        <>
          <MuiButton variant="secondary" onClick={onClose} disabled={submitting}>
            Cancelar
          </MuiButton>
          <MuiButton
            variant="primary"
            onClick={() => {
              const formEl = document.querySelector('[data-supplier-form]') as HTMLFormElement | null;
              formEl?.requestSubmit();
            }}
            isLoading={submitting}
            disabled={submitting}
          >
            {submitting ? 'Guardando...' : mode === 'create' ? 'Crear Proveedor' : 'Guardar Cambios'}
          </MuiButton>
        </>
      }
    >
      <Box component="form" data-supplier-form onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>
        {formError && <Alert severity="error">{formError}</Alert>}

        <MuiTextField
          label="Nombre"
          placeholder="Nombre del proveedor"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
          slotProps={{
            input: {
              startAdornment: <InputAdornment position="start"><IconStore size={16} color="var(--mui-palette-onSurfaceVariant)" /></InputAdornment>,
            },
          }}
        />

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
          <MuiTextField
            label="Contacto"
            placeholder="Nombre de contacto (opcional)"
            value={form.contact}
            onChange={(e) => setForm({ ...form, contact: e.target.value })}
          />
          <MuiTextField
            label="Teléfono"
            placeholder="Teléfono (opcional)"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </Box>
      </Box>
    </MuiDialog>
  );
}