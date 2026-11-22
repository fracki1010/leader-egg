import { describe, it, expect } from 'vitest';
import { normalizeAddressName, matchProvincia, matchLocalidad } from '../address-match.ts';

describe('normalizeAddressName', () => {
  it('strips diacritics, trims and lowercases', () => {
    expect(normalizeAddressName('Córdoba')).toBe('cordoba');
    expect(normalizeAddressName('  RÍO  CUARTO ')).toBe('rio  cuarto');
    expect(normalizeAddressName('Ciudad Autónoma de Buenos Aires')).toBe('ciudad autonoma de buenos aires');
  });
});

describe('matchProvincia', () => {
  it('matches an exact dataset name', () => {
    expect(matchProvincia('Córdoba')?.nombre).toBe('Córdoba');
  });

  it('matches ignoring accents and case', () => {
    expect(matchProvincia('cordoba')?.nombre).toBe('Córdoba');
    expect(matchProvincia('SANTA FE')?.nombre).toBe('Santa Fe');
  });

  it('matches when the Nominatim name carries a qualifier', () => {
    expect(matchProvincia('Provincia de Buenos Aires')?.nombre).toBe('Buenos Aires');
  });

  it('returns undefined for unknown, empty or missing names', () => {
    expect(matchProvincia('Atlantis')).toBeUndefined();
    expect(matchProvincia('')).toBeUndefined();
    expect(matchProvincia(undefined)).toBeUndefined();
  });
});

describe('matchLocalidad', () => {
  const cordoba = matchProvincia('Córdoba');

  it('matches a locality of the province ignoring accents/case', () => {
    expect(matchLocalidad(cordoba, 'cordoba')?.nombre).toBe('Córdoba');
    expect(matchLocalidad(cordoba, 'Río Cuarto')?.nombre).toBe('Río Cuarto');
    expect(matchLocalidad(cordoba, 'agua de oro')?.nombre).toBe('Agua de Oro');
  });

  it('returns undefined when the locality belongs to another province', () => {
    expect(matchLocalidad(cordoba, 'Rosario')).toBeUndefined();
  });

  it('returns undefined without a province or a name', () => {
    expect(matchLocalidad(undefined, 'Córdoba')).toBeUndefined();
    expect(matchLocalidad(cordoba, undefined)).toBeUndefined();
  });
});
