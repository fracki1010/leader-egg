import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiAlert from '@mui/material/Alert';
import { usePlatformPuntoCero } from '../hooks/queries/index.ts';
import { useSetPlatformPuntoCero } from '../hooks/mutations/index.ts';
import { useSmartBack } from '../hooks/useSmartBack.ts';
import {
  MuiButton,
  MuiCard,
  MuiChip,
  MuiDialog,
  MuiSnackbar,
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
  IconWarning,
  IconEgg,
} from '../components/ui/icons.tsx';
import { m3Shape } from '../theme/index.ts';
import type { SetPlatformPuntoCeroPayload } from '../types/index.ts';

const STEPS = ['Stock', 'Saldos', 'Clientes', 'Proveedores', 'Revisión'] as const;

const formatMoney = (n: number) =>
  `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

const formatDate = (value: string): string =>
  new Date(value).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

/** '' → 0; otherwise a finite number ≥ 0, else null (invalid). */
const parseAmount = (value: string): number | null => {
  if (value.trim() === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

interface BalanceFields {
  cash: string;
  mp: string;
  bank: string;
}

/**
 * PlatformPuntoCeroPage — run a tenant's Punto Cero from the platform panel.
 *
 * Mirrors the tenant wizard (stock → balances → customer debts → supplier
 * debts → review) but reads and writes through the platform API, so the
 * platform token and the tenant isolation stay untouched. Every execution is
 * gated behind a destructive confirmation dialog; re-running a finalized setup
 * additionally requires typing the company slug (sent as `force: true`).
 */
export function PlatformPuntoCeroPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const goBack = useSmartBack('/platform');

  const setupQuery = usePlatformPuntoCero(id);
  const data = setupQuery.data ?? null;

  const products = useMemo(() => data?.products ?? [], [data]);
  const customers = useMemo(() => data?.customers ?? [], [data]);
  const suppliers = useMemo(() => data?.suppliers ?? [], [data]);
  const finalized = data?.state.finalized ?? false;

  const [step, setStep] = useState(0);
  const [stock, setStock] = useState<Record<string, string>>({});
  const [balances, setBalances] = useState<BalanceFields>({ cash: '0', mp: '0', bank: '0' });
  const [balancesEdited, setBalancesEdited] = useState(false);
  const [clientDebts, setClientDebts] = useState<Record<string, string>>({});
  const [supplierDebts, setSupplierDebts] = useState<Record<string, string>>({});

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmSlug, setConfirmSlug] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error';
  }>({ open: false, message: '', severity: 'success' });

  const initializedRef = useRef<string | null>(null);

  // Prefill the wizard from the platform payload once per tenant/finalize
  // revision. A background refetch must not wipe the admin's edits.
  useEffect(() => {
    if (!data) return;
    const key = `${data.tenant.id}:${data.state.finalizedAt ?? 'open'}`;
    if (initializedRef.current === key) return;
    initializedRef.current = key;

    setStock(Object.fromEntries(data.products.map((p) => [p.id, String(p.stock)])));
    setClientDebts(Object.fromEntries(data.customers.map((c) => [c.id, String(c.openingDebt)])));
    setSupplierDebts(Object.fromEntries(data.suppliers.map((s) => [s.id, String(s.openingDebt)])));
    setBalances({
      cash: String(data.state.openingBalances.cash),
      mp: String(data.state.openingBalances.mp),
      bank: String(data.state.openingBalances.bank),
    });
    setBalancesEdited(false);
    setConfirmSlug('');
    setSaveError(null);
    setStep(0);
  }, [data]);

  const setPuntoCero = useSetPlatformPuntoCero();
  const saving = setPuntoCero.isPending;

  const stockInvalid = products.some((p) => parseAmount(stock[p.id] ?? '0') === null);
  const balancesInvalid = [balances.cash, balances.mp, balances.bank].some(
    (value) => parseAmount(value) === null,
  );
  const clientInvalid = customers.some(
    (c) => parseAmount(clientDebts[c.id] ?? '0') === null,
  );
  const supplierInvalid = suppliers.some(
    (s) => parseAmount(supplierDebts[s.id] ?? '0') === null,
  );
  const anyInvalid = stockInvalid || balancesInvalid || clientInvalid || supplierInvalid;

  const stepInvalid = [stockInvalid, balancesInvalid, clientInvalid, supplierInvalid][step] ?? false;

  const setValue = (
    setter: React.Dispatch<React.SetStateAction<Record<string, string>>>,
    key: string,
    value: string,
  ) => setter((prev) => ({ ...prev, [key]: value }));

  const setBalance = (field: keyof BalanceFields, value: string) => {
    setBalancesEdited(true);
    setBalances((prev) => ({ ...prev, [field]: value }));
  };

  const buildPayload = useCallback((): SetPlatformPuntoCeroPayload => {
    const payload: SetPlatformPuntoCeroPayload = {};

    const stockItems = products
      .map((p) => ({ productId: p.id, quantity: parseAmount(stock[p.id] ?? '0') ?? 0 }))
      .filter((item) => item.quantity > 0);
    const clientItems = customers
      .map((c) => ({ customerId: c.id, amount: parseAmount(clientDebts[c.id] ?? '0') ?? 0 }))
      .filter((debt) => debt.amount > 0);
    const supplierItems = suppliers
      .map((s) => ({ supplierId: s.id, amount: parseAmount(supplierDebts[s.id] ?? '0') ?? 0 }))
      .filter((debt) => debt.amount > 0);

    const cash = parseAmount(balances.cash) ?? 0;
    const mp = parseAmount(balances.mp) ?? 0;
    const bank = parseAmount(balances.bank) ?? 0;

    if (stockItems.length > 0) payload.stock = stockItems;
    if (clientItems.length > 0) payload.clientDebts = clientItems;
    if (supplierItems.length > 0) payload.supplierDebts = supplierItems;
    // Include the balances section when it has values or the admin touched it,
    // so explicitly writing zeros is not silently dropped.
    if (balancesEdited || cash !== 0 || mp !== 0 || bank !== 0) {
      payload.openingBalances = { cash, mp, bank };
    }
    if (finalized) payload.force = true;

    return payload;
  }, [
    balances,
    balancesEdited,
    clientDebts,
    customers,
    finalized,
    products,
    stock,
    supplierDebts,
    suppliers,
  ]);

  const openConfirm = () => {
    if (anyInvalid) return;
    setSaveError(null);
    setConfirmSlug('');
    setConfirmOpen(true);
  };

  const closeConfirm = () => {
    if (saving) return;
    setConfirmOpen(false);
    setConfirmSlug('');
    setSaveError(null);
  };

  const canConfirm =
    !finalized || (data !== null && confirmSlug.trim() === data.tenant.slug);

  const handleConfirm = () => {
    if (!data || saving || !canConfirm) return;
    setSaveError(null);

    setPuntoCero.mutate(
      { tenantId: data.tenant.id, payload: buildPayload() },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          setSnackbar({
            open: true,
            message: 'Punto Cero ejecutado correctamente',
            severity: 'success',
          });
          navigate('/platform');
        },
        onError: (error) => {
          const message =
            error instanceof Error ? error.message : 'Error al ejecutar el Punto Cero';
          setSaveError(
            /finaliz/i.test(message)
              ? 'La empresa ya finalizó su Punto Cero. Escribí el slug para confirmar la sobrescritura.'
              : message,
          );
        },
      },
    );
  };

  const totalStock = products.reduce(
    (sum, p) => sum + (parseAmount(stock[p.id] ?? '0') ?? 0),
    0,
  );
  const productsWithStock = products.filter(
    (p) => (parseAmount(stock[p.id] ?? '0') ?? 0) > 0,
  ).length;
  const cash = parseAmount(balances.cash) ?? 0;
  const mp = parseAmount(balances.mp) ?? 0;
  const bank = parseAmount(balances.bank) ?? 0;
  const totalBalances = cash + mp + bank;
  const totalClientDebts = customers.reduce(
    (sum, c) => sum + (parseAmount(clientDebts[c.id] ?? '0') ?? 0),
    0,
  );
  const totalSupplierDebts = suppliers.reduce(
    (sum, s) => sum + (parseAmount(supplierDebts[s.id] ?? '0') ?? 0),
    0,
  );

  /* ── Loading / error ─────────────────────────────────────────────────── */

  if (!id) {
    return (
      <Box sx={{ maxWidth: 680, mx: 'auto' }}>
        <MuiAlert severity="error" sx={{ mb: 2 }}>
          Falta el identificador de la empresa.
        </MuiAlert>
        <MuiButton variant="secondary" onClick={goBack}>
          Volver al panel
        </MuiButton>
      </Box>
    );
  }

  if (setupQuery.isLoading) {
    return <LoadingState label="Cargando el Punto Cero de la empresa…" />;
  }

  if (setupQuery.error || !data) {
    const message =
      setupQuery.error instanceof Error
        ? setupQuery.error.message
        : 'Error al cargar el Punto Cero de la empresa';
    return (
      <Box sx={{ maxWidth: 680, mx: 'auto' }}>
        <MuiAlert severity="error" sx={{ mb: 2 }}>
          {message}
        </MuiAlert>
        <MuiButton variant="secondary" onClick={goBack}>
          Volver al panel
        </MuiButton>
      </Box>
    );
  }

  /* ── Render ──────────────────────────────────────────────────────────── */

  return (
    <Box sx={{ maxWidth: 680, mx: 'auto' }}>
      <PageHeader
        icon={<IconPointOfSale size={24} />}
        title="Punto Cero"
        subtitle={data.tenant.name}
        actions={
          finalized ? (
            <MuiChip
              label={
                data.state.finalizedAt
                  ? `Finalizado el ${formatDate(data.state.finalizedAt)}`
                  : 'Finalizado'
              }
              color="success"
              statusIcon
            />
          ) : (
            <MuiChip label="Sin finalizar" color="warning" statusIcon />
          )
        }
      />

      {finalized && (
        <MuiAlert severity="error" icon={<IconWarning size={18} />} sx={{ mb: 3 }}>
          <Typography component="span" sx={{ fontWeight: 700 }}>
            Esta empresa ya finalizó su Punto Cero
            {data.state.finalizedAt ? ` el ${formatDate(data.state.finalizedAt)}` : ''}.
          </Typography>{' '}
          Ejecutarlo de nuevo va a <strong>sobrescribir</strong> el stock inicial, los saldos
          de las cuentas y las deudas iniciales de clientes y proveedores de{' '}
          <strong>{data.tenant.name}</strong>. Esta acción no se puede deshacer.
        </MuiAlert>
      )}

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
                  bgcolor: done
                    ? 'primary.main'
                    : active
                      ? 'primaryContainer'
                      : 'surfaceContainerHigh',
                  color: done
                    ? 'onPrimary'
                    : active
                      ? 'onPrimaryContainer'
                      : 'onSurfaceVariant',
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
              Cuántos maples de cada producto tiene la empresa al arrancar.
            </Typography>
            {products.length === 0 ? (
              <Typography variant="body2" color="onSurfaceVariant">
                La empresa no tiene productos cargados — este paso se saltea.
              </Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {products.map((product) => {
                  const invalid = parseAmount(stock[product.id] ?? '0') === null;
                  return (
                    <MuiTextField
                      key={product.id}
                      label={product.name}
                      type="number"
                      value={stock[product.id] ?? '0'}
                      onChange={(e) => setValue(setStock, product.id, e.target.value)}
                      slotProps={{ htmlInput: { min: 0, step: 1 } }}
                      size="small"
                      error={invalid}
                      helperText={
                        invalid
                          ? 'Ingresá un número mayor o igual a 0'
                          : `${product.maplesPerCajon} maples por cajón`
                      }
                    />
                  );
                })}
              </Box>
            )}
          </Box>
        )}

        {step === 1 && (
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
              <Box sx={{ display: 'flex', color: 'primary.main' }}>
                <IconWallet size={20} />
              </Box>
              <Typography variant="titleMedium" sx={{ fontWeight: 700, color: 'onSurface' }}>
                Saldos iniciales
              </Typography>
            </Box>
            <Typography variant="body2" color="onSurfaceVariant" sx={{ mb: 2 }}>
              El dinero con el que arranca la empresa en cada cuenta.
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <MuiTextField
                label="Efectivo"
                type="number"
                value={balances.cash}
                onChange={(e) => setBalance('cash', e.target.value)}
                slotProps={{ htmlInput: { min: 0, step: 'any' } }}
                error={parseAmount(balances.cash) === null}
                helperText={
                  parseAmount(balances.cash) === null
                    ? 'Ingresá un número mayor o igual a 0'
                    : 'ARS'
                }
              />
              <MuiTextField
                label="Mercado Pago"
                type="number"
                value={balances.mp}
                onChange={(e) => setBalance('mp', e.target.value)}
                slotProps={{ htmlInput: { min: 0, step: 'any' } }}
                error={parseAmount(balances.mp) === null}
                helperText={
                  parseAmount(balances.mp) === null
                    ? 'Ingresá un número mayor o igual a 0'
                    : 'ARS'
                }
              />
              <MuiTextField
                label="Banco"
                type="number"
                value={balances.bank}
                onChange={(e) => setBalance('bank', e.target.value)}
                slotProps={{ htmlInput: { min: 0, step: 'any' } }}
                error={parseAmount(balances.bank) === null}
                helperText={
                  parseAmount(balances.bank) === null
                    ? 'Ingresá un número mayor o igual a 0'
                    : 'ARS'
                }
              />
            </Box>
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
              Saldos que los clientes ya le debían a la empresa antes del punto cero.
            </Typography>
            {customers.length === 0 ? (
              <Typography variant="body2" color="onSurfaceVariant">
                La empresa no tiene clientes cargados — este paso se saltea.
              </Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {customers.map((customer) => {
                  const invalid = parseAmount(clientDebts[customer.id] ?? '0') === null;
                  return (
                    <MuiTextField
                      key={customer.id}
                      label={customer.name}
                      type="number"
                      value={clientDebts[customer.id] ?? '0'}
                      onChange={(e) => setValue(setClientDebts, customer.id, e.target.value)}
                      slotProps={{ htmlInput: { min: 0, step: 'any' } }}
                      size="small"
                      error={invalid}
                      helperText={
                        invalid ? 'Ingresá un número mayor o igual a 0' : 'ARS'
                      }
                    />
                  );
                })}
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
              Lo que la empresa le debía a sus proveedores antes del punto cero.
            </Typography>
            {suppliers.length === 0 ? (
              <Typography variant="body2" color="onSurfaceVariant">
                La empresa no tiene proveedores cargados — este paso se saltea.
              </Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {suppliers.map((supplier) => {
                  const invalid = parseAmount(supplierDebts[supplier.id] ?? '0') === null;
                  return (
                    <MuiTextField
                      key={supplier.id}
                      label={supplier.name}
                      type="number"
                      value={supplierDebts[supplier.id] ?? '0'}
                      onChange={(e) => setValue(setSupplierDebts, supplier.id, e.target.value)}
                      slotProps={{ htmlInput: { min: 0, step: 'any' } }}
                      size="small"
                      error={invalid}
                      helperText={
                        invalid ? 'Ingresá un número mayor o igual a 0' : 'ARS'
                      }
                    />
                  );
                })}
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
              Revisá los valores antes de ejecutar. Después del punto cero no se puede volver
              atrás.
            </Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <SummaryRow
                icon={<IconStock size={18} />}
                label="Stock inicial"
                value={
                  totalStock > 0
                    ? `${totalStock} maples en ${productsWithStock} productos`
                    : 'Sin stock'
                }
              />
              <SummaryRow
                icon={<IconWallet size={18} />}
                label="Efectivo"
                value={formatMoney(cash)}
              />
              <SummaryRow
                icon={<IconWallet size={18} />}
                label="Mercado Pago"
                value={formatMoney(mp)}
              />
              <SummaryRow
                icon={<IconWallet size={18} />}
                label="Banco"
                value={formatMoney(bank)}
              />
              <SummaryRow
                icon={<IconWallet size={18} />}
                label="Total en cuentas"
                value={formatMoney(totalBalances)}
              />
              <SummaryRow
                icon={<IconCustomer size={18} />}
                label="Deudas de clientes"
                value={totalClientDebts > 0 ? formatMoney(totalClientDebts) : 'Sin deudas'}
              />
              <SummaryRow
                icon={<IconStorefront size={18} />}
                label="Deudas con proveedores"
                value={
                  totalSupplierDebts > 0 ? formatMoney(totalSupplierDebts) : 'Sin deudas'
                }
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
          onClick={() => (step === 0 ? navigate('/platform') : setStep((s) => s - 1))}
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
            onClick={openConfirm}
            disabled={anyInvalid || saving}
            startIcon={<IconCheck size={18} />}
          >
            Ejecutar Punto Cero
          </MuiButton>
        )}
      </Box>

      {/* ── Destructive confirmation (mandatory) ─── */}
      <MuiDialog
        open={confirmOpen}
        onClose={closeConfirm}
        title={`Ejecutar Punto Cero para ${data.tenant.name}`}
        maxWidth="sm"
        actions={
          <>
            <MuiButton variant="secondary" onClick={closeConfirm} disabled={saving}>
              Cancelar
            </MuiButton>
            <MuiButton
              variant="danger"
              onClick={handleConfirm}
              isLoading={saving}
              disabled={saving || !canConfirm}
              startIcon={<IconWarning size={18} />}
            >
              {saving ? 'Ejecutando...' : 'Sí, ejecutar Punto Cero'}
            </MuiButton>
          </>
        }
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <MuiAlert severity="error" icon={<IconWarning size={18} />}>
            Esto va a <strong>reemplazar</strong> el stock inicial, los saldos de las cuentas y
            las deudas iniciales de clientes y proveedores de esta empresa. No se puede
            deshacer.
          </MuiAlert>

          {finalized && (
            <MuiAlert severity="warning" icon={<IconWarning size={18} />}>
              <strong>La empresa ya tiene un Punto Cero finalizado.</strong> Si confirmás, se
              sobrescriben por completo los saldos, el stock y las deudas iniciales. Para
              habilitar la ejecución, escribí el slug de la empresa.
            </MuiAlert>
          )}

          {finalized && (
            <MuiTextField
              label="Escribí el slug para confirmar"
              placeholder={data.tenant.slug}
              value={confirmSlug}
              onChange={(e) => setConfirmSlug(e.target.value)}
              required
              autoFocus
              helperText={`Slug: ${data.tenant.slug}`}
            />
          )}

          {saveError && <MuiAlert severity="error">{saveError}</MuiAlert>}
        </Box>
      </MuiDialog>

      <MuiSnackbar
        open={snackbar.open}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        message={snackbar.message}
        severity={snackbar.severity}
      />
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
        sx={{
          fontFamily: 'var(--font-mono)',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}
