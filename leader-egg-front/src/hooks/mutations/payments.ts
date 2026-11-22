import { useMutation, useQueryClient } from '@tanstack/react-query';
import { paymentsApi, type CreatePaymentPayload } from '../../api/payments.ts';
import type { CreateCustomerPaymentRequest } from '../../types/index.ts';
import { invalidateDomains } from '../invalidation.ts';
import { useOfflineAwareMutation } from '../use-offline-mutation.ts';

const PAYMENT_DOMAINS = ['orders', 'accounts', 'dashboard', 'payments'] as const;

/** Record a payment against an order (offline-queued like order creation). */
export function useRecordPayment() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ orderId, data }: { orderId: string; data: CreatePaymentPayload }) =>
      paymentsApi.record(orderId, data),
    onSuccess: () => invalidateDomains(queryClient, PAYMENT_DOMAINS),
  });
}

/**
 * Record a customer-level payment auto-allocated oldest-first across open
 * orders. Cash account movements change too, so that domain is invalidated as
 * well. Not offline-queued: allocation must be validated server-side against
 * the live open-order set.
 */
export function useRecordCustomerPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      customerId,
      data,
    }: {
      customerId: string;
      data: CreateCustomerPaymentRequest;
    }) => paymentsApi.recordCustomerPayment(customerId, data),
    onSuccess: () =>
      // `customers` keeps the customer detail summary/balance in sync.
      invalidateDomains(queryClient, [...PAYMENT_DOMAINS, 'cash', 'customers']),
  });
}
