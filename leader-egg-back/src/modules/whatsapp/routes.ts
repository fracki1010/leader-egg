import { Router } from 'express';
import { webhookHandler } from './controller.js';

export const whatsappRouter = Router();

// The webhook is called by Evolution, not by a user session: no `authenticate`.
// The shared secret is the only credential on this route.
whatsappRouter.post('/webhook/:instanceName', webhookHandler);
