import { z } from 'zod';

export const dailyCloseChannelSchema = z.enum(['reparto', 'puesto']);

export const createDailyCloseSchema = z.object({
  date: z.coerce.date().optional(),
  countedCash: z.coerce.number().min(0, 'countedCash must be greater than or equal to 0'),
  notes: z.string().trim().max(500).optional(),
  channel: dailyCloseChannelSchema.optional()
});

export const updateDailyCloseSchema = z
  .object({
    countedCash: z.coerce.number().min(0, 'countedCash must be greater than or equal to 0').optional(),
    notes: z.string().trim().max(500).optional()
  })
  .refine((data) => data.countedCash !== undefined || data.notes !== undefined, {
    message: 'At least one of countedCash or notes is required'
  });

export const previewCloseSchema = z.object({
  date: z.coerce.date().optional(),
  channel: dailyCloseChannelSchema.optional()
});

export const dailyCloseFilterSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  channel: dailyCloseChannelSchema.optional()
});

export const dailyCloseDateParamSchema = z.object({
  date: z.coerce.date()
});

export type CreateDailyCloseInput = z.infer<typeof createDailyCloseSchema>;
export type UpdateDailyCloseInput = z.infer<typeof updateDailyCloseSchema>;
export type PreviewCloseInput = z.infer<typeof previewCloseSchema>;
export type DailyCloseFilterInput = z.infer<typeof dailyCloseFilterSchema>;
