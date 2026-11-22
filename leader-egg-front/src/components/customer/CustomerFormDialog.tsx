import { useEffect, useState, type FormEvent } from 'react';
import type { CreateCustomerPayload, UpdateCustomerPayload } from '../../api/customers.ts';
import { geocode, reverseGeocode } from '../../api/geocode.ts';
import { geocodeCityProvince } from '../../lib/geocode-hint.ts';
import { matchLocalidad, matchProvincia } from '../../lib/address-match.ts';
import { ApiError } from '../../api/client.ts';
import type { AddressDetail, Customer, CustomerType, LatLng } from '../../types/index.ts';
import { useCreateCustomer, useUpdateCustomer } from '../../hooks/mutations/index.ts';
import { isOfflineQueuedError } from '../../hooks/use-offline-mutation.ts';
import { getLocalidades, provincias } from '../../data/argentina.ts';
import { MuiButton, MuiChip, MuiDialog, MuiTextField, MapView, type MapMarker } from '../ui/index.ts';
import { IconMapPin, IconMyLocation, IconPhone, IconX } from '../ui/icons.tsx';
import { m3Shape } from '../../theme/index.ts';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import InputAdornment from '@mui/material/InputAdornment';
import CircularProgress from '@mui/material/CircularProgress';

/* ── Types ──────────────────────────────────── */

interface FormData {
  name: string;
  type: CustomerType;
  phone: string;
  // structured address fields
  street: string;
  number: string;
  floor: string;
  neighborhood: string;
  city: string;
  province: string;
  postalCode: string;
  reference: string;
  email: string;
  taxId: string;
  creditLimit: string;
  termDays: string;
}

const emptyForm: FormData = {
  name: '',
  type: 'B2C',
  phone: '',
  street: '',
  number: '',
  floor: '',
  neighborhood: '',
  city: '',
  province: '',
  postalCode: '',
  reference: '',
  email: '',
  taxId: '',
  creditLimit: '0',
  termDays: '0',
};

interface CustomerFormDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  /** Customer being edited (null when creating). */
  customer: Customer | null;
  onClose: () => void;
  /** Called after a successful create/update with the confirmation message. */
  onSaved: (message: string) => void;
}

/* ── Helpers ─────────────────────────────────── */

/**
 * Composes the display/compat `address` string from the structured fields:
 * "Calle Número, Barrio, Ciudad, Provincia" — empty parts are omitted.
 * Postal code and reference are NOT part of the composed string.
 */
const composeAddress = (f: FormData): string => {
  const streetLine = [f.street.trim(), f.number.trim()].filter(Boolean).join(' ');
  return [streetLine, f.neighborhood.trim(), f.city.trim(), f.province.trim()]
    .filter(Boolean)
    .join(', ');
};

/** Builds the payload addressDetail from non-empty fields only. */
const buildAddressDetail = (f: FormData): AddressDetail | undefined => {
  const detail: AddressDetail = {
    street: f.street.trim() || undefined,
    number: f.number.trim() || undefined,
    floor: f.floor.trim() || undefined,
    neighborhood: f.neighborhood.trim() || undefined,
    city: f.city.trim() || undefined,
    province: f.province.trim() || undefined,
    postalCode: f.postalCode.trim() || undefined,
    reference: f.reference.trim() || undefined,
  };
  return Object.values(detail).some((v) => v !== undefined) ? detail : undefined;
};

/**
 * CustomerFormDialog — shared M3 create/edit dialog for customers.
 *
 * The address section is structured (calle/número/piso/barrio/ciudad/
 * provincia/código postal/referencias) with a "Buscar en mapa" geocode
 * action that stores the resolved point as GeoJSON `location` on the
 * customer. The composed `address` string keeps backward compatibility
 * with orders/routes that snapshot it.
 */
