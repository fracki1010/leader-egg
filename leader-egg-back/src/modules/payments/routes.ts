import { Router } from 'express';
import { recordPaymentHandler, listPaymentsHandler, getReceiptHandler } from './controller.js';
import { authenticate, requirePermission } from '../auth/middleware.js';

export const paymentRouter = Router({ mergeParams: true });

// All payment routes require authentication
paymentRouter.use(authenticate);

// Payments are nested under orders: /orders/:id/payments
paymentRouter.post('/payments', requirePermission('orders.manage'), recordPaymentHandler);
paymentRouter.get('/payments', requirePermission('orders.view'), listPaymentsHandler);
paymentRouter.get('/receipt', requirePermission('orders.view'), getReceiptHandler);
