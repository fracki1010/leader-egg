import { useMutation, useQueryClient } from '@tanstack/react-query';
import { customerChargesApi } from '../../api/customer-charges.ts';
import type { CreateCustomerChargeRequest } from '../../types/index.ts';
import { invalidateDomains } from '../invalidation.ts';

// A manual charge changes the customer's balance everywhere it is shown.
const CHARGE_DOMAINS = ['customerCharges', 'accounts', 'customers', 'dashboard'] as const;

/** Register a manual charge/credit against a customer (admin-only). */
export function useCreateCustomerCharge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, data }: { customerId: string; data: CreateCustomerChargeRequest }) =>
      customerChargesApi.create(customerId, data),
    onSuccess: () => invalidateDomains(queryClient, CHARGE_DOMAINS),
  });
}
