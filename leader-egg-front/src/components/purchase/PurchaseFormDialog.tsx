import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CreatePurchasePayload, CreatePurchaseItemPayload } from '../../api/purchases.ts';
import { productsApi } from '../../api/products.ts';
import { useCreatePurchase, useUpdatePurchase } from '../../hooks/mutations/index.ts';
import { isOfflineQueuedError } from '../../hooks/use-offline-mutation.ts';
import type { PriceUnit, Product, Purchase, PurchaseDetail, Supplier } from '../../types/index.ts';
import { PRODUCT_UNIT_OPTIONS, unitLabel, unitToCostPerMaple, unitToMaples } from '../../lib/units.ts';
import { todayLocalDate } from '../../lib/date.ts';
import {
  DuplicateWarningDialog,
  getDuplicateRecordInfo,
  type DuplicateRecordInfo,
} from '../common/DuplicateWarningDialog.tsx';
import { MuiButton, MuiDialog, MuiTextField } from '../ui/index.ts';
import { IconDelete, IconPlus } from '../ui/icons.tsx';
import { formatCurrency } from './PurchaseStatusChips.tsx';
import {
  PaymentLinesEditor,
  newPaymentLine,
  toPaymentLines,
  type PaymentLineDraft,
} from './PaymentLinesEditor.tsx';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import Divider from '@mui/material/Divider';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';

/* ── Form types ──────────────────────────────── */

interface ItemRow {
  productId: string;
  /** Quantity in the selected unit ('maple' | 'medio_cajon' | 'cajon'). */
  quantity: string;
  unit: PriceUnit;
  unitCost: string;
}

interface PurchaseForm {
  supplierId: string;
  date: string;
  notes: string;
  rows: ItemRow[];
  /** Create-mode only: mark delivered right away (stock enters). */
  delivered: boolean;
  /** Create-mode only: itemised payment lines (empty amount rows are ignored). */
  paymentLines: PaymentLineDraft[];
}

interface PurchaseFormDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  /** Purchase id used by update() in edit mode. */
  editId: string | null;
  /** Purchase detail being edited (edit mode). */
  editDetail: PurchaseDetail | null;
  suppliers: Supplier[];
  products: Product[];
  onClose: () => void;
  /** Called after a successful save: (message, createdPurchase | null). */
  onSaved: (message: string, saved: Purchase | null) => void;
}

const emptyRow: ItemRow = { productId: '', quantity: '', unit: 'maple', unitCost: '' };

const newCreateForm = (): PurchaseForm => ({
  supplierId: '',
  date: todayLocalDate(),
  notes: '',
  rows: [{ ...emptyRow }],
  delivered: true,
  paymentLines: [newPaymentLine()],
});

/** Prefills the shared dialog from a purchase detail (edit mode). */
const formFromDetail = (detail: PurchaseDetail): PurchaseForm => ({
  supplierId: detail.supplierId,
  date: detail.date.split('T')[0] ?? '',
  notes: detail.notes ?? '',
  rows: detail.items.map((item) => ({
    productId: item.productId,
    quantity: String(item.quantity ?? item.quantityMaples),
    unit: item.unit ?? 'maple',
    unitCost: String(item.unitCost),
  })),
  delivered: false,
  paymentLines: [],
});

/** Running Σ of the item rows (quantity × unitCost) — used as the payment cap. */
const itemsTotalOf = (rows: ItemRow[]): number =>
  rows.reduce((sum, row) => {
    const quantity = Number(row.quantity);
    const unitCost = Number(row.unitCost);
    return sum + (quantity > 0 && unitCost > 0 ? quantity * unitCost : 0);
  }, 0);

/**
 * PurchaseFormDialog — shared M3 create/edit dialog for purchases.
 *
 * Used by ComprasPage (create) and PurchaseDetailPage (edit, pending only).
 * Dynamic item rows support unit selection (maples/cajones) with a derived
 * per-maple cost helper and per-row margin vs the product's active price.
 * Create mode adds the lifecycle section ("¿Ya entregada?" + optional payment).
 */
