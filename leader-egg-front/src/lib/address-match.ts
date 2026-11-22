import { getLocalidades, provincias, type Localidad, type Provincia } from '../data/argentina.ts';

/**
 * Normalizes a place name for accent/case-insensitive matching: strips
 * diacritics, trims, and lowercases. Nominatim returns names with accents
 * ("Córdoba") while the static dataset uses the official spelling, so both
 * sides are compared on the normalized form.
 */
export function normalizeAddressName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Matches a name against a list of `{ nombre }` candidates: exact normalized
 * match first, then a conservative substring fallback where the DATASET name is
 * contained in the incoming name (handles qualifiers such as "Provincia de
 * Buenos Aires" vs "Buenos Aires"). The reverse direction is intentionally NOT
 * used — it would make "Rosario" match "Monte del Rosario".
 */
function matchByName<T extends { nombre: string }>(candidates: T[], name: string): T | undefined {
  const target = normalizeAddressName(name);
  if (!target) return undefined;

  const exact = candidates.find((candidate) => normalizeAddressName(candidate.nombre) === target);
  if (exact) return exact;

  return candidates.find((candidate) => {
    const normalized = normalizeAddressName(candidate.nombre);
    return normalized.length > 0 && target.includes(normalized);
  });
}

/** Finds a province in the static dataset by (accent/case-insensitive) name. */
export function matchProvincia(name?: string): Provincia | undefined {
  if (!name) return undefined;
  return matchByName(provincias, name);
}

/** Finds a locality of the given province by (accent/case-insensitive) name. */
export function matchLocalidad(provincia: Provincia | undefined, name?: string): Localidad | undefined {
  if (!provincia || !name) return undefined;
  return matchByName(getLocalidades(provincia.id), name);
}
