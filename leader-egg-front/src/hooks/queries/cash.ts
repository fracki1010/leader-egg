import { useQuery } from '@tanstack/react-query';
import { cashApi, type CashMovementListParams } from '../../api/cash.ts';
import { queryKeys } from '../query-keys.ts';

/** Unified cash ledger — filtered, paginated movements from every money account. */
export function useCashMovements(params?: CashMovementListParams) {
  return useQuery({
    queryKey: queryKeys.cash.movements(params),
    queryFn: () => cashApi.listMovements(params),
  });
}

/** Per-account balances + today's in/out/net totals. */
export function useCashSummary() {
  return useQuery({
    queryKey: queryKeys.cash.summary(),
    queryFn: () => cashApi.getSummary(),
  });
}
