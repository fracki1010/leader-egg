import { AppError } from '../../middleware/error-handler.js';
import { Customer, type AddressDetail, type CustomerStatus, type CustomerType, type ICustomer } from './model.js';
import { Order, type IOrder, type OrderStatus } from '../orders/model.js';
import { getCustomerOutstanding } from '../orders/credit-service.js';
import type { CreateCustomerInput, UpdateCustomerInput } from './schema.js';

/**
 * Strips empty strings from addressDetail so only real values are persisted.
 * Returns undefined when every field is empty (nothing to store).
 */
const sanitizeAddressDetail = (detail: AddressDetail | undefined): AddressDetail | undefined => {
  if (!detail) return undefined;

  const cleaned: AddressDetail = {};
  for (const [key, value] of Object.entries(detail)) {
    if (typeof value === 'string' && value.trim() !== '') {
      cleaned[key as keyof AddressDetail] = value.trim();
    }
  }

  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
};

/**
 * Check if a customer has pending or assigned orders.
 * Direct import of the Order model is safe: orders/model.ts has no dependency
 * back on the customers module (no circular dependency at module load time).
 */
const hasPendingOrders = async (customerId: string): Promise<boolean> => {
  const count = await Order.countDocuments({
    customerId,
    status: { $in: ['pending', 'assigned'] }
  });
  return count > 0;
};

/**
 * Escapes regex special characters so user-provided search terms are matched literally.
 */
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Accent-insensitive regex pattern for Spanish text.
 *
 * Customer names are typed inconsistently ("Calderón" vs "calderon"). Matching
 * only case-insensitively misses those, so every vowel (plus ñ/ç) matches its
 * accented variants. The search term is normalized first and then expanded.
 */
const ACCENT_EQUIVALENTS: Record<string, string> = {
  a: 'aáàäâ',
  e: 'eéèëê',
  i: 'iíìïî',
  o: 'oóòöô',
  u: 'uúùüû',
  n: 'nñ',
  c: 'cç'
};

const accentInsensitivePattern = (value: string): string =>
  Array.from(value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase())
    .map((char) => {
      const variants = ACCENT_EQUIVALENTS[char];
      return variants ? `[${variants}]` : escapeRegex(char);
    })
    .join('');

// ─── List / query ────────────────────────────────────────────────────────────

export interface CustomerQueryFilters {
  search?: string;
  type?: CustomerType;
  status?: CustomerStatus;
  includeInactive?: boolean;
}

/**
 * Builds the MongoDB filter for customer listing.
 * Explicit `status` takes precedence over the legacy `includeInactive` boolean.
 */
const buildCustomerFilter = (filters: CustomerQueryFilters): Record<string, unknown> => {
  const filter: Record<string, unknown> = {};

  if (filters.status) {
    filter.status = filters.status;
  } else if (!filters.includeInactive) {
    filter.status = 'active';
  }

  if (filters.type) {
    filter.type = filters.type;
  }

  if (filters.search) {
    const regex = new RegExp(accentInsensitivePattern(filters.search), 'i');
    filter.$or = [{ name: regex }, { phone: regex }, { taxId: regex }];
  }

  return filter;
};

/**
 * Legacy list — returns ALL matching customers as a plain array (no pagination).
 * Kept for backward compatibility with callers that expect Customer[].
 */
export const listCustomers = async (filters: CustomerQueryFilters = {}): Promise<ICustomer[]> => {
  return Customer.find(buildCustomerFilter(filters)).sort({ createdAt: -1 });
};

