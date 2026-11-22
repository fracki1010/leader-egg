import { api } from './client.ts';
import type { AgentAction, AgentChatResponse, AgentChatState } from '../types/index.ts';

/**
 * AI assistant endpoints (admin only).
 *
 * GET is a normal authenticated read; POST runs one assistant turn; DELETE
 * clears the caller's transcript. The action endpoints execute a write the
 * assistant proposed, but only after the user confirms it in the UI. Writes are
 * always sent straight to the network — the assistant cannot work offline and
 * must not be queued.
 */
export const agentApi = {
  /** Current feature flag, recent transcript and hourly limit. */
  getChat(): Promise<AgentChatState> {
    return api.get<AgentChatState>('/v1/agent/chat');
  },

  /** Send one user message and return the assistant reply + tool summaries. */
  sendMessage(message: string): Promise<AgentChatResponse> {
    return api.post<AgentChatResponse>('/v1/agent/chat', { message });
  },

  /** Clear the transcript (the audit trail is kept server-side). 204 No Content. */
  clearChat(): Promise<void> {
    return api.delete<void>('/v1/agent/chat');
  },

  /** Execute a pending action exactly once. */
  confirmAction(id: string): Promise<{ action: AgentAction }> {
    return api.post<{ action: AgentAction }>(`/v1/agent/actions/${id}/confirm`);
  },

  /** Discard a pending action (409 when it was already processed). */
  cancelAction(id: string): Promise<{ action: AgentAction }> {
    return api.post<{ action: AgentAction }>(`/v1/agent/actions/${id}/cancel`);
  },
};
