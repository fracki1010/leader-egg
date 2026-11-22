import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import {
  createOrder,
  listOrders,
  getOrderById,
  transitionOrderStatus,
  getOverdueOrders,
  updateOrder,
  deleteOrder,
  getTodayOrders
} from './service.js';
import { getCustomerOutstanding } from './creditService.js';
import { createOrderSchema, transitionStatusSchema, updateOrderSchema, listOrdersQuerySchema } from './schema.js';
import type { OrderStatus } from './model.js';
import { Order } from './model.js';

export const createOrderHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createOrderSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const user = request.user ? { userId: request.user.userId, role: request.user.role } : undefined;
    const order = await createOrder(parsed.data, user);
    response.status(201).json(order);
  } catch (error) {
    next(error);
  }
};

export const listOrdersHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    // Special filter: overdue keeps returning a plain array (backward compatible)
    if (request.query.overdue === 'true') {
      const user = request.user ? { userId: request.user.userId, role: request.user.role } : undefined;
      const orders = await getOverdueOrders(user);
      response.status(200).json(orders);
      return;
    }

    const parsed = listOrdersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const user = request.user ? { userId: request.user.userId, role: request.user.role } : undefined;
    const result = await listOrders(parsed.data, user);
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getTodayOrdersHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const user = request.user ? { userId: request.user.userId, role: request.user.role } : undefined;
    const result = await getTodayOrders(user);
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const updateOrderHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateOrderSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const user = request.user ? { userId: request.user.userId, role: request.user.role } : undefined;
    const id = request.params.id as string;
    const order = await updateOrder(id, parsed.data, user);
    response.status(200).json(order);
  } catch (error) {
    next(error);
  }
};

export const deleteOrderHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const id = request.params.id as string;
    await deleteOrder(id);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
};

export const getOrderHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const id = request.params.id as string;
    const user = request.user ? { userId: request.user.userId, role: request.user.role } : undefined;
    const order = await getOrderById(id, user);
    response.status(200).json(order);
  } catch (error) {
    next(error);
  }
};

export const transitionOrderHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = transitionStatusSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const id = request.params.id as string;
    const user = request.user ? { userId: request.user.userId, role: request.user.role } : undefined;
    const order = await transitionOrderStatus(
      id,
      parsed.data.status as OrderStatus,
      user,
      parsed.data.moneyAction
    );
    response.status(200).json(order);
  } catch (error) {
    next(error);
  }
};

export const driverTransitionOrderHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = transitionStatusSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    // Drivers can only transition to in_transit
    if (parsed.data.status !== 'in_transit') {
      throw new AppError('Drivers can only transition orders to in_transit', 403);
    }

    const id = request.params.id as string;

    // Undoing a delivery (delivered → in_transit) restores stock — admin only.
    const current = await Order.findById(id);
    if (current?.status === 'delivered') {
      throw new AppError('Drivers cannot undo a delivered order', 403);
    }

    const user = request.user ? { userId: request.user.userId, role: request.user.role } : undefined;
    const order = await transitionOrderStatus(id, parsed.data.status as OrderStatus, user);
    response.status(200).json(order);
  } catch (error) {
    next(error);
  }
};

export const getCustomerOutstandingHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const customerId = request.params.id as string;
    const result = await getCustomerOutstanding(customerId);
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
