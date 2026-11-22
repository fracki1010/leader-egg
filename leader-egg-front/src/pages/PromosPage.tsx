import { useEffect, useState, type FormEvent } from 'react';
import type { CreatePromotionPayload, UpdatePromotionPayload } from '../api/promotions.ts';
import { usePromotions, useProducts } from '../hooks/queries/index.ts';
import {
  useCreatePromotion,
  useUpdatePromotion,
  useSetPromotionStatus,
  useDeletePromotion,
} from '../hooks/mutations/index.ts';
import { isOfflineQueuedError } from '../hooks/use-offline-mutation.ts';
import type { PriceUnit, Product, Promotion, PromotionStatus, PromotionType } from '../types/index.ts';
import { PRODUCT_UNIT_OPTIONS, unitLabel } from '../lib/units.ts';
import { toDateInputValue } from '../lib/date.ts';
import { promoTypeLabel } from '../lib/promos.ts';
import {
  MuiButton,
  MuiChip,
  MuiSnackbar,
  MuiCard,
  MuiDialog,
  MuiTextField,
  EmptyState,
  LoadingState,
  PageHeader,
} from '../components/ui/index.ts';
import { IconEdit, IconDelete, IconPlus, IconPromo } from '../components/ui/icons.tsx';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import Checkbox from '@mui/material/Checkbox';

/* ── Types ──────────────────────────────────── */

type ExpiryMode = 'date' | 'stock' | 'none';

interface PromoFormState {
  name: string;
  productId: string;
  description: string;
  type: PromotionType;
  /** String input — parsed on submit. */
  value: string;
  /** buy_x_get_y total per group ("Llevás Y"); empty = llevás X+1 (legacy). */
  getQuantity: string;
  unit: PriceUnit;
  minQuantity: string;
  maxQuantity: string;
  expiryMode: ExpiryMode;
  /** yyyy-mm-dd (local) — converted to end-of-day on submit. */
  expiresAt: string;
  stockLimit: string;
  status: PromotionStatus;
}

interface DialogState {
  mode: 'create' | 'edit';
  promo: Promotion | null;
}

interface SnackbarState {
  open: boolean;
  message: string;
  severity: 'success' | 'error';
}

const emptyForm: PromoFormState = {
  name: '',
  productId: '',
  description: '',
  type: 'fixed_price',
  value: '',
  getQuantity: '',
  unit: 'maple',
  minQuantity: '',
  maxQuantity: '',
  expiryMode: 'none',
  expiresAt: '',
  stockLimit: '',
  status: 'active',
};

