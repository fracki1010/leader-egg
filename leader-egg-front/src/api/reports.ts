import { api } from './client.ts';
import type {
  AgingReport,
  RevenueReport,
  ProfitReport,
  CustomerHistory,
  CustomerFrequency,
  TopCustomer
} from '../types/index.ts';

export const reportsApi = {
  getAgingReport(customerId?: string): Promise<AgingReport> {
    const params: Record<string, string> = {};
    if (customerId) {
      params.customerId = customerId;
    }
    return api.get<AgingReport>('/v1/reports/aging', params);
  },

  getRevenueReport(startDate: string, endDate: string): Promise<RevenueReport> {
    return api.get<RevenueReport>('/v1/reports/revenue', { startDate, endDate });
  },

  getProfitReport(startDate: string, endDate: string): Promise<ProfitReport> {
    return api.get<ProfitReport>('/v1/reports/profit', { startDate, endDate });
  },

  getCustomerHistory(customerId: string): Promise<CustomerHistory> {
    return api.get<CustomerHistory>(`/v1/reports/customers/${customerId}/history`);
  },

  getCustomerFrequency(
    customerId: string,
    period: 'weekly' | 'monthly' = 'monthly',
    startDate?: string,
    endDate?: string
  ): Promise<CustomerFrequency> {
    const params: Record<string, string> = { period };
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    return api.get<CustomerFrequency>(`/v1/reports/customers/${customerId}/frequency`, params);
  },

  getTopCustomers(limit = 10): Promise<TopCustomer[]> {
    return api.get<TopCustomer[]>('/v1/reports/customers/top', { limit: String(limit) });
  }
};