export function CustomerFormDialog({ open, mode, customer, onClose, onSaved }: CustomerFormDialogProps) {
  const [form, setForm] = useState<FormData>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  // Create/update writes — offline-aware: a queued write is a success.
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();
  const submitting = createCustomer.isPending || updateCustomer.isPending;

  // Geocoding state — map only appears after a successful search
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [geocoded, setGeocoded] = useState<LatLng | null>(null);

  // Manual point state — the map marking mode, available at any time
  const [manualLocation, setManualLocation] = useState<LatLng | null>(null);
  const [selectingManual, setSelectingManual] = useState(false);

  // Reverse geocoding state — tap on the map auto-fills the address fields
  const [reverseGeocoding, setReverseGeocoding] = useState(false);
  const [reverseError, setReverseError] = useState<string | null>(null);
  const [reverseHint, setReverseHint] = useState<string | null>(null);

  // Device GPS state — "Mi ubicación" button (non-blocking)
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  // Manual-mode map center — geocoded "Ciudad, Provincia" hint so the map
  // opens near the selected zone instead of the default (Córdoba) center.
  const [manualCenter, setManualCenter] = useState<LatLng | null>(null);
  const [manualHintLoading, setManualHintLoading] = useState(false);

  // Required only when a composed address is expected from the fields:
  // create always; edit only when the customer already has structured detail
  // (legacy customers with just `address` can be saved without re-typing it).
  const structuredRequired = mode === 'create' || Boolean(customer?.addressDetail);

  // Province/city selectors — backed by the static argentina.json dataset.
  // `form.province`/`form.city` keep the province/city NAMES (string) for
  // compatibility with geocoding and the composed address string.
  const selectedProvincia = provincias.find((p) => p.nombre === form.province) ?? null;
  const localidades = selectedProvincia ? getLocalidades(selectedProvincia.id) : [];

  // Sync form state whenever the dialog opens with a (possibly different) customer.
  useEffect(() => {
    if (!open) return;
    setForm({
      name: customer?.name ?? '',
      type: customer?.type ?? 'B2C',
      phone: customer?.phone ?? '',
      street: customer?.addressDetail?.street ?? '',
      number: customer?.addressDetail?.number ?? '',
      floor: customer?.addressDetail?.floor ?? '',
      neighborhood: customer?.addressDetail?.neighborhood ?? '',
      city: customer?.addressDetail?.city ?? '',
      province: customer?.addressDetail?.province ?? '',
      postalCode: customer?.addressDetail?.postalCode ?? '',
      reference: customer?.addressDetail?.reference ?? '',
      email: customer?.email ?? '',
      taxId: customer?.taxId ?? '',
      creditLimit: String(customer?.creditConfig?.limit ?? 0),
      termDays: String(customer?.creditConfig?.termDays ?? 0),
    });
    setFormError(null);
    setGeocoding(false);
    setGeocodeError(null);
    setGeocoded(null);
    setManualLocation(null);
    setSelectingManual(false);
    setManualCenter(null);
    setManualHintLoading(false);
    setReverseGeocoding(false);
    setReverseError(null);
    setReverseHint(null);
    setLocating(false);
    setLocateError(null);
  }, [open, customer, mode]);

  // Stored point of the customer being edited (GeoJSON Point → { lat, lng }).
  const customerLocation: LatLng | null =
    customer?.location?.type === 'Point'
      ? { lat: customer.location.coordinates[1], lng: customer.location.coordinates[0] }
      : null;

  /**
   * Address edits invalidate a forward-geocoded point (it may not match the
   * typed address anymore). A map-selected point is preserved so the user can
   * keep editing the auto-filled fields and re-tap the map to move the pin.
   */
  const setAddressField = (field: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setGeocoded(null);
    setGeocodeError(null);
    setReverseError(null);
    setReverseHint(null);
  };

  /** Province change clears the selected city (it belongs to another province). */
  const handleProvinciaChange = (value: string) => {
    setForm((prev) => ({ ...prev, province: value, city: '' }));
    setGeocoded(null);
    setGeocodeError(null);
    setReverseError(null);
    setReverseHint(null);
  };

  const handleGeocode = async () => {
    const address = composeAddress(form);
    if (!address) return;
    setGeocoding(true);
    setGeocodeError(null);
    setManualLocation(null);
    setSelectingManual(false);
    setReverseError(null);
    setReverseHint(null);
    try {
      const result = await geocode(address);
      setGeocoded({ lat: result.lat, lng: result.lng });
    } catch (err) {
      setGeocoded(null);
      setGeocodeError(
        err instanceof ApiError && err.status === 404
          ? 'No se pudo geocodificar la dirección'
          : err instanceof ApiError && err.status === 502
            ? 'No se pudo contactar el servicio de mapas'
            : err instanceof Error
              ? err.message
              : 'Error al buscar la dirección',
      );
    } finally {
      setGeocoding(false);
    }
  };

  /**
   * Opens the map in click-to-select mode. Always available from the address
   * section — tapping the map reverse-geocodes the point and fills the fields.
   */
  const handleStartManual = () => {
    setSelectingManual(true);
    setManualLocation(null);
    setGeocoded(null);
    setGeocodeError(null);
    setReverseError(null);
    setReverseHint(null);
    setManualCenter(null);
    // Editing a customer with a stored point keeps the existing behavior:
    // the map opens centered on the stored location (no hint needed).
    if (customerLocation) {
      setManualHintLoading(false);
      return;
    }
    // Best-effort: geocode "Ciudad, Provincia" so the manual map opens near
    // the selected zone instead of the default center. The full street may
    // fail to geocode, but the city + province almost always resolves.
    setManualHintLoading(true);
    void geocodeCityProvince(form.city, form.province).then((hint) => {
      setManualCenter(hint);
      setManualHintLoading(false);
    });
  };

  /**
   * Reverse-geocodes a point and auto-fills the structured address fields.
   *
   * Shared by the map-tap handler and the "Mi ubicación" GPS button. The pin
   * itself is stored by the caller BEFORE this runs, so `location` is set even
   * if the lookup fails. Province/city are matched against the static dataset
   * select; when a name cannot be matched the select is left unset and a hint is
   * shown. The user can always keep editing — nothing here blocks the form.
   */
  const fillAddressFromPoint = async (point: LatLng) => {
    setReverseError(null);
    setReverseHint(null);
    setReverseGeocoding(true);
    try {
      const result = await reverseGeocode(point.lat, point.lng);
      const provincia = matchProvincia(result.province);
      const localidad = matchLocalidad(provincia, result.city);

      setForm((prev) => ({
        ...prev,
        // Only fill fields the lookup actually resolved; never wipe typed input.
        street: result.street ?? prev.street,
        number: result.number ?? prev.number,
        neighborhood: result.neighborhood ?? prev.neighborhood,
        postalCode: result.postalCode ?? prev.postalCode,
        // Province/city must exist in the dataset selects — otherwise unset.
        province: provincia ? provincia.nombre : '',
        city: localidad ? localidad.nombre : '',
      }));

      if (!provincia) {
        setReverseHint('No reconocimos la provincia automáticamente — seleccionala manualmente.');
      } else if (!localidad) {
        setReverseHint('No reconocimos la ciudad automáticamente — seleccionala manualmente.');
      }
    } catch {
      setReverseError('No se pudo obtener la dirección — completá los campos manualmente');
    } finally {
      setReverseGeocoding(false);
    }
  };

  /** Map tap → store the pin and reverse-geocode it into the address fields. */
  const handleMapSelect = (marker: MapMarker) => {
    const point = { lat: marker.lat, lng: marker.lng };
    setManualLocation(point);
    void fillAddressFromPoint(point);
  };

  /**
   * "Mi ubicación" → marks the device GPS position on the map and fills the
   * address from it. GPS failure NEVER blocks the form: it only shows an inline
   * message and the user keeps the manual map / typed-address fallback.
   */
  const handleUseMyLocation = () => {
    setLocateError(null);
    if (!navigator.geolocation) {
      setLocateError('No pudimos obtener tu ubicación — marcá el punto en el mapa o completá la dirección');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        // Show the map with the GPS pin, mirroring the map-tap flow.
        setSelectingManual(true);
        setManualLocation(point);
        setGeocoded(null);
        setGeocodeError(null);
        setManualCenter(null);
        setManualHintLoading(false);
        setLocating(false);
        void fillAddressFromPoint(point);
      },
      () => {
        setLocateError('No pudimos obtener tu ubicación — marcá el punto en el mapa o completá la dirección');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const composedAddress = composeAddress(form);
    // Legacy fallback: editing a customer that only has the composed `address`
    // string (no structured detail) keeps the stored address when fields are empty.
    const address = composedAddress || (mode === 'edit' && customer?.address ? customer.address : '');

    // Geocoded point wins; the manual marker is the fallback for unknown addresses.
    const resolvedLocation = geocoded ?? manualLocation;

    const payload: CreateCustomerPayload & UpdateCustomerPayload = {
      name: form.name.trim(),
      type: form.type,
      phone: form.phone.trim(),
      address,
      addressDetail: buildAddressDetail(form),
      // Point as GeoJSON — coordinates are [lng, lat] (GeoJSON order!)
      location: resolvedLocation ? { type: 'Point', coordinates: [resolvedLocation.lng, resolvedLocation.lat] } : undefined,
      email: form.email.trim() || undefined,
      taxId: form.taxId.trim() || undefined,
      creditConfig: {
        limit: Number(form.creditLimit) || 0,
        termDays: Number(form.termDays) || 0,
      },
    };

    const handleSaved = () => {
      onClose();
      onSaved(mode === 'create' ? 'Cliente creado' : 'Cliente actualizado');
    };

    const handleError = (err: unknown) => {
      // Offline queued write: normal outcome, the OfflineBanner already
      // confirmed it — close like a success instead of showing an error.
      if (isOfflineQueuedError(err)) {
        onClose();
        onSaved('Guardado sin conexión');
        return;
      }
      setFormError(err instanceof Error ? err.message : 'Error al guardar cliente');
    };

    if (mode === 'create') {
      createCustomer.mutate(payload as CreateCustomerPayload, {
        onSuccess: handleSaved,
        onError: handleError,
      });
    } else if (customer) {
      updateCustomer.mutate({ id: customer._id, data: payload }, {
        onSuccess: handleSaved,
        onError: handleError,
      });
    }
  };

  const composedPreview = composeAddress(form);

  return (
    <MuiDialog
      open={open}
      onClose={onClose}
      title={mode === 'create' ? 'Nuevo Cliente' : 'Editar Cliente'}
      maxWidth="sm"
      actions={
        <>
          <MuiButton variant="secondary" onClick={onClose} disabled={submitting}>
            Cancelar
          </MuiButton>
          <MuiButton
            variant="primary"
            onClick={() => {
              const formEl = document.querySelector('[data-customer-form]') as HTMLFormElement | null;
              formEl?.requestSubmit();
            }}
            isLoading={submitting}
            disabled={submitting}
          >
            {submitting ? 'Guardando...' : mode === 'create' ? 'Crear Cliente' : 'Guardar Cambios'}
          </MuiButton>
        </>
      }
    >
      <Box component="form" data-customer-form onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>
        {formError && <Alert severity="error">{formError}</Alert>}

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
          <MuiTextField
            label="Nombre"
            placeholder="Nombre del cliente"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <TextField
            label="Tipo"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as CustomerType })}
            select
            variant="filled"
            fullWidth
          >
            <MenuItem value="B2C">B2C — Consumidor</MenuItem>
            <MenuItem value="B2B">B2B — Comercio</MenuItem>
          </TextField>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
          <TextField
            label="Teléfono"
            placeholder="Teléfono"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            required
            fullWidth
            slotProps={{
              input: {
                startAdornment: <InputAdornment position="start"><IconPhone size={16} color="var(--mui-palette-text-secondary)" /></InputAdornment>,
              },
            }}
          />
          <MuiTextField
            label="Email"
            type="email"
            placeholder="email@ejemplo.com (opcional)"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Box>

        {/* ── Structured address ─────────────────────────── */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
            Dirección
          </Typography>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <MuiTextField
              label="Calle"
              placeholder="Calle"
              value={form.street}
              onChange={(e) => setAddressField('street', e.target.value)}
              required={structuredRequired}
            />
            <MuiTextField
              label="Número"
              placeholder="Número"
              value={form.number}
              onChange={(e) => setAddressField('number', e.target.value)}
              required={structuredRequired}
            />
            <MuiTextField
              label="Piso/Depto"
              placeholder="Piso / depto (opcional)"
              value={form.floor}
              onChange={(e) => setAddressField('floor', e.target.value)}
            />
            <MuiTextField
              label="Barrio"
              placeholder="Barrio (opcional)"
              value={form.neighborhood}
              onChange={(e) => setAddressField('neighborhood', e.target.value)}
            />
            <MuiTextField
              label="Provincia"
              value={form.province}
              onChange={(e) => handleProvinciaChange(e.target.value)}
              select
              required={structuredRequired}
              slotProps={{ select: { displayEmpty: true } }}
            >
              <MenuItem value="" disabled>
                Seleccionar provincia...
              </MenuItem>
              {provincias.map((p) => (
                <MenuItem key={p.id} value={p.nombre}>
                  {p.nombre}
                </MenuItem>
              ))}
            </MuiTextField>
            <MuiTextField
              label="Ciudad"
              value={form.city}
              onChange={(e) => setAddressField('city', e.target.value)}
              select
              required={structuredRequired}
              disabled={!selectedProvincia}
              helperText={!selectedProvincia ? 'Primero seleccioná la provincia' : undefined}
              slotProps={{ select: { displayEmpty: true } }}
            >
              <MenuItem value="" disabled>
                {selectedProvincia ? 'Seleccionar localidad...' : 'Primero seleccioná la provincia'}
              </MenuItem>
              {localidades.map((l) => (
                <MenuItem key={l.id} value={l.nombre}>
                  {l.nombre}
                </MenuItem>
              ))}
            </MuiTextField>
            <MuiTextField
              label="Código Postal"
              placeholder="Código postal (opcional)"
              value={form.postalCode}
              onChange={(e) => setAddressField('postalCode', e.target.value)}
            />
            <MuiTextField
              label="Referencias"
              placeholder="Punto de referencia, colores, etc."
              value={form.reference}
              onChange={(e) => setAddressField('reference', e.target.value)}
              multiline
              rows={2}
            />
          </Box>

          {/* Legacy address preview (edit mode, no structured detail yet) */}
          {mode === 'edit' && customer && !customer.addressDetail && customer.address && (
            <Typography variant="body2" color="text.secondary">
              Dirección actual:{' '}
              <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
                {customer.address}
              </Box>
            </Typography>
          )}

          {/* Geocode + map actions */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <MuiButton
              variant="secondary"
              size="sm"
              onClick={handleGeocode}
              isLoading={geocoding}
              disabled={!composedPreview || geocoding}
              startIcon={<IconMapPin size={16} />}
            >
              Buscar en mapa
            </MuiButton>
            {/* Always-available: tap the map and the address fills automatically */}
            <MuiButton
              variant="ghost"
              size="sm"
              onClick={handleStartManual}
              disabled={submitting || selectingManual}
              startIcon={<IconMapPin size={16} />}
            >
              Ubicar en el mapa
            </MuiButton>
            {/* Device GPS — marks the exact current point and fills the address */}
            <MuiButton
              variant="secondary"
              size="sm"
              onClick={handleUseMyLocation}
              isLoading={locating}
              startIcon={<IconMyLocation size={16} />}
            >
              Mi ubicación
            </MuiButton>
            {geocoded && (
              <MuiChip
                color="success"
                size="small"
                variant="filled"
                icon={<IconMapPin size={14} />}
                label={`Coordenadas guardadas: ${geocoded.lat.toFixed(5)}, ${geocoded.lng.toFixed(5)}`}
              />
            )}
          </Box>

          {geocodeError && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Alert severity="error">{geocodeError}</Alert>
              <MuiButton
                variant="ghost"
                size="sm"
                onClick={handleStartManual}
                startIcon={<IconMapPin size={14} />}
                sx={{ alignSelf: 'flex-start' }}
              >
                ¿No encontrás la dirección? Marcá el punto en el mapa
              </MuiButton>
            </Box>
          )}

          {/* Device GPS — loading + non-blocking error message */}
          {locating && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">
                Obteniendo ubicación…
              </Typography>
            </Box>
          )}

          {locateError && <Alert severity="warning">{locateError}</Alert>}

          {/* Reverse geocoding — loading, error and unmatched-field hints */}
          {reverseGeocoding && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">
                Buscando la dirección…
              </Typography>
            </Box>
          )}

          {reverseError && <Alert severity="error">{reverseError}</Alert>}
          {reverseHint && <Alert severity="info">{reverseHint}</Alert>}

          {/* Manual selection — success chip + remove action once a point exists */}
          {selectingManual && manualLocation && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
              <MuiChip
                color="success"
                size="small"
                variant="filled"
                icon={<IconMapPin size={14} />}
                label={`Punto marcado: ${manualLocation.lat.toFixed(5)}, ${manualLocation.lng.toFixed(5)}`}
              />
              {!reverseError && !reverseGeocoding && (
                <MuiChip
                  color="success"
                  size="small"
                  variant="outlined"
                  icon={<IconMapPin size={14} />}
                  label="Dirección completada desde el mapa"
                />
              )}
              <MuiButton
                variant="ghost"
                size="sm"
                onClick={() => {
                  setManualLocation(null);
                  setReverseError(null);
                  setReverseHint(null);
                }}
                startIcon={<IconX size={14} />}
              >
                Quitar punto
              </MuiButton>
            </Box>
          )}

          {/* Manual hint loading — brief "Buscando la zona..." while geocoding city + province */}
          {selectingManual && manualHintLoading && (
            <Box
              sx={{
                height: 180,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: m3Shape.medium,
                border: 1,
                borderColor: 'outlineVariant',
                bgcolor: 'surfaceContainerLow',
              }}
            >
              <Typography variant="body2" color="onSurfaceVariant">
                Buscando la zona...
              </Typography>
            </Box>
          )}

          {(geocoded || (selectingManual && !manualHintLoading)) && (
            <MapView
              markers={geocoded ? [{ lat: geocoded.lat, lng: geocoded.lng }] : []}
              selectable={selectingManual}
              selectedMarker={selectingManual ? manualLocation : null}
              onSelect={
                selectingManual
                  ? (marker) => {
                      handleMapSelect(marker);
                    }
                  : undefined
              }
              selectHint="Tocá el mapa para completar la dirección del cliente"
              height={180}
              center={selectingManual ? (customerLocation ?? manualCenter ?? undefined) : undefined}
            />
          )}
        </Box>

        <MuiTextField
          label="CUIT/CUIL (opcional)"
          placeholder="XX-XXXXXXXX-X"
          value={form.taxId}
          onChange={(e) => setForm({ ...form, taxId: e.target.value })}
          helperText="Opcional para todos los clientes"
        />

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
          <MuiTextField
            label="Límite de crédito"
            type="number"
            placeholder="0"
            value={form.creditLimit}
            onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
          />
          <MuiTextField
            label="Plazo (días)"
            type="number"
            placeholder="0"
            value={form.termDays}
            onChange={(e) => setForm({ ...form, termDays: e.target.value })}
          />
        </Box>
      </Box>
    </MuiDialog>
  );
}