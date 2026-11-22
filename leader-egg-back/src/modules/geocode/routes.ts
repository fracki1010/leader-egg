import { Router } from 'express';
import { geocodeHandler, reverseGeocodeHandler } from './controller.js';
import { authenticate } from '../auth/middleware.js';

export const geocodeRouter = Router();

// Any authenticated user (admin or driver) can geocode addresses
geocodeRouter.use(authenticate);
// Declared before the root route so the fixed path always wins the match
geocodeRouter.post('/reverse', reverseGeocodeHandler);
geocodeRouter.post('/', geocodeHandler);