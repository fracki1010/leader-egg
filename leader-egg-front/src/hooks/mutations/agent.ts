import { useMutation, useQueryClient } from '@tanstack/react-query';
import { agentApi } from '../../api/agent.ts';
import type { AgentChatMessage, AgentChatState } from '../../types/index.ts';
import { invalidateDomains } from '../invalidation.ts';
import { queryKeys } from '../query-keys.ts';

/**
 * Domains a confirmed assistant action can touch. Kept as a superset because
 * the same endpoints may create an order (which changes stock and accounts),
 * register a payment or create a customer.
 */
const AGENT_ACTION_DOMAINS = [
  'orders',
  'customers',
  'payments',
  'dashboard',
  'accounts',
  'inventory',
] as const;

/**
 * Send one message to the assistant.
 *
 * The user turn is appended optimistically so it shows up instantly; the
 * persisted transcript is then refetched on success (the server owns the ids,
 * timestamps and the assistant turn). On failure the optimistic turn is rolled
 * back and the error is surfaced by the caller.
 *
 * Deliberately NOT the offline-aware mutation: the assistant needs the network
 * and a queued turn would have no reply.
 */
export function useSendAgentMessage() {
  const queryClient = useQueryClient();
  const chatKey = queryKeys.agent.chat();

  return useMutation({
    mutationFn: (message: string) => agentApi.sendMessage(message),
    onMutate: async (message: string) => {
      await queryClient.cancelQueries({ queryKey: chatKey });
      const previous = queryClient.getQueryData<AgentChatState>(chatKey);

      if (previous) {
        const optimistic: AgentChatMessage = {
          role: 'user',
          content: message,
          createdAt: new Date().toISOString(),
        };
        queryClient.setQueryData<AgentChatState>(chatKey, {
          ...previous,
          messages: [...previous.messages, optimistic],
        });
      }

      return { previous };
    },
    onError: (_error, _message, context) => {
      if (context?.previous) {
        queryClient.setQueryData(chatKey, context.previous);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatKey });
    },
  });
}

/** Clear the transcript, then sync the (now empty) cached state. */
export function useClearAgentChat() {
  const queryClient = useQueryClient();
  const chatKey = queryKeys.agent.chat();

  return useMutation({
    mutationFn: () => agentApi.clearChat(),
    onSuccess: () => {
      queryClient.setQueryData<AgentChatState>(chatKey, (previous) =>
        previous ? { ...previous, messages: [], actions: [] } : previous,
      );
      void queryClient.invalidateQueries({ queryKey: chatKey });
    },
  });
}

/**
 * Confirm one pending assistant action.
 *
 * The backend executes it exactly once and returns the updated action; the
 * transcript is invalidated so the card re-renders with the server state, and
 * the affected data domains are refreshed because a real write happened.
 * Errors are surfaced by the caller as-is (they are user-facing Spanish).
 */
export function useConfirmAgentAction() {
  const queryClient = useQueryClient();
  const chatKey = queryKeys.agent.chat();

  return useMutation({
    mutationFn: (id: string) => agentApi.confirmAction(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatKey });
      invalidateDomains(queryClient, AGENT_ACTION_DOMAINS);
    },
  });
}

/**
 * Cancel one pending assistant action. Only the transcript changes, so only the
 * chat key is invalidated.
 */
export function useCancelAgentAction() {
  const queryClient = useQueryClient();
  const chatKey = queryKeys.agent.chat();

  return useMutation({
    mutationFn: (id: string) => agentApi.cancelAction(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatKey });
    },
  });
}
