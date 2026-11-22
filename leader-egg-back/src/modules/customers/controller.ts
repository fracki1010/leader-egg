import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import {
  createCustomer,
  listCustomers,
  queryCustomers,
  getCustomerById,
  updateCustomer,
  deactivateCustomer,
  activateCustomer,
  deleteCustomer,
  getCustomerSummary,
  listCustomerOrders
} from './service.js';
import {
  createCustomerSchema,
  updateCustomerSchema,
  updateStatusSchema,
  listCustomersQuerySchema,
  listCustomerOrdersQuerySchema
} from './schema.js';

export const createCustomerHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createCustomerSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const customer = await createCustomer(parsed.data);
    response.status(201).json(customer);
  } catch (error) {
    next(error);
  }
};

export const listCustomersHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = listCustomersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const hasPagination = parsed.data.page !== undefined || parsed.data.limit !== undefined;
    const filters = {
      search: parsed.data.search,
      type: parsed.data.type,
      status: parsed.data.status,
      includeInactive: parsed.data.includeInactive === 'true'
    };

    // Backward compat: without page/limit return the legacy plain array shape.
    if (!hasPagination) {
      const customers = await listCustomers(filters);
      response.status(200).json(customers);
      return;
    }

    const result = await queryCustomers({
      ...filters,
      limit: parsed.data.limit ?? 50,
      page: parsed.data.page ?? 1
    });
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getCustomerHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const id = request.params.id as string;
    const customer = await getCustomerById(id);
    response.status(200).json(customer);
  } catch (error) {
    next(error);
  }
};

export const getCustomerSummaryHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const id = request.params.id as string;
    const summary = await getCustomerSummary(id);
    response.status(200).json(summary);
  } catch (error) {
    next(error);
  }
};

export const listCustomerOrdersHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = listCustomerOrdersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const id = request.params.id as string;
    const result = await listCustomerOrders(id, {
      status: parsed.data.status,
      limit: parsed.data.limit ?? 50,
      page: parsed.data.page ?? 1
    });
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const updateCustomerHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateCustomerSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const id = request.params.id as string;
    const customer = await updateCustomer(id, parsed.data);
    response.status(200).json(customer);
  } catch (error) {
    next(error);
  }
};

export const updateCustomerStatusHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateStatusSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const id = request.params.id as string;
    const customer = parsed.data.status === 'inactive'
      ? await deactivateCustomer(id)
      : await activateCustomer(id);

    response.status(200).json(customer);
  } catch (error) {
    next(error);
  }
};

export const deleteCustomerHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const id = request.params.id as string;
    await deleteCustomer(id);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
};