export interface CustomerListResult {
  items: ICustomer[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Paginated customer listing with search and filters.
 * Returns { items, total, page, limit } sorted by createdAt desc.
 */
export const queryCustomers = async (
  filters: CustomerQueryFilters & { limit: number; page: number }
): Promise<CustomerListResult> => {
  const query = buildCustomerFilter(filters);
  const skip = (filters.page - 1) * filters.limit;

  const [items, total] = await Promise.all([
    Customer.find(query).sort({ createdAt: -1 }).skip(skip).limit(filters.limit),
    Customer.countDocuments(query)
  ]);

  return { items, total, page: filters.page, limit: filters.limit };
};

// ─── CRUD ────────────────────────────────────────────────────────────────────

export const createCustomer = async (input: CreateCustomerInput): Promise<ICustomer> => {
  const customer = await Customer.create({
    name: input.name,
    type: input.type,
    phone: input.phone,
    address: input.address,
    addressDetail: sanitizeAddressDetail(input.addressDetail),
    email: input.email || undefined,
    taxId: input.taxId || undefined,
    location: input.location,
    creditConfig: input.creditConfig ?? { limit: 0, termDays: 0 }
  });

  return customer;
};

export const getCustomerById = async (id: string): Promise<ICustomer> => {
  const customer = await Customer.findById(id);
  if (!customer) {
    throw new AppError('Customer not found', 404);
  }
  return customer;
};

export const updateCustomer = async (id: string, input: UpdateCustomerInput): Promise<ICustomer> => {
  const customer = await Customer.findById(id);
  if (!customer) {
    throw new AppError('Customer not found', 404);
  }

  // Build update object from defined fields only
  const updateData: Record<string, unknown> = {};

  if (input.name !== undefined) updateData.name = input.name;
  if (input.type !== undefined) updateData.type = input.type;
  if (input.phone !== undefined) updateData.phone = input.phone;
  if (input.address !== undefined) updateData.address = input.address;
  if (input.addressDetail !== undefined) {
    const cleaned = sanitizeAddressDetail(input.addressDetail);
    // All-empty detail on update = no change (keeps the stored value)
    if (cleaned) updateData.addressDetail = cleaned;
  }
  if (input.email !== undefined) updateData.email = input.email || undefined;
  if (input.taxId !== undefined) updateData.taxId = input.taxId || undefined;
  if (input.location !== undefined) updateData.location = input.location;
  if (input.creditConfig !== undefined) updateData.creditConfig = input.creditConfig;

  // taxId (CUIT/CUIL) is optional for all customer types
  Object.assign(customer, updateData);
  await customer.save();

  return customer;
};

export const deactivateCustomer = async (id: string): Promise<ICustomer> => {
  const customer = await Customer.findById(id);
  if (!customer) {
    throw new AppError('Customer not found', 404);
  }

  if (customer.status === 'inactive') {
    throw new AppError('Customer is already inactive', 409);
  }

  // Guard: cannot deactivate if customer has pending/assigned orders
  const hasPending = await hasPendingOrders(id);
  if (hasPending) {
    throw new AppError('Cannot deactivate customer with pending or assigned orders', 409);
  }

  customer.status = 'inactive';
  await customer.save();

  return customer;
};

export const activateCustomer = async (id: string): Promise<ICustomer> => {
  const customer = await Customer.findById(id);
  if (!customer) {
    throw new AppError('Customer not found', 404);
  }

  if (customer.status === 'active') {
    throw new AppError('Customer is already active', 409);
  }

  customer.status = 'active';
  await customer.save();

  return customer;
};

/**
 * Hard-deletes a customer.
 * Blocked with 409 when the customer has ANY order — order history must be
 * preserved (audit trail). Deactivation via PATCH status is the soft path.
 */
export const deleteCustomer = async (id: string): Promise<void> => {
  const customer = await Customer.findById(id);
  if (!customer) {
    throw new AppError('Customer not found', 404);
  }

  const orderCount = await Order.countDocuments({ customerId: id });
  if (orderCount > 0) {
    throw new AppError('Cannot delete customer with order history; deactivate the customer instead', 409);
  }

  await Customer.deleteOne({ _id: customer._id });
};

// ─── Customer dashboard summary ──────────────────────────────────────────────

export interface CustomerSummary {
  customer: ICustomer;
  outstandingBalance: number;
  totalSpent: number;
  orderCount: number;
  lastOrderDate: Date | null;
  hasPendingOrders: boolean;
}

/**
 * Aggregated dashboard summary for a single customer.
 * - outstandingBalance: non-cancelled order balances + openingDebt + net
 *   manual charges (all terms flow through getCustomerOutstanding — openingDebt
 *   is already included there and must NOT be added again)
 * - totalSpent: sum of totalAmount across non-cancelled orders
 * - orderCount: total number of orders (any status)
 * - lastOrderDate: createdAt of the most recent order
 * - hasPendingOrders: any pending/assigned order exists
 */
export const getCustomerSummary = async (id: string): Promise<CustomerSummary> => {
  const customer = await getCustomerById(id);

  const [outstanding, orders, orderCount, hasPending] = await Promise.all([
    getCustomerOutstanding(id),
    Order.find({ customerId: id }).sort({ createdAt: -1 }),
    Order.countDocuments({ customerId: id }),
    hasPendingOrders(id)
  ]);

  // totalSpent excludes cancelled orders — money was never collected for them
  const totalSpent = orders
    .filter(order => order.status !== 'cancelled')
    .reduce((sum, order) => sum + order.totalAmount, 0);

  return {
    customer,
    outstandingBalance: outstanding.outstandingBalance,
    totalSpent,
    orderCount,
    lastOrderDate: orders[0]?.createdAt ?? null,
    hasPendingOrders: hasPending
  };
};

// ─── Customer orders (direct endpoint) ───────────────────────────────────────

export interface CustomerOrdersFilters {
  status?: OrderStatus;
  limit: number;
  page: number;
}

export interface CustomerOrdersResult {
  items: IOrder[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Returns a customer's orders with optional status filter, sorted by createdAt desc.
 * 404 when the customer does not exist.
 */
export const listCustomerOrders = async (
  customerId: string,
  filters: CustomerOrdersFilters
): Promise<CustomerOrdersResult> => {
  await getCustomerById(customerId);

  const query: Record<string, unknown> = { customerId };
  if (filters.status) {
    query.status = filters.status;
  }

  const skip = (filters.page - 1) * filters.limit;
  const [items, total] = await Promise.all([
    Order.find(query).sort({ createdAt: -1 }).skip(skip).limit(filters.limit),
    Order.countDocuments(query)
  ]);

  return { items, total, page: filters.page, limit: filters.limit };
};