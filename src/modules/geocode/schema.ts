import { z } from 'zod';

export const geocodeRequestSchema = z.object({
  address: z.string().trim().min(1, 'Address is required')
});

export type GeocodeRequestInput = z.infer<typeof geocodeRequestSchema>;

export const reverseGeocodeSchema = z.object({
  lat: z.number().min(-90, 'Latitude must be between -90 and 90').max(90, 'Latitude must be between -90 and 90'),
  lng: z.number().min(-180, 'Longitude must be between -180 and 180').max(180, 'Longitude must be between -180 and 180')
});

export type ReverseGeocodeInput = z.infer<typeof reverseGeocodeSchema>;