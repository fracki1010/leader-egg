import argentinaData from './argentina.json';

export interface Localidad {
  id: string;
  nombre: string;
}

export interface Provincia {
  id: string;
  nombre: string;
  localidades: Localidad[];
}

/** 24 Argentine provinces, already sorted by name in the dataset. */
export const provincias: Provincia[] = argentinaData.provincias;

/**
 * Returns the localities of a province, sorted by name.
 * Returns an empty array when the province id is unknown or empty.
 */
export function getLocalidades(provinciaId: string): Localidad[] {
  return provincias.find((p) => p.id === provinciaId)?.localidades ?? [];
}