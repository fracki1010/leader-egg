import { useQuery } from '@tanstack/react-query';
import { agentApi } from '../../api/agent.ts';
import { queryKeys } from '../query-keys.ts';

/**
 * The assistant transcript + feature flag.
 *
 * No polling: the transcript only changes through the mutations below, which
 * invalidate this key. A short stale window avoids refetching on every mount.
 */
export function useAgentChat() {
  return useQuery({
    queryKey: queryKeys.agent.chat(),
    queryFn: () => agentApi.getChat(),
    staleTime: 30_000,
  });
}
