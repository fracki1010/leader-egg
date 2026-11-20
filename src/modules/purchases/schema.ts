import { z } from 'zod';
import { businessDateSchema } from '../../utils/business-date.js';
import { PRODUCT_UNIT_ENUM } from '../products/units.js';

const purchaseItemSchema = z
  .object({
    productId: z.string().trim().min(1, 'productId is required'),
    // Quantity in the item's own unit ('maple' | 'medio_cajon' | 'cajon').
    quantity: z.number().int().positive('quantity must be a positive integer').optional(),
    // Legacy field — pre-unit clients sent the maple quantity directly.
    // Accepted only when `quantity` is absent; treated as maple quantity.
    quantityMaples: z.number().int().positive('quantityMaples must be a positive integer').optional(),
    unit: z.enum(PRODUCT_UNIT_ENUM).default('maple'),
    unitCost: z.number().positive('unitCost must be positive'),
    // Accepted for contract compatibility; the server ALWAYS recomputes subtotal
    // as quantity × unitCost so a tampered client value can never stick.
    subtotal: z.number().optional()
  })
  .refine((v) => v.quantity !== undefined || v.quantityMaples !== undefined, {
    message: 'quantity is required (or legacy quantityMaples)'
  });

/**
 * Reusable payment-line schema — one method/amount pair. `account` is optional
 * (derived from the method server-side when omitted); `reference` carries an
 * optional external id (e.g. an MP transaction id).
 */
export const purchasePaymentLineSchema = z.object({
  method: z.enum(['cash', 'transfer', 'check']),
  amount: z.number().positive('amount must be positive'),
  account: z.enum(['cash', 'mp', 'bank']).optional(),
  reference: z.string().trim().max(100).optional()
});

export const createPurchaseSchema = z.object({
  supplierId: z.string().trim().min(1, 'supplierId is required'),
  date: businessDateSchema.optional().default(() => new Date()),
  items: z.array(purchaseItemSchema).min(1, 'At least one item is required'),
  // Accepted for contract compatibility; the server ALWAYS recomputes totalCost
  // as the sum of item subtotals.
  totalCost: z.number().optional(),
  notes: z.string().trim().max(500).optional().default(''),
  // Lifecycle: create already delivered? (stock enters immediately)
  delivered: z.boolean().optional().default(false),
  // Legacy single-payment shape at creation (method + amount already paid).
  paymentMethod: z.enum(['cash', 'transfer', 'check']).optional().nullable(),
  paidAmount: z.number().positive('paidAmount must be positive').optional(),
  // Optional money-account override for the paid amount — omitted defaults to
  // the paymentMethod mapping (cash→cash, transfer→mp, check→bank).
  account: z.enum(['cash', 'mp', 'bank']).optional(),
  // New itemised payment shape at creation (one line per method). When present
  // it takes precedence over the legacy paymentMethod/paidAmount/account trio.
  payments: z.array(purchasePaymentLineSchema).min(1, 'At least one payment line is required').optional(),
  // Explicit user confirmation to create a second identical purchase inside
  // the 5-minute duplicate window (the UI asks before sending this).
  forceDuplicate: z.boolean().optional()
});

// PATCH /:id — edit a PENDING purchase only (supplierId/date/items/notes).
export const updatePurchaseSchema = z.object({
  supplierId: z.string().trim().min(1, 'supplierId is required').optional(),
  date: businessDateSchema.optional(),
  items: z.array(purchaseItemSchema).min(1, 'At least one item is required').optional(),
  notes: z.string().trim().max(500).optional()
});

// PATCH /:id/payment — record a payment against the purchase balance.
// Accepts EITHER the new itemised shape `{ payments: [...], groupId? }`
// (one line per method, all sharing a groupId) OR the legacy single shape
// `{ method, amount, account? }` (normalised server-side to a 1-line array).
export const recordPaymentSchema = z
  .object({
    // Legacy single-payment shape.
    method: z.enum(['cash', 'transfer', 'check']).optional(),
    amount: z.number().positive('amount must be positive').optional(),
    account: z.enum(['cash', 'mp', 'bank']).optional(),
    // Itemised shape.
    payments: z.array(purchasePaymentLineSchema).min(1, 'At least one payment line is required').optional(),
    // Optional shared id for the lines; generated server-side when omitted.
    groupId: z.string().trim().min(1).optional()
  })
  .refine((v) => v.payments !== undefined || (v.method !== undefined && v.amount !== undefined), {
    message: 'Provide payments[] or the legacy method + amount'
  });

// Query schema for GET /purchases — optional supplierId + inclusive date range + status
export const listPurchasesQuerySchema = z.object({
  supplierId: z.string().trim().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z.enum(['pending', 'delivered', 'cancelled']).optional()
});

export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;
export type UpdatePurchaseInput = z.infer<typeof updatePurchaseSchema>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
export type ListPurchasesQuery = z.infer<typeof listPurchasesQuerySchema>;