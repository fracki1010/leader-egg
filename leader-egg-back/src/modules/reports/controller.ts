import type { NextFunction, Request, Response } from 'express';
import {
  getAgingReport,
  getRevenueReport,
  getProfitReport,
  getCustomerHistory,
  getCustomerFrequency,
  getTopCustomers
} from './service.js';

export const getAgingReportHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const customerId = request.query.customerId as string | undefined;
    const report = await getAgingReport(customerId);
    response.status(200).json(report);
  } catch (error) {
    next(error);
  }
};

export const getRevenueReportHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const startDate = request.query.startDate as string | undefined;
    const endDate = request.query.endDate as string | undefined;
    const report = await getRevenueReport(startDate ?? '', endDate ?? '');
    response.status(200).json(report);
  } catch (error) {
    next(error);
  }
};

export const getProfitReportHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const startDate = request.query.startDate as string | undefined;
    const endDate = request.query.endDate as string | undefined;
    const report = await getProfitReport(startDate ?? '', endDate ?? '');
    response.status(200).json(report);
  } catch (error) {
    next(error);
  }
};

export const getCustomerHistoryHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const id = request.params.id as string;
    const history = await getCustomerHistory(id);
    response.status(200).json(history);
  } catch (error) {
    next(error);
  }
};

export const getCustomerFrequencyHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const id = request.params.id as string;
    const period = request.query.period as string | undefined;
    const startDate = request.query.startDate as string | undefined;
    const endDate = request.query.endDate as string | undefined;
    const validPeriod = period === 'weekly' ? 'weekly' : 'monthly';
    const frequency = await getCustomerFrequency(id, validPeriod, startDate, endDate);
    response.status(200).json(frequency);
  } catch (error) {
    next(error);
  }
};

export const getTopCustomersHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const limitParam = request.query.limit as string | undefined;
    const limit = limitParam ? parseInt(limitParam, 10) : 10;
    const customers = await getTopCustomers(limit);
    response.status(200).json(customers);
  } catch (error) {
    next(error);
  }
};
