import { Router } from 'express';
import { webhookHandler } from './controller.js';
import { connectHandler, getConnectionHandler } from './instance-controller.js';
import { authenticate, authorize, requirePermission } from '../auth/middleware.js';

export const whatsappRouter = Router();

// The webhook is called by Evolution, not by a user session: no `authenticate`.
// The shared secret is the only credential on this route.
whatsappRouter.post('/webhook/:instanceName', webhookHandler);

// Connecting the tenant's WhatsApp line is a settings task: admin + config.manage,
// the same guard as the other settings routes.
const settingsGuard = [authenticate, authorize('admin'), requirePermission('config.manage')];
whatsappRouter.get('/instance', ...settingsGuard, getConnectionHandler);
whatsappRouter.post('/instance/connect', ...settingsGuard, connectHandler);
