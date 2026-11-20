import { AppError } from '../../middleware/error-handler.js';
import { Supplier, type ISupplier } from './model.js';
import { Purchase } from '../purchases/model.js';
import type { CreateSupplierInput, UpdateSupplierInput } from './schema.js';

export interface SupplierQueryFilters {
  includeInactive?: boolean;
}

// ─── List / query ────────────────────────────────────────────────────────────

/**
 * Lists suppliers sorted by name. Active-only by default (R2); pass
 * `includeInactive: true` to return every supplier.
 */
export const listSuppliers = async (filters: SupplierQueryFilters = {}): Promise<ISupplier[]> => {
  const query: Record<string, unknown> = {};
  if (!filters.includeInactive) {
    query.active = true;
  }
  return Supplier.find(query).sort({ name: 1 });
};

export const getSupplierById = async (id: string): Promise<ISupplier> => {
  const supplier = await Supplier.findById(id);
  if (!supplier) {
    throw new AppError('Supplier not found', 404);
  }
  return supplier;
};

// ─── CRUD ────────────────────────────────────────────────────────────────────

export const createSupplier = async (input: CreateSupplierInput): Promise<ISupplier> => {
  return Supplier.create({
    name: input.name,
    contact: input.contact ?? '',
    phone: input.phone ?? '',
    active: true
  });
};

export const updateSupplier = async (id: string, input: UpdateSupplierInput): Promise<ISupplier> => {
  const supplier = await Supplier.findById(id);
  if (!supplier) {
    throw new AppError('Supplier not found', 404);
  }

  if (input.name !== undefined) supplier.name = input.name;
  if (input.contact !== undefined) supplier.contact = input.contact ?? '';
  if (input.phone !== undefined) supplier.phone = input.phone ?? '';
  await supplier.save();

  return supplier;
};

export const deactivateSupplier = async (id: string): Promise<ISupplier> => {
  const supplier = await Supplier.findById(id);
  if (!supplier) {
    throw new AppError('Supplier not found', 404);
  }

  if (!supplier.active) {
    throw new AppError('Supplier is already inactive', 409);
  }

  supplier.active = false;
  await supplier.save();

  return supplier;
};

export const activateSupplier = async (id: string): Promise<ISupplier> => {
  const supplier = await Supplier.findById(id);
  if (!supplier) {
    throw new AppError('Supplier not found', 404);
  }

  if (supplier.active) {
    throw new AppError('Supplier is already active', 409);
  }

  supplier.active = true;
  await supplier.save();

  return supplier;
};

/**
 * Hard-deletes a supplier.
 * Blocked with 409 when the supplier has ANY purchase — purchase history must
 * be preserved (audit trail). Deactivation via PATCH status is the soft path.
 */
export const deleteSupplier = async (id: string): Promise<void> => {
  const supplier = await Supplier.findById(id);
  if (!supplier) {
    throw new AppError('Supplier not found', 404);
  }

  const purchaseCount = await Purchase.countDocuments({ supplierId: id });
  if (purchaseCount > 0) {
    throw new AppError('Cannot delete supplier with purchase history; deactivate the supplier instead', 409);
  }

  await Supplier.deleteOne({ _id: supplier._id });
};