export function PurchaseFormDialog({
  open,
  mode,
  editId,
  editDetail,
  suppliers,
  products,
  onClose,
  onSaved,
}: PurchaseFormDialogProps) {
  const [form, setForm] = useState<PurchaseForm>(newCreateForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [activePrices, setActivePrices] = useState<Record<string, number>>({});

  // Create/update writes — offline-aware: a queued write is a success.
  const createPurchase = useCreatePurchase();
  const updatePurchase = useUpdatePurchase();
  const submitting = createPurchase.isPending || updatePurchase.isPending;
  const navigate = useNavigate();

  // Duplicate protection: remember the exact create payload so "Crear igual"
  // resubmits it with forceDuplicate, and lock the submit until it settles.
  const submitLock = useRef(false);
  const lastPayloadRef = useRef<CreatePurchasePayload | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateRecordInfo | null>(null);

  const submitCreate = (payload: CreatePurchasePayload) => {
    lastPayloadRef.current = payload;
    createPurchase.mutate(payload, {
      onSuccess: (created) => {
        submitLock.current = false;
        lastPayloadRef.current = null;
        setDuplicate(null);
        onSaved(
          form.delivered
            ? 'Compra registrada y marcada como entregada'
            : 'Compra registrada (pendiente de entrega)',
          created,
        );
      },
      onError: (err) => {
        submitLock.current = false;
        // Offline queued write: normal outcome, the OfflineBanner already confirmed it.
        if (isOfflineQueuedError(err)) {
          onSaved('Compra guardada sin conexión', null);
          return;
        }
        const duplicateInfo = getDuplicateRecordInfo(err);
        if (duplicateInfo) {
          setDuplicate(duplicateInfo);
          return;
        }
        setFormError(err instanceof Error ? err.message : 'Error al guardar la compra');
      },
    });
  };

  /** Resubmits the SAME payload with the explicit force flag. */
  const handleForceDuplicate = () => {
    const payload = lastPayloadRef.current;
    if (!payload || submitLock.current) return;
    submitLock.current = true;
    setDuplicate(null);
    submitCreate({ ...payload, forceDuplicate: true });
  };

  const handleViewDuplicate = () => {
    const info = duplicate;
    setDuplicate(null);
    submitLock.current = false;
    lastPayloadRef.current = null;
    if (info) {
      onClose();
      navigate(`/compras/${info.existingId}`);
    }
  };

  const handleCancelDuplicate = () => {
    setDuplicate(null);
    submitLock.current = false;
    lastPayloadRef.current = null;
  };

  /** Fetches active prices for a set of products (404 → no active price → skipped). */
  const loadActivePrices = async (productIds: string[]): Promise<Record<string, number>> => {
    const unique = Array.from(new Set(productIds));
    const results = await Promise.allSettled(unique.map((id) => productsApi.getActivePrice(id)));
    const map: Record<string, number> = {};
    results.forEach((res, index) => {
      const id = unique[index];
      if (res.status === 'fulfilled' && id) {
        map[id] = res.value.price;
      }
    });
    return map;
  };

  // Reset the form every time the dialog opens with (possibly different) data.
  useEffect(() => {
    if (!open) return;
    setForm(mode === 'edit' && editDetail ? formFromDetail(editDetail) : newCreateForm());
    setFormError(null);
    setDuplicate(null);
    submitLock.current = false;
    lastPayloadRef.current = null;
    setActivePrices({});
    if (mode === 'edit' && editDetail) {
      // Best-effort prefill of active prices so per-row margins render immediately.
      void loadActivePrices(editDetail.items.map((item) => item.productId)).then((map) => {
        setActivePrices(map);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, editDetail]);

  const updateRow = (index: number, patch: Partial<ItemRow>) => {
    setForm((prev) => ({
      ...prev,
      rows: prev.rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  };

  const addRow = () => {
    setForm((prev) => ({ ...prev, rows: [...prev.rows, { ...emptyRow }] }));
  };

  const removeRow = (index: number) => {
    setForm((prev) => ({
      ...prev,
      rows: prev.rows.length > 1 ? prev.rows.filter((_, i) => i !== index) : prev.rows,
    }));
  };

  /** Fetches and caches the active price when a row's product is selected. */
  const handleRowProductChange = async (index: number, productId: string) => {
    updateRow(index, { productId });
    if (!productId) return;
    try {
      const entry = await productsApi.getActivePrice(productId);
      setActivePrices((prev) => ({ ...prev, [productId]: entry.price }));
    } catch {
      // No active price — row shows "sin precio activo" and margin is hidden
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (submitLock.current) return;
    setFormError(null);

    if (!form.supplierId) {
      setFormError('Seleccioná un proveedor');
      return;
    }

    const items: CreatePurchaseItemPayload[] = [];
    for (const row of form.rows) {
      const quantity = Number(row.quantity);
      const unitCost = Number(row.unitCost);
      if (!row.productId) {
        setFormError('Cada fila debe tener un producto seleccionado');
        return;
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        setFormError(
          `La cantidad de ${unitLabel(row.unit, { plural: true }).toLowerCase()} debe ser un entero mayor a 0`
        );
        return;
      }
      if (!(unitCost > 0)) {
        setFormError('El costo unitario debe ser mayor a 0');
        return;
      }
      items.push({ productId: row.productId, quantity, unit: row.unit, unitCost });
    }

    const base = {
      supplierId: form.supplierId,
      date: form.date,
      items,
      notes: form.notes.trim() || undefined,
    };

    const handleError = (err: unknown) => {
      // Offline queued write: normal outcome, the OfflineBanner already confirmed it.
      if (isOfflineQueuedError(err)) {
        onSaved('Compra guardada sin conexión', null);
        return;
      }
      setFormError(err instanceof Error ? err.message : 'Error al guardar la compra');
    };

    if (mode === 'edit' && editId) {
      updatePurchase.mutate(
        { id: editId, data: base },
        {
          onSuccess: () => onSaved('Compra actualizada correctamente', null),
          onError: handleError,
        },
      );
    } else {
      const paymentLines = toPaymentLines(form.paymentLines);
      const paymentTotal = paymentLines.reduce((sum, line) => sum + line.amount, 0);
      const itemsTotal = itemsTotalOf(form.rows);
      if (paymentTotal > itemsTotal + 0.005) {
        setFormError('El total pagado supera el total de la compra');
        return;
      }
      const payload: CreatePurchasePayload = {
        ...base,
        ...(form.delivered ? { delivered: true } : {}),
        // Itemised lines (empty amount rows are dropped). No lines → unpaid.
        ...(paymentLines.length > 0 ? { payments: paymentLines } : {}),
      };
      submitLock.current = true;
      submitCreate(payload);
    }
  };

  const itemsTotal = itemsTotalOf(form.rows);

  return (
    <>
    <MuiDialog
      open={open}
      onClose={onClose}
      title={mode === 'edit' ? 'Editar Compra' : 'Nueva Compra'}
      maxWidth="md"
      actions={
        <>
          <MuiButton variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </MuiButton>
          <MuiButton
            variant="primary"
            isLoading={submitting}
            disabled={submitting}
            onClick={() => {
              const formEl = document.querySelector('[data-purchase-form]') as HTMLFormElement | null;
              formEl?.requestSubmit();
            }}
          >
            {submitting ? 'Guardando...' : mode === 'edit' ? 'Guardar Cambios' : 'Registrar Compra'}
          </MuiButton>
        </>
      }
    >
      <Box component="form" data-purchase-form onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>
        {formError && <Alert severity="error">{formError}</Alert>}

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          <MuiTextField
            label="Proveedor"
            value={form.supplierId}
            onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
            select
            required
            slotProps={{ select: { displayEmpty: true } }}
          >
            <MenuItem value="" disabled>
              Seleccionar proveedor...
            </MenuItem>
            {suppliers.map((s) => (
              <MenuItem key={s._id} value={s._id}>
                {s.name}
              </MenuItem>
            ))}
          </MuiTextField>
          <MuiTextField
            label="Fecha"
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            required
          />
        </Box>

        {/* Dynamic item rows */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
            Ítems
          </Typography>

          {form.rows.map((row, index) => {
            const rowProduct = products.find((p) => p._id === row.productId);
            const maplesPerCajon = rowProduct?.maplesPerCajon ?? 12;
            const quantity = Number(row.quantity);
            const unitCost = Number(row.unitCost);
            const subtotal = quantity > 0 && unitCost > 0 ? quantity * unitCost : null;
            const activePrice = row.productId ? activePrices[row.productId] : undefined;
            // Margin is always per maple: the unit cost is divided by the
            // unit's maple equivalence (cajón → maplesPerCajon, medio cajón →
            // maplesPerCajon / 2).
            const unitCostPerMaple = unitToCostPerMaple(unitCost, row.unit, maplesPerCajon);
            const margin = subtotal !== null && activePrice !== undefined ? activePrice - unitCostPerMaple : null;
            const mapleEquivalent = rowProduct && quantity > 0 && row.unit !== 'maple'
              ? unitToMaples(quantity, row.unit, maplesPerCajon)
              : null;

            return (
              <Box key={index}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr 1fr 1fr 1fr auto' }, gap: 1.5, alignItems: 'center' }}>
                  <MuiTextField
                    label="Producto"
                    value={row.productId}
                    onChange={(e) => handleRowProductChange(index, e.target.value)}
                    select
                    slotProps={{ select: { displayEmpty: true } }}
                  >
                    <MenuItem value="" disabled>
                      Seleccionar...
                    </MenuItem>
                    {products.map((p) => (
                      <MenuItem key={p._id} value={p._id}>
                        {p.displayName}
                      </MenuItem>
                    ))}
                  </MuiTextField>
                  <MuiTextField
                    label="Unidad"
                    value={row.unit}
                    onChange={(e) => updateRow(index, { unit: e.target.value as PriceUnit })}
                    select
                  >
                    {PRODUCT_UNIT_OPTIONS.map((opt) => (
                      <MenuItem key={opt.value} value={opt.value}>
                        {unitLabel(opt.value, { plural: true })}
                      </MenuItem>
                    ))}
                  </MuiTextField>
                  <Box>
                    <MuiTextField
                      label="Cantidad"
                      type="number"
                      placeholder="0"
                      value={row.quantity}
                      onChange={(e) => updateRow(index, { quantity: e.target.value })}
                    />
                    {mapleEquivalent !== null && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                        = {mapleEquivalent.toLocaleString('es-AR')} maples
                      </Typography>
                    )}
                  </Box>
                  <Box>
                    <MuiTextField
                      label="Costo unit."
                      type="number"
                      placeholder="0.00"
                      value={row.unitCost}
                      onChange={(e) => updateRow(index, { unitCost: e.target.value })}
                    />
                    {/* Derived per-maple cost when buying by medio cajón / cajón */}
                    {row.unit !== 'maple' && unitCost > 0 && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                        = {formatCurrency(unitCostPerMaple)}/maple
                      </Typography>
                    )}
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      Subtotal
                    </Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {subtotal === null ? '—' : formatCurrency(subtotal)}
                    </Typography>
                    {margin !== null && (
                      <Typography
                        variant="caption"
                        sx={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: margin >= 0 ? 'success.main' : 'error.main' }}
                      >
                        margen {formatCurrency(margin)}/maple
                      </Typography>
                    )}
                    {row.productId && activePrice === undefined && (
                      <Typography variant="caption" color="text.secondary">
                        sin precio activo
                      </Typography>
                    )}
                  </Box>
                  <IconButton
                    color="error"
                    size="small"
                    onClick={() => removeRow(index)}
                    disabled={form.rows.length <= 1}
                    aria-label="Quitar fila"
                  >
                    <IconDelete size={18} />
                  </IconButton>
                </Box>
                {index < form.rows.length - 1 && <Divider sx={{ mt: 2 }} />}
              </Box>
            );
          })}

          <MuiButton variant="secondary" size="sm" onClick={addRow} startIcon={<IconPlus />} sx={{ alignSelf: 'flex-start' }}>
            Agregar ítem
          </MuiButton>
        </Box>

        {/* Lifecycle + payment section (create mode only) */}
        {mode === 'create' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Divider />
            <FormControlLabel
              control={
                <Checkbox
                  checked={form.delivered}
                  onChange={(e) => setForm({ ...form, delivered: e.target.checked })}
                />
              }
              label="¿Ya entregada? (suma al stock)"
            />
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              Pago inicial (opcional)
            </Typography>
            <PaymentLinesEditor
              lines={form.paymentLines}
              onChange={(lines) => setForm({ ...form, paymentLines: lines })}
              cap={itemsTotal}
              capLabel="Total de la compra"
            />
          </Box>
        )}

        <MuiTextField
          label="Notas (opcional)"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value.slice(0, 500) })}
          multiline
          rows={2}
          placeholder="Referencia, detalle de la compra..."
        />
      </Box>
    </MuiDialog>

    <DuplicateWarningDialog
      open={duplicate !== null}
      resource="purchase"
      existingNumber={duplicate?.existingNumber ?? ''}
      existingId={duplicate?.existingId ?? ''}
      busy={submitting}
      onView={handleViewDuplicate}
      onForce={handleForceDuplicate}
      onCancel={handleCancelDuplicate}
    />
    </>
  );
}