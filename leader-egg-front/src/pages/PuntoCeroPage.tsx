import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiAlert from '@mui/material/Alert';
import { usePuntoCero, useProducts, useCustomers, useSuppliers } from '../hooks/queries/index.ts';
import { useSetPuntoCero } from '../hooks/mutations/index.ts';
import { isOfflineQueuedError } from '../hooks/use-offline-mutation.ts';
import {
  MuiButton,
  MuiCard,
  MuiTextField,
  PageHeader,
  LoadingState,
} from '../components/ui/index.ts';
import {
  IconPointOfSale,
  IconCheck,
  IconWallet,
  IconStock,
  IconCustomer,
  IconStorefront,
  IconArrowBack,
  IconArrowForward,
  IconEgg,
} from '../components/ui/icons.tsx';
import { m3Shape } from '../theme/index.ts';
import type {
  SetupPuntoCeroPayload,
} from '../types/index.ts';

const STEPS = ['Stock', 'Caja', 'Clientes', 'Proveedores', 'Revisión'] as const;

const formatMoney = (n: number) =>
  `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

/** '' → 0; otherwise a finite number ≥ 0, else null (invalid). */
const parseAmount = (value: string): number | null => {
  if (value.trim() === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Punto Cero — one-time business setup wizard (admin).
 *
 * Reads the current state on mount. If the setup was already finalized it
 * shows a summary instead of the form (the backend rejects re-POSTs with
 * 409). Otherwise the admin walks 4 input steps + a review step and the
 * POST finalizes the setup — the dashboard banner then disappears.
 */
export function PuntoCeroPage() {
  const navigate = useNavigate();

  // Reads — setup state plus the product/customer/supplier lists that feed the
  // wizard steps. The api modules keep their IndexedDB read-through offline.
  const setupQuery = usePuntoCero();
  const productsQuery = useProducts();
  const customersQuery = useCustomers();
  const suppliersQuery = useSuppliers();

  const state = setupQuery.data ?? null;
  const products = productsQuery.data ?? [];
  const customers = customersQuery.data ?? [];
  const suppliers = suppliersQuery.data ?? [];

  const loading =
    setupQuery.isLoading ||
    productsQuery.isLoading ||
    customersQuery.isLoading ||
    suppliersQuery.isLoading;

  const readError =
    setupQuery.error ?? productsQuery.error ?? customersQuery.error ?? suppliersQuery.error;
  const loadError = readError
    ? readError instanceof Error
      ? readError.message
      : 'Error al cargar el estado'
    : null;

  const [step, setStep] = useState(0);
  const [stock, setStock] = useState<Record<string, string>>({});
  const [openingCash, setOpeningCash] = useState('0');
  const [clientDebts, setClientDebts] = useState<Record<string, string>>({});
  const [supplierDebts, setSupplierDebts] = useState<Record<string, string>>({});

  // Write — offline-aware finalize invalidates setup + seeded domains.
  const setPuntoCero = useSetPuntoCero();
  const saving = setPuntoCero.isPending;
  const [saveError, setSaveError] = useState<string | null>(null);

  const stockInvalid = products.some(
    (p) => parseAmount(stock[p._id] ?? '0') === null
  );
  const cajaInvalid = parseAmount(openingCash) === null;
  const clientInvalid = customers.some(
    (c) => parseAmount(clientDebts[c._id] ?? '0') === null
  );
  const supplierInvalid = suppliers.some(
    (s) => parseAmount(supplierDebts[s._id] ?? '0') === null
  );

  const stepInvalid = [stockInvalid, cajaInvalid, clientInvalid, supplierInvalid][step] ?? false;

  const setValue = (
    setter: React.Dispatch<React.SetStateAction<Record<string, string>>>,
    id: string,
    value: string
  ) => setter((prev) => ({ ...prev, [id]: value }));

  const buildPayload = useCallback((): SetupPuntoCeroPayload => {
    const stockItems = products
      .map((p) => ({ productId: p._id, quantity: parseAmount(stock[p._id] ?? '0') ?? 0 }))
      .filter((item) => item.quantity > 0);
    const clientItems = customers
      .map((c) => ({ customerId: c._id, amount: parseAmount(clientDebts[c._id] ?? '0') ?? 0 }))
      .filter((debt) => debt.amount > 0);
    const supplierItems = suppliers
      .map((s) => ({ supplierId: s._id, amount: parseAmount(supplierDebts[s._id] ?? '0') ?? 0 }))
      .filter((debt) => debt.amount > 0);

    const payload: SetupPuntoCeroPayload = {
      openingCash: parseAmount(openingCash) ?? 0,
    };
    if (stockItems.length > 0) payload.stock = stockItems;
    if (clientItems.length > 0) payload.clientDebts = clientItems;
    if (supplierItems.length > 0) payload.supplierDebts = supplierItems;
    return payload;
  }, [clientDebts, customers, openingCash, products, stock, supplierDebts, suppliers]);

  const finalize = async (): Promise<void> => {
    setSaveError(null);
    try {
      await setPuntoCero.mutateAsync(buildPayload());
      navigate('/dashboard');
    } catch (error) {
      // Offline queued write: normal outcome, the OfflineBanner confirmed it.
      if (isOfflineQueuedError(error)) {
        navigate('/dashboard');
        return;
      }
      setSaveError(error instanceof Error ? error.message : 'Error al finalizar el punto cero');
    }
  };

  const totalStock = products.reduce(
    (sum, p) => sum + (parseAmount(stock[p._id] ?? '0') ?? 0),
    0
  );
  const totalClientDebts = customers.reduce(
    (sum, c) => sum + (parseAmount(clientDebts[c._id] ?? '0') ?? 0),
    0
  );
  const totalSupplierDebts = suppliers.reduce(
    (sum, s) => sum + (parseAmount(supplierDebts[s._id] ?? '0') ?? 0),
    0
  );

  if (loading) {
    return <LoadingState label="Cargando el estado del negocio…" />;
  }

  if (loadError) {
    return (
      <Box sx={{ maxWidth: 680, mx: 'auto' }}>
        <MuiAlert severity="error" sx={{ m: 2 }}>
          {loadError}
        </MuiAlert>
      </Box>
    );
  }

  // Already finalized — read-only summary + exit to the dashboard.
  if (state?.finalized) {
    return (
      <Box sx={{ maxWidth: 680, mx: 'auto' }}>
        <PageHeader
          icon={<IconPointOfSale size={24} />}
          title="Punto Cero"
          subtitle="Estado inicial del negocio"
        />
        <MuiCard variant="elevated" sx={{ p: 3, mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 44,
                height: 44,
                borderRadius: m3Shape.medium,
                bgcolor: 'successContainer',
                color: 'onSuccessContainer',
                flexShrink: 0,
              }}
            >
              <IconCheck size={22} />
            </Box>
            <Box>
              <Typography variant="titleLarge" sx={{ fontWeight: 700, color: 'onSurface' }}>
                Punto cero ya establecido
              </Typography>
              <Typography variant="body2" color="onSurfaceVariant">
                La configuración inicial del negocio está completa.
              </Typography>
            </Box>
          </Box>

          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              p: 2,
              borderRadius: m3Shape.medium,
              bgcolor: 'surfaceContainerLow',
              mb: 2,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box sx={{ display: 'flex', color: 'onSurfaceVariant' }}>
                <IconWallet size={20} />
              </Box>
              <Typography variant="titleSmall" sx={{ fontWeight: 600, color: 'onSurface' }}>
                Caja inicial
              </Typography>
            </Box>
            <Typography
              variant="titleMedium"
              sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
            >
              {formatMoney(state.openingCash)}
            </Typography>
          </Box>

          {state.clientDebts.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="overline" color="onSurfaceVariant" sx={{ display: 'block', mb: 1 }}>
                Deudas de clientes
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {state.clientDebts.map((debt) => (
                  <Box
                    key={debt.customerId}
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 2,
                      p: 1.5,
                      borderRadius: m3Shape.medium,
                      bgcolor: 'surfaceContainerLow',
                    }}
                  >
                    <Typography variant="body2" color="onSurface">
                      {debt.name}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                    >
                      {formatMoney(debt.amount)}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          )}

          {state.supplierDebts.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="overline" color="onSurfaceVariant" sx={{ display: 'block', mb: 1 }}>
                Deudas con proveedores
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {state.supplierDebts.map((debt) => (
                  <Box
                    key={debt.supplierId}
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 2,
                      p: 1.5,
                      borderRadius: m3Shape.medium,
                      bgcolor: 'surfaceContainerLow',
                    }}
                  >
                    <Typography variant="body2" color="onSurface">
                      {debt.name}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                    >
                      {formatMoney(debt.amount)}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          )}

          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
            <MuiButton variant="primary" onClick={() => navigate('/dashboard')}>
              Ir al dashboard
            </MuiButton>
          </Box>
        </MuiCard>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 680, mx: 'auto' }}>
      <PageHeader
        icon={<IconPointOfSale size={24} />}
        title="Punto Cero"
        subtitle="Estado inicial del negocio — stock, caja y deudas de arranque"
      />

      {/* ── Step progress (M3) ───────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mb: 3 }}>
        {STEPS.map((label, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <Box key={label} sx={{ flex: 1, minWidth: 0 }}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 28,
                  height: 28,
                  mx: 'auto',
                  borderRadius: '50%',
                  bgcolor: done ? 'primary.main' : active ? 'primaryContainer' : 'surfaceContainerHigh',
                  color: done ? 'onPrimary' : active ? 'onPrimaryContainer' : 'onSurfaceVariant',
                  fontWeight: 700,
                  fontSize: '0.8125rem',
                }}
              >
                {done ? <IconCheck size={16} /> : i + 1}
              </Box>
              <Typography
                variant="labelMedium"
                align="center"
                sx={{
                  display: 'block',
                  mt: 0.75,
                  color: active ? 'primary.main' : 'onSurfaceVariant',
                  fontWeight: active || done ? 700 : 600,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {label}
              </Typography>
              {i < STEPS.length - 1 && (
                <Box
                  sx={{
                    height: 2,
                    mx: 1.5,
                    mt: 0.75,
                    borderRadius: m3Shape.full,
                    bgcolor: done ? 'primary.main' : 'surfaceContainerHighest',
                  }}
                />
              )}
            </Box>
          );
        })}
      </Box>

      {/* ── Active step ──────────────────────────── */}
      <MuiCard variant="elevated" sx={{ p: 3, mb: 2 }}>
        {step === 0 && (
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
              <Box sx={{ display: 'flex', color: 'primary.main' }}>
                <IconStock size={20} />
              </Box>
              <Typography variant="titleMedium" sx={{ fontWeight: 700, color: 'onSurface' }}>
                Stock inicial
              </Typography>
            </Box>
            <Typography variant="body2" color="onSurfaceVariant" sx={{ mb: 2 }}>
              Cuántos maples de cada producto hay al arrancar el negocio.
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {products.map((product) => (
                <MuiTextField
                  key={product._id}
                  label={product.displayName}
                  type="number"
                  value={stock[product._id] ?? '0'}
                  onChange={(e) => setValue(setStock, product._id, e.target.value)}
                  slotProps={{ htmlInput: { min: 0, step: 1 } }}
                  size="small"
                  error={parseAmount(stock[product._id] ?? '0') === null}
                  helperText={
                    parseAmount(stock[product._id] ?? '0') === null
                      ? 'Ingresá un número mayor o igual a 0'
                      : 'maples'
                  }
                />
              ))}
            </Box>
          </Box>
        )}

        {step === 1 && (
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
              <Box sx={{ display: 'flex', color: 'primary.main' }}>
                <IconWallet size={20} />
              </Box>
              <Typography variant="titleMedium" sx={{ fontWeight: 700, color: 'onSurface' }}>
                Caja inicial
              </Typography>
            </Box>
            <Typography variant="body2" color="onSurfaceVariant" sx={{ mb: 2 }}>
              El dinero en efectivo que hay en la caja al arrancar.
            </Typography>
            <MuiTextField
              label="Dinero en caja"
              type="number"
              value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value)}
              slotProps={{ htmlInput: { min: 0, step: 'any' } }}
              error={cajaInvalid}
              helperText={cajaInvalid ? 'Ingresá un número mayor o igual a 0' : 'ARS'}
            />
          </Box>
        )}

        {step === 2 && (
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
              <Box sx={{ display: 'flex', color: 'primary.main' }}>
                <IconCustomer size={20} />
              </Box>
              <Typography variant="titleMedium" sx={{ fontWeight: 700, color: 'onSurface' }}>
                Deudas de clientes
              </Typography>
            </Box>
            <Typography variant="body2" color="onSurfaceVariant" sx={{ mb: 2 }}>
              Saldos que los clientes ya te debían antes del punto cero.
            </Typography>
            {customers.length === 0 ? (
              <Typography variant="body2" color="onSurfaceVariant">
                No hay clientes cargados todavía — este paso se saltea.
              </Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {customers.map((customer) => (
                  <MuiTextField
                    key={customer._id}
                    label={customer.name}
                    type="number"
                    value={clientDebts[customer._id] ?? '0'}
                    onChange={(e) => setValue(setClientDebts, customer._id, e.target.value)}
                    slotProps={{ htmlInput: { min: 0, step: 'any' } }}
                    size="small"
                    error={parseAmount(clientDebts[customer._id] ?? '0') === null}
                    helperText={
                      parseAmount(clientDebts[customer._id] ?? '0') === null
                        ? 'Ingresá un número mayor o igual a 0'
                        : 'ARS'
                    }
                  />
                ))}
              </Box>
            )}
          </Box>
        )}

        {step === 3 && (
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
              <Box sx={{ display: 'flex', color: 'primary.main' }}>
                <IconStorefront size={20} />
              </Box>
              <Typography variant="titleMedium" sx={{ fontWeight: 700, color: 'onSurface' }}>
                Deudas con proveedores
              </Typography>
            </Box>
            <Typography variant="body2" color="onSurfaceVariant" sx={{ mb: 2 }}>
              Lo que el negocio le debía a sus proveedores antes del punto cero.
            </Typography>
            {suppliers.length === 0 ? (
              <Typography variant="body2" color="onSurfaceVariant">
                No hay proveedores cargados todavía — este paso se saltea.
              </Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {suppliers.map((supplier) => (
                  <MuiTextField
                    key={supplier._id}
                    label={supplier.name}
                    type="number"
                    value={supplierDebts[supplier._id] ?? '0'}
                    onChange={(e) => setValue(setSupplierDebts, supplier._id, e.target.value)}
                    slotProps={{ htmlInput: { min: 0, step: 'any' } }}
                    size="small"
                    error={parseAmount(supplierDebts[supplier._id] ?? '0') === null}
                    helperText={
                      parseAmount(supplierDebts[supplier._id] ?? '0') === null
                        ? 'Ingresá un número mayor o igual a 0'
                        : 'ARS'
                    }
                  />
                ))}
              </Box>
            )}
          </Box>
        )}

        {step === 4 && (
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
              <Box sx={{ display: 'flex', color: 'primary.main' }}>
                <IconEgg size={20} />
              </Box>
              <Typography variant="titleMedium" sx={{ fontWeight: 700, color: 'onSurface' }}>
                Revisión final
              </Typography>
            </Box>
            <Typography variant="body2" color="onSurfaceVariant" sx={{ mb: 2 }}>
              Revisá los valores antes de finalizar. Después del punto cero no se puede volver atrás.
            </Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <SummaryRow
                icon={<IconStock size={18} />}
                label="Stock inicial"
                value={totalStock > 0 ? `${totalStock} maples en ${products.filter((p) => (parseAmount(stock[p._id] ?? '0') ?? 0) > 0).length} productos` : 'Sin stock'}
              />
              <SummaryRow icon={<IconWallet size={18} />} label="Caja inicial" value={formatMoney(parseAmount(openingCash) ?? 0)} />
              <SummaryRow
                icon={<IconCustomer size={18} />}
                label="Deudas de clientes"
                value={totalClientDebts > 0 ? formatMoney(totalClientDebts) : 'Sin deudas'}
              />
              <SummaryRow
                icon={<IconStorefront size={18} />}
                label="Deudas con proveedores"
                value={totalSupplierDebts > 0 ? formatMoney(totalSupplierDebts) : 'Sin deudas'}
              />
            </Box>

            {saveError && (
              <MuiAlert severity="error" sx={{ mt: 2 }}>
                {saveError}
              </MuiAlert>
            )}
          </Box>
        )}
      </MuiCard>

      {/* ── Step navigation ──────────────────────── */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
        <MuiButton
          variant="secondary"
          onClick={() => (step === 0 ? navigate('/dashboard') : setStep((s) => s - 1))}
          disabled={saving}
          startIcon={<IconArrowBack size={18} />}
        >
          {step === 0 ? 'Cancelar' : 'Atrás'}
        </MuiButton>

        {step < STEPS.length - 1 ? (
          <MuiButton
            variant="primary"
            onClick={() => setStep((s) => s + 1)}
            disabled={stepInvalid}
            endIcon={<IconArrowForward size={18} />}
          >
            Siguiente
          </MuiButton>
        ) : (
          <MuiButton
            variant="primary"
            onClick={finalize}
            isLoading={saving}
            disabled={stockInvalid || cajaInvalid || clientInvalid || supplierInvalid}
            startIcon={!saving ? <IconCheck size={18} /> : undefined}
          >
            Finalizar Punto Cero
          </MuiButton>
        )}
      </Box>
    </Box>
  );
}

/** Review-step row: tonal icon chip + label + right-aligned mono value. */
function SummaryRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactElement;
  label: string;
  value: string;
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        p: 1.5,
        borderRadius: m3Shape.medium,
        bgcolor: 'surfaceContainerLow',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: m3Shape.medium,
          bgcolor: 'primaryContainer',
          color: 'onPrimaryContainer',
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>
      <Typography variant="body2" color="onSurface" sx={{ flex: 1 }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </Typography>
    </Box>
  );
}