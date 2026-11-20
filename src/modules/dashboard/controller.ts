import type { NextFunction, Request, Response } from 'express';
import { getAlerts, getDashboardSummary } from './service.js';

export const getAlertsHandler = async (_request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const alerts = await getAlerts();
    response.status(200).json(alerts);
  } catch (error) {
    next(error);
  }
};

export const getDashboardSummaryHandler = async (_request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const summary = await getDashboardSummary();
    response.status(200).json(summary);
  } catch (error) {
    next(error);
  }
};