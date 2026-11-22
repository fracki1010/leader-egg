import {
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query';
import { OfflineWriteQueuedError } from '../api/client.ts';

/** True when a mutation failed because the write was queued for later sync. */
export function isOfflineQueuedError(error: unknown): error is OfflineWriteQueuedError {
  return error instanceof OfflineWriteQueuedError;
}

/**
 * `useMutation` wrapper for offline-aware writes.
 *
 * When the api client queues a write while offline it throws
 * `OfflineWriteQueuedError`. That is a normal, expected outcome — the
 * `OfflineBanner` already shows the "saved offline" snackbar — so the default
 * `onError` handler (which would surface an error toast) is swallowed for that
 * specific error. Every other error is forwarded untouched.
 */
export function useOfflineAwareMutation<
  TData = unknown,
  TError = unknown,
  TVariables = void,
  TOnMutateResult = unknown,
>(
  options: UseMutationOptions<TData, TError, TVariables, TOnMutateResult>,
): UseMutationResult<TData, TError, TVariables, TOnMutateResult> {
  const { onError, ...rest } = options;

  return useMutation<TData, TError, TVariables, TOnMutateResult>({
    ...rest,
    onError: (error, variables, onMutateResult, context) => {
      if (isOfflineQueuedError(error)) return;
      onError?.(error, variables, onMutateResult, context);
    },
  });
}
