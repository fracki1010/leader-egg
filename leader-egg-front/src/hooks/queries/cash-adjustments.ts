import { useQuery } from '@tanstack/react-query';
import { cashAdjustmentsApi } from '../../api/cash-adjustments.ts';
import { queryKeys } from '../query-keys.ts';

export type CashAdjustmentListParams = {
  from?: string;
  to?: string;
  account?: string;
  createdBy?: string;
  page?: number;
  limit?: number;
};

export function useCashAdjustments(params?: CashAdjustmentListParams) {
  return useQuery({
    queryKey: queryKeys.cashAdjustments.list(params),
    queryFn: () => cashAdjustmentsApi.list(params),
  });
}
