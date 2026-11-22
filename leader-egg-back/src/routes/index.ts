import { Router } from 'express';
import mongoose from 'mongoose';
import { authRouter, usersRouter } from '../modules/auth/routes.js';
import { customerRouter } from '../modules/customers/routes.js';
import { customerChargeRouter } from '../modules/customer-charges/routes.js';
import { customerPaymentRouter } from '../modules/customer-payments/routes.js';
import { productRouter } from '../modules/products/routes.js';
import { orderRouter } from '../modules/orders/routes.js';
import { paymentRouter } from '../modules/payments/routes.js';
import { returnsRouter, returnsListRouter } from '../modules/returns/routes.js';
import { reportRouter } from '../modules/reports/routes.js';
import { routeRouter } from '../modules/routes/routes.js';
import { expenseRouter } from '../modules/expenses/routes.js';
import { cashAdjustmentRouter } from '../modules/cash-adjustments/routes.js';
import { cashRouter } from '../modules/cash/routes.js';
import { dashboardRouter } from '../modules/dashboard/routes.js';
import { inventoryRouter } from '../modules/inventory/routes.js';
import { geocodeRouter } from '../modules/geocode/routes.js';
import { supplierRouter } from '../modules/suppliers/routes.js';
import { purchaseRouter } from '../modules/purchases/routes.js';
import { promotionRouter } from '../modules/promotions/routes.js';
import { accountRouter } from '../modules/accounts/routes.js';
import { configRouter } from '../modules/config/routes.js';
import { dailyCloseRouter } from '../modules/daily-closes/routes.js';
import { vehicleRouter } from '../modules/vehicles/routes.js';
import { platformRouter } from '../modules/platform/routes.js';
import { agentRouter } from '../modules/agent/routes.js';
import { whatsappRouter } from '../modules/whatsapp/routes.js';

export const router = Router();

router.get('/health', (_request, response) => {
  response.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: {
      status: mongoose.connection.readyState === 1 ? 'ready' : 'not_ready'
    }
  });
});

router.use('/v1/auth', authRouter);
router.use('/v1/users', usersRouter);
// Nested customer charges/payments mount BEFORE the customers router so its auth
// middleware does not also run for the sub-resource.
router.use('/v1/customers/:id/charges', customerChargeRouter);
router.use('/v1/customers/:id/payments', customerPaymentRouter);
router.use('/v1/customers', customerRouter);
router.use('/v1/products', productRouter);
router.use('/v1/orders', orderRouter);
router.use('/v1/orders/:id', paymentRouter);
router.use('/v1/orders/:id', returnsRouter);
router.use('/v1/returns', returnsListRouter);
router.use('/v1/reports', reportRouter);
router.use('/v1/routes', routeRouter);
router.use('/v1/expenses', expenseRouter);
router.use('/v1/cash-adjustments', cashAdjustmentRouter);
router.use('/v1/cash', cashRouter);
router.use('/v1/dashboard', dashboardRouter);
router.use('/v1/inventory', inventoryRouter);
router.use('/v1/geocode', geocodeRouter);
router.use('/v1/suppliers', supplierRouter);
router.use('/v1/purchases', purchaseRouter);
router.use('/v1/promotions', promotionRouter);
router.use('/v1/accounts', accountRouter);
router.use('/v1/setup', configRouter);
router.use('/v1/daily-closes', dailyCloseRouter);
router.use('/v1/vehicles', vehicleRouter);
router.use('/v1/platform', platformRouter);
router.use('/v1/agent', agentRouter);
router.use('/v1/whatsapp', whatsappRouter);
