import { Router } from 'express';
import {
  createVehicleHandler,
  listVehiclesHandler,
  getVehicleHandler,
  updateVehicleHandler,
  updateVehicleStatusHandler
} from './controller.js';
import { authenticate, authorize, requirePermission } from '../auth/middleware.js';

export const vehicleRouter = Router();

// All vehicle routes require admin authentication
vehicleRouter.use(authenticate);
vehicleRouter.use(authorize('admin'));

vehicleRouter.post('/', requirePermission('vehicles.manage'), createVehicleHandler);
vehicleRouter.get('/', requirePermission('vehicles.view'), listVehiclesHandler);
vehicleRouter.get('/:id', requirePermission('vehicles.view'), getVehicleHandler);
vehicleRouter.put('/:id', requirePermission('vehicles.manage'), updateVehicleHandler);
vehicleRouter.patch('/:id/status', requirePermission('vehicles.manage'), updateVehicleStatusHandler);