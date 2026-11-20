import { z } from 'zod';
import { PRODUCT_UNIT_ENUM } from '../products/units.js';

export const orderItemInputSchema = z.object({
  productId: z.string().trim().min(1, 'Product ID is required'),
  quantity: z.number().int().positive('Quantity must be a positive integer'),
  // 'maple' (default), 'medio_cajon' or 'cajon' — quantities are converted to
  // maples server-side via the shared unit helper.
  unit: z.enum(PRODUCT_UNIT_ENUM).default('maple')
});

export const latLngInputSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180)
});

export const paymentPreferenceSchema = z.enum(['cash', 'transfer', 'credit', 'cod', 'partial']);

export const salesChannelSchema = z.enum(['reparto', 'puesto', 'whatsapp', 'otro']);

/** What happens to money already collected when an order is cancelled. */
export const cancelMoneyActionSchema = z.enum([
  'refund_cash',
  'refund_transfer',
  'customer_credit',
  'none'
]);

export type CancelMoneyAction = z.infer<typeof cancelMoneyActionSchema>;

/** Upfront payment recorded as a REAL Payment doc at order creation (partial preference). */
export const initialPaymentSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  method: z.enum(['cash', 'transfer', 'check']).default('cash'),
  // Optional money-account override — defaults to the method mapping server-side.
  account: z.enum(['cash', 'mp', 'bank']).optional()
});

/**
 * Order-level bonification: a fixed money amount or a percentage of the order
 * subtotal. The computed money discount (`amount`) is derived server-side from
 * the priced items, never trusted from the client.
 */
export const bonificationInputSchema = z
  .object({
    type: z.enum(['amount', 'percent']),
    value: z.number().positive('Bonification value must be positive')
  })
  .refine((bonification) => bonification.type !== 'percent' || bonification.value <= 100, {
    message: 'Bonification percentage cannot exceed 100'
  });

/**
 * Order-level surcharge: a fixed money amount or a percentage of the order
 * subtotal. The computed money surcharge (`amount`) is derived server-side from
 * the priced items, never trusted from the client.
 */
export const surchargeInputSchema = z
  .object({
    type: z.enum(['amount', 'percent']),
    value: z.number().positive('Surcharge value must be positive')
  })
  .refine((surcharge) => surcharge.type !== 'percent' || surcharge.value <= 100, {
    message: 'Surcharge percentage cannot exceed 100'
  });

export const createOrderSchema = z.object({
  customerId: z.string().trim().min(1, 'Customer ID is required'),
  // Optional: a puesto (stall) user omits it and the service forces 'walk_in'.
  channel: z.enum(['phone', 'whatsapp', 'driver_visit', 'walk_in']).optional(),
  items: z.array(orderItemInputSchema).min(1, 'At least one item is required'),
  // Shipping: optional — defaults to the customer's address when omitted
  deliveryAddress: z.string().trim().min(1, 'Delivery address is required').optional(),
  deliveryNotes: z.string().trim().optional(),
  // Business/sale date. Omitted → server defaults to now. Accepts a date-only
  // string ('YYYY-MM-DD') or an ISO instant.
  orderDate: z.coerce.date().optional(),
  // Date the customer wants the delivery (distinct from dueDate = credit term).
  // Accepts an ISO date string, null, or undefined — defaults to null.
  deliveryDate: z.coerce.date().nullable().optional(),
  deliveryLocation: latLngInputSchema.optional(),
  bypassCreditCheck: z.boolean().optional(),
  // Payment preference — omitted defaults to 'cash' (backward compatible).
  paymentPreference: paymentPreferenceSchema.optional(),
  // Sales channel — omitted defaults to 'reparto' (mongoose is the single default source).
  salesChannel: salesChannelSchema.optional(),
  // Initial status — 'delivered' creates the order already delivered and the
  // service consumes stock immediately. Omitted → 'pending'.
  status: z.enum(['pending', 'delivered']).optional(),
  // Optional REAL upfront payment (partial preference: paidAmount/balance/paymentStatus).
  // Legacy single-payment field, kept for backward compatibility.
  initialPayment: initialPaymentSchema.optional(),
  // Optional SPLIT upfront payments (partial preference): each line becomes its
  // own Payment doc. Takes precedence over the legacy single `initialPayment`.
  initialPayments: z.array(initialPaymentSchema).min(1).optional(),
  // Optional order-level discount. Omitted → no discount (previous behavior).
  bonification: bonificationInputSchema.optional(),
  // Optional order-level surcharge. Omitted → no surcharge (previous behavior).
  surcharge: surchargeInputSchema.optional(),
  // Explicit user confirmation to create a second identical order inside the
  // 5-minute duplicate window (the UI asks before sending this).
  forceDuplicate: z.boolean().optional()
});

export const transitionStatusSchema = z.object({
  // 'pending' is a reversible target (assigned → pending undo).
  status: z.enum(['pending', 'assigned', 'in_transit', 'delivered', 'cancelled']),
  // Only meaningful when cancelling a paid order — the service validates the
  // pairing and ignores it when there is no collected money.
  moneyAction: cancelMoneyActionSchema.optional()
});

export const updateOrderSchema = z.object({
  channel: z.enum(['phone', 'whatsapp', 'driver_visit', 'walk_in']).optional(),
  items: z.array(orderItemInputSchema).min(1, 'At least one item is required').optional(),
  deliveryAddress: z.string().trim().min(1, 'Delivery address is required').optional(),
  deliveryNotes: z.string().trim().optional(),
  // Business/sale date — editable while the order is pending.
  orderDate: z.coerce.date().optional(),
  // Date the customer wants the delivery (accepts ISO date string, null, or undefined).
  deliveryDate: z.coerce.date().nullable().optional(),
  deliveryLocation: latLngInputSchema.optional(),
  // Payment preference — changeable while the order is pending.
  paymentPreference: paymentPreferenceSchema.optional(),
  // Sales channel — changeable while the order is pending.
  salesChannel: salesChannelSchema.optional()
});

export const listOrdersQuerySchema = z.object({
  status: z.enum(['pending', 'assigned', 'in_transit', 'delivered', 'cancelled']).optional(),
  paymentStatus: z.enum(['unpaid', 'partial', 'paid']).optional(),
  customerId: z.string().trim().optional(),
  channel: z.enum(['phone', 'whatsapp', 'driver_visit', 'walk_in']).optional(),
  salesChannel: salesChannelSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().optional(),
  overdue: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().optional()
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type OrderItemInput = z.infer<typeof orderItemInputSchema>;
export type TransitionStatusInput = z.infer<typeof transitionStatusSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;
