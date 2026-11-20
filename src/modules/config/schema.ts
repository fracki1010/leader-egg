import { z } from 'zod';

/**
 * Punto cero setup body. Every section is optional so a partial POST is
 * valid (missing sections default to 0 / empty). Stock quantities and debt
 * amounts MUST be strictly positive — a zero/negative entry means "leave it
 * out", and the wizard only sends entries with value > 0.
 */
export const setPuntoCeroSchema = z.object({
  stock: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().positive('Stock quantity must be positive')
      })
    )
    .optional(),
  // Legacy alias for the cash opening balance — sets openingBalances.cash.
  openingCash: z.number().min(0, 'openingCash must be >= 0').optional(),
  // Per-account opening balances — `cash` keeps `openingCash` in sync.
  openingBalances: z
    .object({
      cash: z.number().min(0, 'openingBalances.cash must be >= 0').optional(),
      mp: z.number().min(0, 'openingBalances.mp must be >= 0').optional(),
      bank: z.number().min(0, 'openingBalances.bank must be >= 0').optional()
    })
    .optional(),
  clientDebts: z
    .array(
      z.object({
        customerId: z.string().min(1),
        amount: z.number().positive('Debt amount must be positive')
      })
    )
    .optional(),
  supplierDebts: z
    .array(
      z.object({
        supplierId: z.string().min(1),
        amount: z.number().positive('Debt amount must be positive')
      })
    )
    .optional()
});

export type SetPuntoCeroInput = z.infer<typeof setPuntoCeroSchema>;

/**
 * Per-account opening-balance correction ("Cuentas de la Empresa").
 *
 * Every account is optional so a partial PATCH only touches what it sends,
 * but AT LEAST ONE must be present — an empty body is a no-op and gets a 400.
 * All values must be >= 0 (0 is valid; negatives are rejected).
 */
export const updateOpeningBalancesSchema = z
  .object({
    cash: z.number().min(0, 'cash must be >= 0').optional(),
    mp: z.number().min(0, 'mp must be >= 0').optional(),
    bank: z.number().min(0, 'bank must be >= 0').optional()
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'At least one account (cash, mp, bank) is required'
  });

export type UpdateOpeningBalancesInput = z.infer<typeof updateOpeningBalancesSchema>;

/**
 * Business profile (identity) update ("Perfil del negocio").
 *
 * Every field is optional so a partial PATCH only touches what it sends, but AT
 * LEAST ONE must be present — an empty body is a no-op and gets a 400.
 * `businessName` cannot be cleared (min 1); `address` and `phone` accept an
 * empty string to clear the stored value.
 */
export const updateBusinessProfileSchema = z
  .object({
    businessName: z
      .string()
      .trim()
      .min(1, 'businessName cannot be empty')
      .max(120, 'businessName must be at most 120 characters')
      .optional(),
    address: z
      .string()
      .trim()
      .max(200, 'address must be at most 200 characters')
      .optional(),
    phone: z
      .string()
      .trim()
      .max(40, 'phone must be at most 40 characters')
      .optional()
  })
  .refine(
    (data) =>
      data.businessName !== undefined || data.address !== undefined || data.phone !== undefined,
    { message: 'At least one of: businessName, address, phone is required' }
  );

export type UpdateBusinessProfileInput = z.infer<typeof updateBusinessProfileSchema>;