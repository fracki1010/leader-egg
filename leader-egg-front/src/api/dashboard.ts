import { api } from './client.ts';
import type { Alert, DashboardSummary } from '../types/index.ts';

export const dashboardApi = {
  getAlerts(): Promise<Alert[]> {
    return api.get<Alert[]>('/v1/dashboard/alerts');
  },

  /** Consolidated dashboard numbers (admin + driver). */
  getSummary(): Promise<DashboardSummary> {
    return api.get<DashboardSummary>('/v1/dashboard/summary');
  }
};