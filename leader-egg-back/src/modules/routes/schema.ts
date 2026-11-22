import { z } from 'zod';

export const createRouteSchema = z.object({
  driverId: z.string().trim().min(1, 'Driver ID is required'),
  plannedDate: z.string().trim().min(1, 'Planned date is required'),
  vehicleId: z.string().trim().min(1).optional()
});

export const completeRouteSchema = z.object({
  kmTravelled: z.number().min(0).optional()
});

export const addStopSchema = z.object({
  orderId: z.string().trim().min(1, 'Order ID is required')
});

export const reorderStopsSchema = z.object({
  stopOrder: z.array(z.string().trim().min(1)).min(1, 'At least one stop ID is required')
});

export const optimizeRouteSchema = z.object({
  start: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180)
    })
    .optional()
});

export const advanceStopSchema = z.object({
  status: z.enum(['in_transit', 'delivered', 'skipped']),
  notes: z.string().optional()
});

export const addStopNoteSchema = z.object({
  notes: z.string().min(1, 'Notes cannot be empty')
});

export const listRoutesQuerySchema = z.object({
  status: z.enum(['planned', 'in_progress', 'completed', 'cancelled']).optional(),
  plannedDate: z.string().trim().min(1).optional()
});

export type CreateRouteInput = z.infer<typeof createRouteSchema>;
export type CompleteRouteInput = z.infer<typeof completeRouteSchema>;
export type AddStopInput = z.infer<typeof addStopSchema>;
export type ReorderStopsInput = z.infer<typeof reorderStopsSchema>;
export type OptimizeRouteInput = z.infer<typeof optimizeRouteSchema>;
export type AdvanceStopInput = z.infer<typeof advanceStopSchema>;
export type AddStopNoteInput = z.infer<typeof addStopNoteSchema>;
export type ListRoutesQuery = z.infer<typeof listRoutesQuerySchema>;