const fmtMoney = (val: number): string =>
  `$ ${val.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

/** Formats a promo's core rule for the list (value + unit). */
const promoRuleLabel = (promo: Promotion): string => {
  const unitName = unitLabel(promo.unit);
  switch (promo.type) {
    case 'fixed_price': {
      // Group pricing: read as "N x $P" when a group holds more than one unit.
      const group = promo.minQuantity ?? 1;
      const money = fmtMoney(promo.value);
      return group > 1 ? `${group} x ${money} / ${unitName}` : `${money} / ${unitName}`;
    }
    case 'discount_percent':
      return `${promo.value}% off / ${unitName}`;
    case 'buy_x_get_y':
      return promo.getQuantity != null
        ? `Pagás ${promo.value}, llevás ${promo.getQuantity} / ${unitName}`
        : `Lleva ${promo.value}, paga menos / ${unitName}`;
  }
};

/** Expiry/stock chip: "Hasta fecha" | "Stock limit X" | "Sin límite". */
const expiryChip = (promo: Promotion): { label: string; color: 'warning' | 'info' | 'default' } => {
  if (promo.stockLimit != null) {
    const remaining = Math.max(0, promo.stockLimit - promo.soldQuantity);
    return {
      label: `Stock limit ${promo.stockLimit}${promo.stockLimit != null ? ` · ${remaining} disp.` : ''}`,
      color: remaining > 0 ? 'info' : 'warning',
    };
  }
  if (promo.expiresAt) {
    const d = new Date(promo.expiresAt);
    return {
      label: `Hasta ${d.toLocaleDateString('es-AR')}`,
      color: d.getTime() > Date.now() ? 'info' : 'warning',
    };
  }
  return { label: 'Sin límite', color: 'default' };
};

const promoToForm = (promo: Promotion): PromoFormState => ({
  name: promo.name,
  productId: promo.productId,
  description: promo.description ?? '',
  type: promo.type,
  value: String(promo.value),
  getQuantity: promo.getQuantity != null ? String(promo.getQuantity) : '',
  unit: promo.unit,
  minQuantity: promo.minQuantity != null ? String(promo.minQuantity) : '',
  maxQuantity: promo.maxQuantity != null ? String(promo.maxQuantity) : '',
  expiryMode: promo.stockLimit != null ? 'stock' : promo.expiresAt ? 'date' : 'none',
  expiresAt: promo.expiresAt ? toDateInputValue(promo.expiresAt) : '',
  stockLimit: promo.stockLimit != null ? String(promo.stockLimit) : '',
  status: promo.status,
});

/* ── PromosPage ─────────────────────────────── */

/**
 * PromosPage — M3 admin list of promotions with create/edit dialog
 * (product, type, value, unit, min/max qty, expiry mode: fecha | stock limit
 * | sin límite, status), delete confirm and activate/deactivate.
 */
export function PromosPage() {
  // Reads
  const promosQuery = usePromotions();
  const productsQuery = useProducts();
  const promos = promosQuery.data ?? [];
  const products = productsQuery.data ?? [];
  const loading = promosQuery.isLoading;

  const readError = promosQuery.error
    ? promosQuery.error instanceof Error
      ? promosQuery.error.message
      : 'Error al cargar promociones'
    : null;

  // Writes — offline-aware mutations invalidate the promotions domain.
  const setPromotionStatus = useSetPromotionStatus();
  const deletePromotion = useDeletePromotion();
  const deleteSubmitting = deletePromotion.isPending;

  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Promotion | null>(null);
  // Mutation (write) error — kept separate from the read error alert.
  const [actionError, setActionError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<SnackbarState>({ open: false, message: '', severity: 'success' });

  const productName = (promo: Promotion): string =>
    products.find((p) => p._id === promo.productId)?.displayName ?? 'Producto desconocido';

  const handleToggleStatus = (promo: Promotion) => {
    const next: PromotionStatus = promo.status === 'active' ? 'inactive' : 'active';
    const action = next === 'inactive' ? 'desactivar' : 'activar';
    if (!window.confirm(`¿Seguro querés ${action} la promo "${promo.name}"?`)) return;

    setPromotionStatus.mutate(
      { id: promo._id, status: next },
      {
        onSuccess: () =>
          setSnackbar({
            open: true,
            message: `Promo ${next === 'active' ? 'activada' : 'desactivada'}`,
            severity: 'success',
          }),
        onError: (err) => {
          // Offline queued write: normal outcome, the OfflineBanner already confirmed it.
          if (isOfflineQueuedError(err)) {
            setSnackbar({
              open: true,
              message: `Promo ${next === 'active' ? 'activada' : 'desactivada'} sin conexión`,
              severity: 'success',
            });
            return;
          }
          setActionError(err instanceof Error ? err.message : 'Error al actualizar estado');
        },
      },
    );
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    deletePromotion.mutate(deleteTarget._id, {
      onSuccess: () => {
        setSnackbar({ open: true, message: 'Promo eliminada', severity: 'success' });
        setDeleteTarget(null);
      },
      onError: (err) => {
        if (isOfflineQueuedError(err)) {
          setSnackbar({ open: true, message: 'Promo eliminada sin conexión', severity: 'success' });
          setDeleteTarget(null);
          return;
        }
        setSnackbar({ open: true, message: err instanceof Error ? err.message : 'Error al eliminar', severity: 'error' });
      },
    });
  };

  if (loading) {
    return <LoadingState label="Cargando promos…" />;
  }

  return (
    <Box>
      <PageHeader
        title="Promos"
        subtitle="Promociones por producto y unidad"
        icon={<IconPromo size={22} />}
        actions={
          <MuiButton
            variant="primary"
            startIcon={<IconPlus />}
            onClick={() => setDialog({ mode: 'create', promo: null })}
          >
            Nueva Promo
          </MuiButton>
        }
      />

      {(readError || actionError) && (
        <Alert severity="error" sx={{ mb: 3 }}>{readError ?? actionError}</Alert>
      )}

      <MuiCard
        variant="elevated"
        sx={{ p: 0, overflow: 'hidden', '& .MuiCardContent-root': { p: 0, '&:last-child': { pb: 0 } } }}
      >
        {promos.length === 0 ? (
          <EmptyState
            title="No hay promos"
            subtitle="Creá tu primera promoción para ofrecer precios especiales."
            action={
              <MuiButton variant="primary" startIcon={<IconPlus />} onClick={() => setDialog({ mode: 'create', promo: null })}>
                Crear promo
              </MuiButton>
            }
          />
        ) : (
          promos.map((promo) => {
            const expiry = expiryChip(promo);
            const soldLimited = promo.stockLimit != null;
            return (
              <Box
                key={promo._id}
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  p: 2,
                  px: 3,
                  borderBottom: 1,
                  borderColor: 'divider',
                  gap: 3,
                  flexDirection: { xs: 'column', md: 'row' },
                  '&:last-child': { borderBottom: 'none' },
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
                    <IconPromo size={18} color="var(--mui-palette-primary-main)" />
                    <Typography variant="body1" sx={{ fontWeight: 600 }}>
                      {promo.name}
                    </Typography>
                    <MuiChip
                      label={promo.status === 'active' ? 'Activa' : 'Inactiva'}
                      color={promo.status === 'active' ? 'success' : 'default'}
                      size="small"
                      variant="outlined"
                    />
                    <MuiChip label={expiry.label} color={expiry.color} size="small" />
                  </Box>
                  <Box sx={{ display: 'flex', gap: 3, fontSize: 'body2.fontSize', color: 'text.secondary', flexWrap: 'wrap', alignItems: 'center' }}>
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                      {productName(promo)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {promoTypeLabel(promo.type)} · {promoRuleLabel(promo)}
                    </Typography>
                    {promo.minQuantity != null && (
                      <Typography variant="body2" color="text.secondary">
                        Mín {promo.minQuantity}
                      </Typography>
                    )}
                    {promo.maxQuantity != null && (
                      <Typography variant="body2" color="text.secondary">
                        Máx {promo.maxQuantity}
                      </Typography>
                    )}
                    {soldLimited && (
                      <Typography variant="body2" color="text.secondary">
                        {promo.soldQuantity} vendidos
                      </Typography>
                    )}
                  </Box>
                </Box>

                {/* Row actions */}
                <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                  <MuiButton variant="ghost" size="sm" onClick={() => setDialog({ mode: 'edit', promo })} startIcon={<IconEdit />}>
                    Editar
                  </MuiButton>
                  <MuiButton
                    variant="ghost"
                    size="sm"
                    onClick={() => handleToggleStatus(promo)}
                    startIcon={<IconDelete />}
                    sx={{ color: promo.status === 'active' ? 'error.main' : 'success.main' }}
                  >
                    {promo.status === 'active' ? 'Desactivar' : 'Activar'}
                  </MuiButton>
                  <MuiButton
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteTarget(promo)}
                    startIcon={<IconDelete />}
                    sx={{ color: 'error.main' }}
                  >
                    Eliminar
                  </MuiButton>
                </Box>
              </Box>
            );
          })
        )}
      </MuiCard>

      {/* Create/edit dialog */}
      <PromoFormDialog
        open={dialog !== null}
        mode={dialog?.mode ?? 'create'}
        promo={dialog?.promo ?? null}
        products={products}
        onClose={() => setDialog(null)}
        onSaved={(message) => {
          setSnackbar({ open: true, message, severity: 'success' });
        }}
      />

      {/* Delete confirm */}
      <MuiDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Eliminar promo"
        maxWidth="xs"
        actions={
          <>
            <MuiButton variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleteSubmitting}>
              Cancelar
            </MuiButton>
            <MuiButton variant="danger" isLoading={deleteSubmitting} disabled={deleteSubmitting} onClick={handleDeleteConfirm}>
              Eliminar
            </MuiButton>
          </>
        }
      >
        <Typography variant="body2" color="onSurface">
          ¿Eliminar la promo <strong>{deleteTarget?.name}</strong>? Las órdenes ya creadas conservan sus precios.
        </Typography>
      </MuiDialog>

      <MuiSnackbar
        open={snackbar.open}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
        severity={snackbar.severity}
      />
    </Box>
  );
}

/* ── PromoFormDialog ────────────────────────── */

interface PromoFormDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  promo: Promotion | null;
  products: Product[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

const VALUE_LABELS: Record<PromotionType, string> = {
  fixed_price: 'Precio del grupo',
  discount_percent: 'Porcentaje de descuento',
  buy_x_get_y: 'Pagás (X)',
};

const VALUE_PLACEHOLDERS: Record<PromotionType, string> = {
  fixed_price: 'Ej: 16000 (precio de N unidades)',
  discount_percent: 'Ej: 10 (10% off)',
  buy_x_get_y: 'Ej: 4',
};

const GET_QUANTITY_LABEL = 'Llevás (Y)';
const GET_QUANTITY_PLACEHOLDER = 'Ej: 5 — vacío = llevás X+1';

/**
 * Live preview of the fixed_price group rule from the entered values, e.g.
 * "Cada 3 unidades → $ 16.000,00. Si llevás 4, pagás $ 16.000,00 + 1 unidad al
 * precio normal."
 */
const fixedPricePreview = (form: PromoFormState): string => {
  const group = Math.max(1, Number(form.minQuantity) || 1);
  const price = Number(form.value);
  if (!Number.isFinite(price) || price <= 0) {
    return 'Ingresá el precio del grupo para ver el ejemplo.';
  }
  const money = fmtMoney(price);
  if (group <= 1) {
    return `Precio por unidad: ${money}.`;
  }
  return `Cada ${group} unidades → ${money}. Si llevás ${group + 1}, pagás ${money} + 1 unidad al precio normal.`;
};

function PromoFormDialog({ open, mode, promo, products, onClose, onSaved }: PromoFormDialogProps) {
  const [form, setForm] = useState<PromoFormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  const createPromotion = useCreatePromotion();
  const updatePromotion = useUpdatePromotion();
  const submitting = createPromotion.isPending || updatePromotion.isPending;

  useEffect(() => {
    if (!open) return;
    setForm(promo ? promoToForm(promo) : emptyForm);
    setFormError(null);
  }, [open, promo, mode]);

  const set = <K extends keyof PromoFormState>(key: K, value: PromoFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const value = Number(form.value);
    if (form.name.trim().length < 2) {
      setFormError('El nombre debe tener al menos 2 caracteres');
      return;
    }
    if (!form.productId) {
      setFormError('Seleccioná un producto');
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      setFormError('El valor debe ser un número positivo');
      return;
    }
    if (form.type === 'discount_percent' && value > 100) {
      setFormError('El descuento no puede superar el 100%');
      return;
    }
    let getQuantity: number | null = null;
    if (form.type === 'buy_x_get_y' && form.getQuantity.trim() !== '') {
      getQuantity = Number(form.getQuantity);
      if (!Number.isInteger(getQuantity) || getQuantity < 1) {
        setFormError('La cantidad a llevar (Y) debe ser un entero positivo');
        return;
      }
      if (getQuantity <= value) {
        setFormError('Llevás (Y) debe ser mayor que Pagás (X): tenés que recibir más de lo que pagás');
        return;
      }
    }
    const minQty = form.minQuantity === '' ? null : Number(form.minQuantity);
    const maxQty = form.maxQuantity === '' ? null : Number(form.maxQuantity);
    if (minQty != null && (!Number.isInteger(minQty) || minQty < 1)) {
      setFormError('La cantidad mínima debe ser un entero positivo');
      return;
    }
    if (maxQty != null && (!Number.isInteger(maxQty) || maxQty < 1)) {
      setFormError('La cantidad máxima debe ser un entero positivo');
      return;
    }
    if (minQty != null && maxQty != null && minQty > maxQty) {
      setFormError('La cantidad mínima no puede superar la máxima');
      return;
    }
    const stockLimit = form.expiryMode === 'stock'
      ? (Number(form.stockLimit) || null)
      : null;
    if (stockLimit != null && (!Number.isInteger(stockLimit) || stockLimit < 1)) {
      setFormError('El límite de stock debe ser un entero positivo');
      return;
    }
    const expiresAt = form.expiryMode === 'date' && form.expiresAt
      // End-of-local-day so the promo is valid through the selected date
      ? new Date(`${form.expiresAt}T23:59:59`).toISOString()
      : null;

    const payload: CreatePromotionPayload & UpdatePromotionPayload = {
      name: form.name.trim(),
      productId: form.productId,
      description: form.description.trim() || undefined,
      type: form.type,
      value,
      getQuantity,
      unit: form.unit,
      minQuantity: minQty,
      maxQuantity: maxQty,
      stockLimit,
      expiresAt,
      status: form.status,
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
      setFormError(err instanceof Error ? err.message : 'Error al guardar la promo');
    };

    if (mode === 'create') {
      createPromotion.mutate(payload as CreatePromotionPayload, {
        onSuccess: () => handleSaved('Promo creada'),
        onError: handleError,
      });
    } else if (promo) {
      updatePromotion.mutate(
        { id: promo._id, data: payload },
        {
          onSuccess: () => handleSaved('Promo actualizada'),
          onError: handleError,
        },
      );
    }
  };

  return (
    <MuiDialog
      open={open}
      onClose={onClose}
      title={mode === 'create' ? 'Nueva Promo' : 'Editar Promo'}
      maxWidth="sm"
      actions={
        <>
          <MuiButton variant="secondary" onClick={onClose} disabled={submitting}>
            Cancelar
          </MuiButton>
          <MuiButton
            variant="primary"
            onClick={() => {
              const formEl = document.querySelector('[data-promo-form]') as HTMLFormElement | null;
              formEl?.requestSubmit();
            }}
            isLoading={submitting}
            disabled={submitting}
          >
            {submitting ? 'Guardando...' : mode === 'create' ? 'Crear Promo' : 'Guardar Cambios'}
          </MuiButton>
        </>
      }
    >
      <Box component="form" data-promo-form onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>
        {formError && <Alert severity="error">{formError}</Alert>}

        <MuiTextField
          label="Nombre"
          placeholder="Nombre de la promo"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          required
        />

        <MuiTextField
          label="Producto"
          value={form.productId}
          onChange={(e) => set('productId', e.target.value)}
          select
          fullWidth
          required
        >
          <MenuItem value="">Seleccionar...</MenuItem>
          {products.map((p) => (
            <MenuItem key={p._id} value={p._id}>{p.displayName}</MenuItem>
          ))}
        </MuiTextField>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
          <MuiTextField
            label="Tipo"
            value={form.type}
            onChange={(e) => set('type', e.target.value as PromotionType)}
            select
            fullWidth
          >
            <MenuItem value="fixed_price">Precio fijo</MenuItem>
            <MenuItem value="discount_percent">Descuento %</MenuItem>
            <MenuItem value="buy_x_get_y">Lleva X, paga menos</MenuItem>
          </MuiTextField>

          <MuiTextField
            label={VALUE_LABELS[form.type]}
            placeholder={VALUE_PLACEHOLDERS[form.type]}
            type="number"
            value={form.value}
            onChange={(e) => set('value', e.target.value)}
            slotProps={{ htmlInput: { min: 0, step: 'any' } }}
            fullWidth
          />
        </Box>

        {form.type === 'fixed_price' && (
          <Alert severity="info" icon={false} data-testid="fixed-price-preview">
            <Typography variant="body2">{fixedPricePreview(form)}</Typography>
          </Alert>
        )}

        {form.type === 'buy_x_get_y' && (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, alignItems: 'start' }}>
            <MuiTextField
              label={GET_QUANTITY_LABEL}
              placeholder={GET_QUANTITY_PLACEHOLDER}
              type="number"
              value={form.getQuantity}
              onChange={(e) => set('getQuantity', e.target.value)}
              slotProps={{ htmlInput: { min: 1 } }}
              fullWidth
            />
            <Typography variant="caption" color="text.secondary" sx={{ pt: 1.75 }}>
              Ej: pagás 4 llevás 5 · pagás 1 llevás 2 (2x1)
            </Typography>
          </Box>
        )}

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
          <MuiTextField
            label="Unidad"
            value={form.unit}
            onChange={(e) => set('unit', e.target.value as PriceUnit)}
            select
            fullWidth
          >
            {PRODUCT_UNIT_OPTIONS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>
                {unitLabel(opt.value, { plural: true })}
              </MenuItem>
            ))}
          </MuiTextField>

          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <MuiTextField
              label={form.type === 'fixed_price' ? 'Cada (cantidad de unidades)' : 'Cant. mín'}
              type="number"
              value={form.minQuantity}
              onChange={(e) => set('minQuantity', e.target.value)}
              slotProps={{ htmlInput: { min: 1 } }}
            />
            <MuiTextField
              label={form.type === 'fixed_price' ? 'Cant. máx (línea)' : 'Cant. máx'}
              type="number"
              value={form.maxQuantity}
              onChange={(e) => set('maxQuantity', e.target.value)}
              slotProps={{ htmlInput: { min: 1 } }}
            />
          </Box>
        </Box>

        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, display: 'block', mb: 1 }}>
            Vencimiento / límite
          </Typography>
          <RadioGroup
            row
            value={form.expiryMode}
            onChange={(e) => set('expiryMode', e.target.value as ExpiryMode)}
          >
            <FormControlLabel value="date" control={<Radio size="small" />} label="Fecha" />
            <FormControlLabel value="stock" control={<Radio size="small" />} label="Stock limit" />
            <FormControlLabel value="none" control={<Radio size="small" />} label="Sin límite" />
          </RadioGroup>
          {form.expiryMode === 'date' && (
            <MuiTextField
              label="Vence el"
              type="date"
              value={form.expiresAt}
              onChange={(e) => set('expiresAt', e.target.value)}
              fullWidth
              sx={{ mt: 1.5 }}
            />
          )}
          {form.expiryMode === 'stock' && (
            <MuiTextField
              label="Límite de unidades"
              placeholder="Ej: 50 (null = ilimitado)"
              type="number"
              value={form.stockLimit}
              onChange={(e) => set('stockLimit', e.target.value)}
              slotProps={{ htmlInput: { min: 1 } }}
              fullWidth
              sx={{ mt: 1.5 }}
            />
          )}
        </Box>

        <FormControlLabel
          control={
            <Checkbox
              checked={form.status === 'active'}
              onChange={(e) => set('status', e.target.checked ? 'active' : 'inactive')}
              color="primary"
            />
          }
          label="Promo activa"
        />

        <MuiTextField
          label="Descripción (opcional)"
          placeholder="Detalle visible para el equipo"
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          multiline
          rows={2}
        />
      </Box>
    </MuiDialog>
  );
}